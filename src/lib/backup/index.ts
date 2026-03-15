import { getDb } from "@/lib/db";
import {
  projects,
  plans,
  schemes,
  scheduleItems,
  schedules,
  testSuites,
  testCases,
  testResults,
  backupConfigs,
  backupHistory,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { BackupBackend, ExportProject } from "./types";
import { localBackend } from "./local-backend";
import { obsidianBackend } from "./obsidian-backend";
import { notionBackend } from "./notion-backend";

const backends: Record<string, BackupBackend> = {
  local: localBackend,
  obsidian: obsidianBackend,
  notion: notionBackend,
};

export function getBackend(name: string): BackupBackend | undefined {
  return backends[name];
}

export function collectExportData(): ExportProject[] {
  const db = getDb();
  const allProjects = db.select().from(projects).all();

  return allProjects.map((project) => {
    const projectPlans = db
      .select()
      .from(plans)
      .where(eq(plans.projectId, project.id))
      .all();

    return {
      name: project.name,
      description: project.description || "",
      targetRepoPath: project.targetRepoPath,
      plans: projectPlans.map((plan) => {
        const planSchemes = db
          .select()
          .from(schemes)
          .where(eq(schemes.planId, plan.id))
          .all();

        const schedule = db
          .select()
          .from(schedules)
          .where(eq(schedules.planId, plan.id))
          .get();

        const items = schedule
          ? db
              .select()
              .from(scheduleItems)
              .where(eq(scheduleItems.scheduleId, schedule.id))
              .all()
          : [];

        const suite = db
          .select()
          .from(testSuites)
          .where(eq(testSuites.planId, plan.id))
          .get();

        const cases = suite
          ? db
              .select()
              .from(testCases)
              .where(eq(testCases.testSuiteId, suite.id))
              .all()
          : [];

        const results = cases.flatMap((tc) => {
          const tcResults = db
            .select()
            .from(testResults)
            .where(eq(testResults.testCaseId, tc.id))
            .all();
          return tcResults.map((r) => ({
            name: tc.name,
            status: r.status,
            output: r.output || "",
          }));
        });

        return {
          name: plan.name,
          description: plan.description || "",
          status: plan.status,
          schemes: planSchemes.map((s) => ({
            title: s.title,
            content: s.content || "",
          })),
          scheduleItems: items.map((i) => ({
            title: i.title,
            description: i.description || "",
            status: i.status,
          })),
          testResults: results,
        };
      }),
    };
  });
}

export async function runBackup(
  configId: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const config = db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, configId))
    .get();

  if (!config) return { success: false, error: "Config not found" };

  const backend = getBackend(config.backend);
  if (!backend) return { success: false, error: `Unknown backend: ${config.backend}` };

  const historyId = crypto.randomUUID();
  db.insert(backupHistory)
    .values({ id: historyId, backupConfigId: configId, status: "running" })
    .run();

  try {
    const data = collectExportData();
    const configObj = JSON.parse(config.config);
    await backend.backup(data, configObj);

    const itemsCount = data.reduce(
      (sum, p) => sum + p.plans.length,
      0
    );

    db.update(backupHistory)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
        itemsCount,
      })
      .where(eq(backupHistory.id, historyId))
      .run();

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    db.update(backupHistory)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: errorMsg,
      })
      .where(eq(backupHistory.id, historyId))
      .run();

    return { success: false, error: errorMsg };
  }
}
