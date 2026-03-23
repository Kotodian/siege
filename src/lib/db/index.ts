import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "siege.db");

function createDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Auto-migrate on startup
  try {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "src/lib/db/migrations") });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Ignore "duplicate column" errors from migrations that add columns
    // which were already added manually
    if (msg.includes("duplicate column")) {
      console.warn("[db] Migration warning (duplicate column, skipping):", msg);
    } else {
      console.error("[db] Migration failed:", err);
    }
  }

  return db;
}

let dbInstance: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = createDb();
  }
  return dbInstance;
}
