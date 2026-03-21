import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schedules, scheduleItems, fileSnapshots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * POST /api/snapshots/backfill?planId=xxx
 *
 * For completed tasks that have no file_snapshots, attempt to generate them
 * from git log. Each commit is matched to a task by order/title keywords.
 * Unmatched commits are assigned to the nearest task by order.
 */
export async function POST(req: NextRequest) {
  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json({ error: "planId is required" }, { status: 400 });
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project?.targetRepoPath || !fs.existsSync(project.targetRepoPath))
    return NextResponse.json({ error: "Repo not found" }, { status: 400 });

  const schedule = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
  if (!schedule) return NextResponse.json({ error: "No schedule" }, { status: 400 });

  const cwd = project.targetRepoPath;
  const items = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, schedule.id))
    .all()
    .filter(i => i.status === "completed")
    .sort((a, b) => a.order - b.order);

  // Find tasks with no snapshots
  const tasksWithoutSnapshots = items.filter(item => {
    const count = db.select().from(fileSnapshots)
      .where(eq(fileSnapshots.scheduleItemId, item.id))
      .all().length;
    return count === 0;
  });

  if (tasksWithoutSnapshots.length === 0) {
    return NextResponse.json({ message: "All tasks already have snapshots", backfilled: 0 });
  }

  // Get commit list (oldest first)
  let commits: Array<{ hash: string; parent: string; message: string }>;
  try {
    const log = execSync('git log --reverse --format="%H|%P|%s"', {
      cwd, encoding: "utf-8", timeout: 10000,
    }).trim();
    commits = log.split("\n").filter(Boolean).map(line => {
      const [hash, parent, ...msgParts] = line.split("|");
      return { hash, parent: parent || "", message: msgParts.join("|") };
    });
  } catch {
    return NextResponse.json({ error: "Failed to read git log" }, { status: 500 });
  }

  if (commits.length === 0) {
    return NextResponse.json({ error: "No commits found" }, { status: 400 });
  }

  // Strategy: distribute commits evenly across tasks without snapshots
  // Each commit's diff goes to the corresponding task
  let backfilled = 0;

  if (commits.length <= tasksWithoutSnapshots.length) {
    // Fewer commits than tasks: assign one commit per task, remaining tasks get nothing
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const task = tasksWithoutSnapshots[i];
      const count = captureCommitDiff(db, task.id, cwd, commit.hash, commit.parent);
      backfilled += count;
    }
  } else {
    // More commits than tasks: distribute evenly
    const chunkSize = Math.ceil(commits.length / tasksWithoutSnapshots.length);
    for (let i = 0; i < tasksWithoutSnapshots.length; i++) {
      const task = tasksWithoutSnapshots[i];
      const startIdx = i * chunkSize;
      const endIdx = Math.min((i + 1) * chunkSize, commits.length);
      // Use first commit's parent as before, last commit as after
      const firstParent = commits[startIdx].parent;
      const lastHash = commits[endIdx - 1].hash;
      const count = captureCommitDiff(db, task.id, cwd, lastHash, firstParent);
      backfilled += count;
    }
  }

  return NextResponse.json({ message: `Backfilled ${backfilled} snapshots`, backfilled });
}

function captureCommitDiff(
  db: ReturnType<typeof getDb>,
  itemId: string,
  cwd: string,
  commitHash: string,
  parentHash: string,
): number {
  let count = 0;
  try {
    const diffCmd = parentHash
      ? `git diff --name-only ${parentHash}..${commitHash}`
      : `git diff-tree --no-commit-id --name-only -r ${commitHash}`;

    const files = execSync(diffCmd, {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim().split("\n").filter(Boolean);

    for (const filePath of files) {
      if (isBinaryPath(filePath)) continue;

      let contentBefore = "";
      if (parentHash) {
        try {
          contentBefore = execSync(`git show ${parentHash}:${filePath}`, {
            cwd, encoding: "utf-8", timeout: 5000,
          });
        } catch { /* new file */ }
      }

      let contentAfter = "";
      try {
        contentAfter = execSync(`git show ${commitHash}:${filePath}`, {
          cwd, encoding: "utf-8", timeout: 5000,
        });
      } catch { /* deleted */ }

      if (contentBefore === contentAfter) continue;

      db.insert(fileSnapshots).values({
        id: crypto.randomUUID(),
        scheduleItemId: itemId,
        filePath,
        contentBefore,
        contentAfter,
      }).run();
      count++;
    }
  } catch (err) {
    console.error(`[backfill] Failed for ${commitHash}:`, err);
  }
  return count;
}

function isBinaryPath(filePath: string): boolean {
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2",
    ".pdf", ".exe", ".dll", ".so", ".dylib",
    ".db", ".sqlite",
  ]);
  return binaryExts.has(path.extname(filePath).toLowerCase());
}
