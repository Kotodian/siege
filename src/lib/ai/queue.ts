/**
 * AI task queue using SQLite for persistence (survives Next.js hot reload).
 * Uses a simple file lock to prevent concurrent claude processes.
 */

import { getDb } from "@/lib/db";
import { aiTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const LOCK_FILE = path.join(process.cwd(), "data", ".ai-lock");

function isLocked(): boolean {
  try {
    if (!fs.existsSync(LOCK_FILE)) return false;
    const pid = fs.readFileSync(LOCK_FILE, "utf-8").trim();
    // Check if process is still alive
    try {
      process.kill(Number(pid), 0);
      return true;
    } catch {
      // Process dead, stale lock
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
  } catch {
    return false;
  }
}

function acquireLock(): boolean {
  if (isLocked()) return false;
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

/**
 * Create an AI task record in DB and run it when lock is available.
 */
export function createAiTask(
  id: string,
  type: string,
  fn: () => Promise<string>
) {
  const db = getDb();
  db.insert(aiTasks)
    .values({ id, type, status: "pending" })
    .run();

  // Try to run immediately or queue
  runTask(id, fn);
}

async function runTask(id: string, fn: () => Promise<string>) {
  // Wait for lock
  const maxWait = 300; // 5 minutes
  for (let i = 0; i < maxWait; i++) {
    if (acquireLock()) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!acquireLock() && isLocked()) {
    // Still locked after waiting, update status
    const db = getDb();
    db.update(aiTasks)
      .set({ status: "error", result: "Queue timeout" })
      .where(eq(aiTasks.id, id))
      .run();
    return;
  }

  const db = getDb();
  db.update(aiTasks)
    .set({ status: "running" })
    .where(eq(aiTasks.id, id))
    .run();

  try {
    const result = await fn();
    db.update(aiTasks)
      .set({ status: "done", result })
      .where(eq(aiTasks.id, id))
      .run();
  } catch (err) {
    db.update(aiTasks)
      .set({ status: "error", result: String(err) })
      .where(eq(aiTasks.id, id))
      .run();
  } finally {
    releaseLock();
  }
}

export function getAiTaskStatus(id: string) {
  const db = getDb();
  return db.select().from(aiTasks).where(eq(aiTasks.id, id)).get();
}

export function getQueueStatus() {
  return { locked: isLocked() };
}
