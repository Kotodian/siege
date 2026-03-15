import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("Test Suite CRUD logic", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  let projectId: string;
  let planId: string;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "src/lib/db/migrations" });

    projectId = crypto.randomUUID();
    planId = crypto.randomUUID();
    db.insert(schema.projects)
      .values({ id: projectId, name: "P", targetRepoPath: "/tmp" })
      .run();
    db.insert(schema.plans)
      .values({ id: planId, projectId, name: "Plan", status: "testing" })
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it("should create a test suite for a plan", () => {
    const suiteId = crypto.randomUUID();
    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "pending" })
      .run();

    const suite = db
      .select()
      .from(schema.testSuites)
      .where(eq(schema.testSuites.id, suiteId))
      .get();
    expect(suite!.status).toBe("pending");
    expect(suite!.planId).toBe(planId);
  });

  it("should create test cases linked to suite", () => {
    const suiteId = crypto.randomUUID();
    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "pending" })
      .run();

    db.insert(schema.testCases)
      .values({
        id: crypto.randomUUID(),
        testSuiteId: suiteId,
        name: "test_auth",
        description: "Test authentication",
        type: "unit",
        status: "pending",
      })
      .run();
    db.insert(schema.testCases)
      .values({
        id: crypto.randomUUID(),
        testSuiteId: suiteId,
        name: "test_api",
        description: "Test API endpoints",
        type: "integration",
        status: "pending",
      })
      .run();

    const cases = db
      .select()
      .from(schema.testCases)
      .where(eq(schema.testCases.testSuiteId, suiteId))
      .all();
    expect(cases).toHaveLength(2);
  });

  it("should create test results linked to case", () => {
    const suiteId = crypto.randomUUID();
    const caseId = crypto.randomUUID();
    const resultId = crypto.randomUUID();

    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "running" })
      .run();
    db.insert(schema.testCases)
      .values({
        id: caseId,
        testSuiteId: suiteId,
        name: "test_login",
        type: "unit",
        status: "running",
      })
      .run();
    db.insert(schema.testResults)
      .values({
        id: resultId,
        testCaseId: caseId,
        status: "passed",
        output: "All assertions passed\n2 tests, 0 failures",
        durationMs: 150,
      })
      .run();

    const results = db
      .select()
      .from(schema.testResults)
      .where(eq(schema.testResults.testCaseId, caseId))
      .all();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].durationMs).toBe(150);
  });

  it("should cascade delete test cases when suite is deleted", () => {
    const suiteId = crypto.randomUUID();
    const caseId = crypto.randomUUID();

    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "pending" })
      .run();
    db.insert(schema.testCases)
      .values({
        id: caseId,
        testSuiteId: suiteId,
        name: "test",
        type: "unit",
        status: "pending",
      })
      .run();

    db.delete(schema.testSuites)
      .where(eq(schema.testSuites.id, suiteId))
      .run();

    const cases = db
      .select()
      .from(schema.testCases)
      .where(eq(schema.testCases.testSuiteId, suiteId))
      .all();
    expect(cases).toHaveLength(0);
  });

  it("should track multiple test runs for same case", () => {
    const suiteId = crypto.randomUUID();
    const caseId = crypto.randomUUID();

    db.insert(schema.testSuites)
      .values({ id: suiteId, planId, status: "running" })
      .run();
    db.insert(schema.testCases)
      .values({
        id: caseId,
        testSuiteId: suiteId,
        name: "flaky_test",
        type: "e2e",
        status: "failed",
      })
      .run();

    // First run: failed
    db.insert(schema.testResults)
      .values({
        id: crypto.randomUUID(),
        testCaseId: caseId,
        status: "failed",
        output: "Timeout",
        errorMessage: "Connection timeout",
        durationMs: 5000,
      })
      .run();

    // Second run: passed
    db.insert(schema.testResults)
      .values({
        id: crypto.randomUUID(),
        testCaseId: caseId,
        status: "passed",
        output: "OK",
        durationMs: 200,
      })
      .run();

    const results = db
      .select()
      .from(schema.testResults)
      .where(eq(schema.testResults.testCaseId, caseId))
      .all();
    expect(results).toHaveLength(2);
  });
});
