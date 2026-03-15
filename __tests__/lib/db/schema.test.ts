import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("Database Schema", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("should create and query a project", () => {
    const id = crypto.randomUUID();
    db.insert(schema.projects)
      .values({
        id,
        name: "Test Project",
        description: "A test project",
        targetRepoPath: "/tmp/test-repo",
      })
      .run();

    const result = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();
    expect(result).toBeDefined();
    expect(result!.name).toBe("Test Project");
    expect(result!.targetRepoPath).toBe("/tmp/test-repo");
  });

  it("should create a plan linked to a project", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "Test Project", targetRepoPath: "/tmp/test" })
      .run();

    db.insert(schema.plans)
      .values({
        id: planId,
        projectId,
        name: "Test Plan",
        description: "A test plan",
        status: "draft",
      })
      .run();

    const result = db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.projectId, projectId))
      .all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Plan");
    expect(result[0].status).toBe("draft");
  });

  it("should create a scheme linked to a plan", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    const schemeId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "draft" })
      .run();
    db.insert(schema.schemes)
      .values({
        id: schemeId,
        planId,
        title: "API Refactor",
        content: "## Overview\nRefactor the API layer...",
        sourceType: "manual",
      })
      .run();

    const result = db
      .select()
      .from(schema.schemes)
      .where(eq(schema.schemes.planId, planId))
      .all();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("API Refactor");
    expect(result[0].sourceType).toBe("manual");
  });

  it("should support all valid plan statuses", () => {
    const projectId = crypto.randomUUID();
    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();

    const validStatuses = [
      "draft",
      "reviewing",
      "confirmed",
      "scheduled",
      "executing",
      "testing",
      "completed",
    ] as const;

    for (const status of validStatuses) {
      const planId = crypto.randomUUID();
      db.insert(schema.plans)
        .values({ id: planId, projectId, name: `Plan ${status}`, status })
        .run();

      const result = db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, planId))
        .get();
      expect(result!.status).toBe(status);
    }
  });

  it("should create schedule with items linked to scheme", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    const schemeId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();
    const itemId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "draft" })
      .run();
    db.insert(schema.schemes)
      .values({ id: schemeId, planId, title: "S", content: "c", sourceType: "manual" })
      .run();
    db.insert(schema.schedules)
      .values({ id: scheduleId, planId, startDate: "2026-03-15", endDate: "2026-03-20" })
      .run();
    db.insert(schema.scheduleItems)
      .values({
        id: itemId,
        scheduleId,
        schemeId,
        title: "Task 1",
        description: "Do something",
        startDate: "2026-03-15",
        endDate: "2026-03-17",
        order: 1,
        status: "pending",
        progress: 0,
        engine: "claude-code",
        skills: "[]",
      })
      .run();

    const result = db
      .select()
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.scheduleId, scheduleId))
      .all();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Task 1");
    expect(result[0].engine).toBe("claude-code");
  });

  it("should create test suite with cases and results", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    const suiteId = crypto.randomUUID();
    const caseId = crypto.randomUUID();
    const resultId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "draft" })
      .run();
    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "pending" })
      .run();
    db.insert(schema.testCases)
      .values({
        id: caseId,
        testSuiteId: suiteId,
        name: "test_login",
        description: "Test login flow",
        type: "integration",
        status: "pending",
      })
      .run();
    db.insert(schema.testResults)
      .values({
        id: resultId,
        testCaseId: caseId,
        status: "passed",
        output: "All assertions passed",
        durationMs: 120,
      })
      .run();

    const results = db
      .select()
      .from(schema.testResults)
      .where(eq(schema.testResults.testCaseId, caseId))
      .all();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].durationMs).toBe(120);
  });

  it("should cascade delete plans when project is deleted", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "draft" })
      .run();

    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();

    const plans = db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.projectId, projectId))
      .all();
    expect(plans).toHaveLength(0);
  });

  it("should cascade delete schemes when plan is deleted", () => {
    const projectId = crypto.randomUUID();
    const planId = crypto.randomUUID();

    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "draft" })
      .run();
    db.insert(schema.schemes)
      .values({
        id: crypto.randomUUID(),
        planId,
        title: "S1",
        content: "",
        sourceType: "manual",
      })
      .run();

    db.delete(schema.plans).where(eq(schema.plans.id, planId)).run();

    const schemes = db
      .select()
      .from(schema.schemes)
      .where(eq(schema.schemes.planId, planId))
      .all();
    expect(schemes).toHaveLength(0);
  });

  it("should store and retrieve app settings", () => {
    const id = crypto.randomUUID();
    db.insert(schema.appSettings)
      .values({ id, key: "archive_after_days", value: "30" })
      .run();

    const result = db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "archive_after_days"))
      .get();
    expect(result!.value).toBe("30");
  });

  it("should store and retrieve backup config", () => {
    const id = crypto.randomUUID();
    db.insert(schema.backupConfigs)
      .values({
        id,
        backend: "obsidian",
        config: JSON.stringify({ vault_path: "/home/user/vault" }),
        scheduleCron: "0 2 * * *",
        enabled: true,
      })
      .run();

    const result = db
      .select()
      .from(schema.backupConfigs)
      .where(eq(schema.backupConfigs.id, id))
      .get();
    expect(result!.backend).toBe("obsidian");
    expect(JSON.parse(result!.config)).toEqual({ vault_path: "/home/user/vault" });
  });
});
