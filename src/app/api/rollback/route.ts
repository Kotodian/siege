import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scheduleItems, schedules, plans, projects, fileSnapshots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { itemId, dryRun, confirm } = body as {
    itemId: string;
    dryRun?: boolean;
    confirm?: boolean;
  };

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const db = getDb();

  const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.status !== "completed") {
    return NextResponse.json({ error: "Can only rollback completed tasks" }, { status: 400 });
  }

  // Traverse: schedule -> plan -> project
  const schedule = db.select().from(schedules).where(eq(schedules.id, item.scheduleId)).get();
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : "";
  if (!cwd) {
    return NextResponse.json({ error: "Target repo not found" }, { status: 400 });
  }

  // Load snapshots
  const snapshots = db.select().from(fileSnapshots)
    .where(eq(fileSnapshots.scheduleItemId, itemId)).all();
  if (snapshots.length === 0) {
    return NextResponse.json({ error: "No file snapshots found for this task" }, { status: 400 });
  }

  // Safety check 1: later completed tasks touching same files
  const allItems = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, item.scheduleId)).all()
    .filter(i => i.id !== item.id && i.status === "completed" && i.order > item.order);

  const dependentTasks: Array<{ taskId: string; title: string; order: number; overlappingFiles: string[] }> = [];
  for (const laterItem of allItems) {
    const laterSnaps = db.select().from(fileSnapshots)
      .where(eq(fileSnapshots.scheduleItemId, laterItem.id)).all();
    const overlapping = laterSnaps
      .map(s => s.filePath)
      .filter(fp => snapshots.some(s => s.filePath === fp));
    if (overlapping.length > 0) {
      dependentTasks.push({
        taskId: laterItem.id,
        title: laterItem.title,
        order: laterItem.order,
        overlappingFiles: overlapping,
      });
    }
  }

  // Safety check 2: file conflicts (modified since task)
  const conflicts: Array<{ filePath: string }> = [];
  for (const snap of snapshots) {
    const absPath = path.join(cwd, snap.filePath);
    let currentContent = "";
    try { currentContent = fs.readFileSync(absPath, "utf-8"); } catch { /* deleted */ }
    if (currentContent !== (snap.contentAfter || "")) {
      conflicts.push({ filePath: snap.filePath });
    }
  }

  // Build file list
  const files = snapshots.map(s => ({
    filePath: s.filePath,
    action: (!s.contentBefore && s.contentAfter) ? "delete"
          : (s.contentBefore && !s.contentAfter) ? "recreate"
          : "restore",
    hasConflict: conflicts.some(c => c.filePath === s.filePath),
  }));

  // DRY RUN: return preflight info
  if (dryRun) {
    return NextResponse.json({
      item: { id: item.id, title: item.title, order: item.order },
      files,
      dependentTasks,
      conflicts,
    });
  }

  // EXECUTE: require explicit confirm
  if (!confirm) {
    return NextResponse.json({ error: "Must pass confirm: true to execute rollback" }, { status: 400 });
  }

  // Perform the rollback
  const rolledBackFiles: string[] = [];
  for (const snap of snapshots) {
    const absPath = path.join(cwd, snap.filePath);
    if (!snap.contentBefore && snap.contentAfter) {
      // File was created by the task -> delete it
      try { fs.unlinkSync(absPath); } catch { /* already gone */ }
    } else if (snap.contentBefore) {
      // Restore original content
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, snap.contentBefore, "utf-8");
    }
    rolledBackFiles.push(snap.filePath);
  }

  // Git commit
  let commitMessage = "";
  try {
    execSync(`git add ${rolledBackFiles.map(f => JSON.stringify(f)).join(" ")}`, {
      cwd, encoding: "utf-8", timeout: 10000,
    });
    commitMessage = `rollback: revert task #${item.order} - ${item.title}`;
    execSync(`git commit -m ${JSON.stringify(commitMessage)}`, {
      cwd, encoding: "utf-8", timeout: 10000,
    });
  } catch {
    // Nothing to commit (files already in pre-task state) — that's fine
  }

  // Update status
  db.update(scheduleItems)
    .set({ status: "rolled_back", progress: 0 })
    .where(eq(scheduleItems.id, itemId))
    .run();

  return NextResponse.json({
    success: true,
    rolledBackFiles,
    commitMessage,
  });
}
