import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  targetRepoPath: text("target_repo_path").notNull(),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  status: text("status", {
    enum: [
      "draft",
      "reviewing",
      "confirmed",
      "scheduled",
      "executing",
      "testing",
      "completed",
    ],
  })
    .notNull()
    .default("draft"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const schemes = sqliteTable("schemes", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").default(""),
  sourceType: text("source_type", {
    enum: ["web_search", "local_analysis", "manual"],
  })
    .notNull()
    .default("manual"),
  searchResults: text("search_results").default("[]"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
});

export const scheduleItems = sqliteTable("schedule_items", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id")
    .notNull()
    .references(() => schedules.id, { onDelete: "cascade" }),
  schemeId: text("scheme_id").references(() => schemes.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description").default(""),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  order: integer("order").notNull().default(0),
  status: text("status", {
    enum: ["pending", "in_progress", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  progress: integer("progress").notNull().default(0),
  executionLog: text("execution_log").default(""),
  engine: text("engine").default("claude-code"),
  skills: text("skills").default("[]"),
});

export const testSuites = sqliteTable("test_suites", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "generating", "running", "passed", "failed"],
  })
    .notNull()
    .default("pending"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const testCases = sqliteTable("test_cases", {
  id: text("id").primaryKey(),
  testSuiteId: text("test_suite_id")
    .notNull()
    .references(() => testSuites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  type: text("type", { enum: ["unit", "integration", "e2e"] })
    .notNull()
    .default("unit"),
  generatedCode: text("generated_code").default(""),
  filePath: text("file_path"),
  status: text("status", {
    enum: ["pending", "running", "passed", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
});

export const testResults = sqliteTable("test_results", {
  id: text("id").primaryKey(),
  testCaseId: text("test_case_id")
    .notNull()
    .references(() => testCases.id, { onDelete: "cascade" }),
  runAt: text("run_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  status: text("status", {
    enum: ["passed", "failed", "error", "skipped"],
  }).notNull(),
  output: text("output").default(""),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms").default(0),
});

export const cliEngines = sqliteTable("cli_engines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  defaultArgs: text("default_args").default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const backupConfigs = sqliteTable("backup_configs", {
  id: text("id").primaryKey(),
  backend: text("backend", {
    enum: ["obsidian", "notion", "local"],
  }).notNull(),
  config: text("config").notNull().default("{}"),
  scheduleCron: text("schedule_cron").notNull().default("0 2 * * *"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const backupHistory = sqliteTable("backup_history", {
  id: text("id").primaryKey(),
  backupConfigId: text("backup_config_id")
    .notNull()
    .references(() => backupConfigs.id, { onDelete: "cascade" }),
  startedAt: text("started_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  completedAt: text("completed_at"),
  status: text("status", {
    enum: ["running", "completed", "failed"],
  })
    .notNull()
    .default("running"),
  itemsCount: integer("items_count").default(0),
  errorMessage: text("error_message"),
});
