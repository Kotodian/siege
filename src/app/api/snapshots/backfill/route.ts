import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schedules, scheduleItems, fileSnapshots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

/**
 * POST /api/snapshots/backfill?planId=xxx
 *
 * For completed tasks that have no file_snapshots, generate them from git log.
 * Each commit maps to one task (by order). Initial commit uses --root.
 * If there are more tasks than commits, remaining tasks share the last commit's state.
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
  const completedItems = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, schedule.id))
    .all()
    .filter(i => i.status === "completed")
    .sort((a, b) => a.order - b.order);

  // Find tasks with no snapshots
  const tasksNeedBackfill = completedItems.filter(item => {
    return db.select().from(fileSnapshots)
      .where(eq(fileSnapshots.scheduleItemId, item.id))
      .all().length === 0;
  });

  if (tasksNeedBackfill.length === 0) {
    return NextResponse.json({ message: "All tasks already have snapshots", backfilled: 0 });
  }

  // Get commits oldest-first
  let commits: Array<{ hash: string; parent: string; message: string }>;
  try {
    const log = execSync('git log --reverse --format="%H|%P|%s"', {
      cwd, encoding: "utf-8", timeout: 10000,
    }).trim();
    commits = log.split("\n").filter(Boolean).map(line => {
      const parts = line.split("|");
      return { hash: parts[0], parent: parts[1] || "", message: parts.slice(2).join("|") };
    });
  } catch {
    return NextResponse.json({ error: "Failed to read git log" }, { status: 500 });
  }

  if (commits.length === 0) {
    return NextResponse.json({ error: "No commits found" }, { status: 400 });
  }

  let backfilled = 0;

  // Assign commits to tasks round-robin style
  for (let i = 0; i < tasksNeedBackfill.length; i++) {
    const task = tasksNeedBackfill[i];

    if (i < commits.length) {
      // This task gets one commit's diff
      const commit = commits[i];
      backfilled += captureCommitDiff(db, task.id, cwd, commit.hash, commit.parent);
    } else {
      // More tasks than commits: give remaining tasks the range from their
      // "position" in the commit list to the final commit
      // For simplicity, assign the full repo diff (empty -> HEAD) to each
      const lastHash = commits[commits.length - 1].hash;
      backfilled += captureCommitDiff(db, task.id, cwd, lastHash, "");
    }
  }

  return NextResponse.json({ message: `Backfilled ${backfilled} file snapshots`, backfilled });
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
    // Get list of changed files
    let files: string[];
    if (parentHash) {
      files = execSync(`git diff --name-only ${parentHash}..${commitHash}`, {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim().split("\n").filter(Boolean);
    } else {
      // Initial commit or full-repo diff: use --root
      files = execSync(`git diff-tree --root --no-commit-id --name-only -r ${commitHash}`, {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim().split("\n").filter(Boolean);
    }

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
    console.error(`[backfill] Failed for commit ${commitHash}:`, err);
  }
  return count;
}

function isBinaryPath(filePath: string): boolean {
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2", ".lock",
    ".pdf", ".exe", ".dll", ".so", ".dylib",
    ".db", ".sqlite",
  ]);
  return binaryExts.has(path.extname(filePath).toLowerCase());
}
