import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("Review CRUD logic", () => {
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
      .values({ id: planId, projectId, name: "Plan", status: "reviewing" })
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it("should create a scheme review", () => {
    const reviewId = crypto.randomUUID();
    db.insert(schema.reviews)
      .values({
        id: reviewId,
        planId,
        type: "scheme",
        status: "pending",
      })
      .run();

    const review = db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, reviewId))
      .get();
    expect(review!.type).toBe("scheme");
    expect(review!.status).toBe("pending");
  });

  it("should create an implementation review", () => {
    const reviewId = crypto.randomUUID();
    db.insert(schema.reviews)
      .values({
        id: reviewId,
        planId,
        type: "implementation",
        status: "in_progress",
        content: "## Code Review\nLooks good overall",
      })
      .run();

    const review = db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, reviewId))
      .get();
    expect(review!.type).toBe("implementation");
    expect(review!.content).toContain("Code Review");
  });

  it("should create review items with severity", () => {
    const reviewId = crypto.randomUUID();
    db.insert(schema.reviews)
      .values({ id: reviewId, planId, type: "scheme", status: "in_progress" })
      .run();

    db.insert(schema.reviewItems)
      .values({
        id: crypto.randomUUID(),
        reviewId,
        targetType: "scheme",
        targetId: "scheme-1",
        title: "Missing error handling",
        content: "The API scheme doesn't address error scenarios",
        severity: "critical",
        resolved: false,
      })
      .run();

    db.insert(schema.reviewItems)
      .values({
        id: crypto.randomUUID(),
        reviewId,
        targetType: "scheme",
        targetId: "scheme-1",
        title: "Consider caching",
        content: "Add a caching layer for frequently accessed data",
        severity: "info",
        resolved: false,
      })
      .run();

    const items = db
      .select()
      .from(schema.reviewItems)
      .where(eq(schema.reviewItems.reviewId, reviewId))
      .all();
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.severity === "critical")).toBeTruthy();
  });

  it("should resolve review items", () => {
    const reviewId = crypto.randomUUID();
    const itemId = crypto.randomUUID();

    db.insert(schema.reviews)
      .values({ id: reviewId, planId, type: "scheme", status: "in_progress" })
      .run();
    db.insert(schema.reviewItems)
      .values({
        id: itemId,
        reviewId,
        targetType: "scheme",
        targetId: "s1",
        title: "Issue",
        content: "Fix this",
        severity: "warning",
        resolved: false,
      })
      .run();

    db.update(schema.reviewItems)
      .set({ resolved: true })
      .where(eq(schema.reviewItems.id, itemId))
      .run();

    const item = db
      .select()
      .from(schema.reviewItems)
      .where(eq(schema.reviewItems.id, itemId))
      .get();
    expect(item!.resolved).toBe(true);
  });

  it("should cascade delete reviews when plan is deleted", () => {
    const reviewId = crypto.randomUUID();
    db.insert(schema.reviews)
      .values({ id: reviewId, planId, type: "scheme", status: "pending" })
      .run();
    db.insert(schema.reviewItems)
      .values({
        id: crypto.randomUUID(),
        reviewId,
        targetType: "scheme",
        targetId: "s1",
        title: "T",
        content: "C",
        severity: "info",
        resolved: false,
      })
      .run();

    db.delete(schema.plans).where(eq(schema.plans.id, planId)).run();

    const reviews = db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.planId, planId))
      .all();
    expect(reviews).toHaveLength(0);
  });

  it("should track review status transitions", () => {
    const reviewId = crypto.randomUUID();
    db.insert(schema.reviews)
      .values({ id: reviewId, planId, type: "scheme", status: "pending" })
      .run();

    // pending → in_progress
    db.update(schema.reviews)
      .set({ status: "in_progress" })
      .where(eq(schema.reviews.id, reviewId))
      .run();

    // in_progress → changes_requested
    db.update(schema.reviews)
      .set({ status: "changes_requested" })
      .where(eq(schema.reviews.id, reviewId))
      .run();

    // changes_requested → approved
    db.update(schema.reviews)
      .set({ status: "approved" })
      .where(eq(schema.reviews.id, reviewId))
      .run();

    const review = db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, reviewId))
      .get();
    expect(review!.status).toBe("approved");
  });
});
