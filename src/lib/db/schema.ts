import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").default("📁"),
  description: text("description").default(""),
  guidelines: text("guidelines").default(""),
  sessionId: text("session_id"),
  targetRepoPath: text("target_repo_path").notNull(),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const planFolders = sqliteTable("plan_folders", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  createdAt: text("created_at")
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
      "code_review",
      "testing",
      "completed",
    ],
  })
    .notNull()
    .default("draft"),
  tag: text("tag").default("feature"),
  sessionId: text("session_id"),
  folderId: text("folder_id").references(() => planFolders.id, {
    onDelete: "set null",
  }),
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
  structuredContent: text("structured_content"), // JSON: StructuredScheme
  sourceType: text("source_type", {
    enum: ["web_search", "local_analysis", "manual", "notion", "jira", "confluence", "mcp", "feishu", "github", "gitlab"],
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

export const schemeVersions = sqliteTable("scheme_versions", {
  id: text("id").primaryKey(),
  schemeId: text("scheme_id")
    .notNull()
    .references(() => schemes.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  content: text("content").default(""),
  createdAt: text("created_at")
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
  autoExecute: integer("auto_execute", { mode: "boolean" }).notNull().default(false),
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
  scheduleItemId: text("schedule_item_id"),
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

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["scheme", "implementation"],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "in_progress", "approved", "changes_requested"],
  })
    .notNull()
    .default("pending"),
  content: text("content").default(""),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const reviewItems = sqliteTable("review_items", {
  id: text("id").primaryKey(),
  reviewId: text("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  targetType: text("target_type", {
    enum: ["scheme", "schedule_item", "code"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  title: text("title").notNull(),
  content: text("content").default(""),
  severity: text("severity", {
    enum: ["info", "warning", "critical"],
  })
    .notNull()
    .default("info"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  resolution: text("resolution"), // null=pending, "approved"=valid issue, "rejected"=dismissed
  filePath: text("file_path"),
  lineNumber: integer("line_number"),
  options: text("options"),
});

export const fileSnapshots = sqliteTable("file_snapshots", {
  id: text("id").primaryKey(),
  scheduleItemId: text("schedule_item_id")
    .notNull()
    .references(() => scheduleItems.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  contentBefore: text("content_before").default(""),
  contentAfter: text("content_after").default(""),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const reviewComments = sqliteTable("review_comments", {
  id: text("id").primaryKey(),
  reviewId: text("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  lineNumber: integer("line_number").notNull(),
  content: text("content").notNull(),
  aiResponse: text("ai_response").default(""),
  status: text("status", {
    enum: ["pending", "applied", "rejected"],
  })
    .notNull()
    .default("pending"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const importConfigs = sqliteTable("import_configs", {
  id: text("id").primaryKey(),
  source: text("source", {
    enum: ["notion", "jira", "confluence", "mcp", "feishu", "github", "gitlab"],
  }).notNull(),
  config: text("config").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const aiTasks = sqliteTable("ai_tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", {
    enum: ["pending", "running", "done", "error"],
  }).notNull().default("pending"),
  result: text("result"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  type: text("type", { enum: ["project", "user", "feedback"] }).notNull().default("project"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  source: text("source", { enum: ["auto", "manual"] }).notNull().default("manual"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});
