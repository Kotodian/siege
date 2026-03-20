import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const settings = db.select().from(appSettings).all();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return NextResponse.json(result);
}

const ALLOWED_SETTINGS = new Set([
  "default_provider",
  "default_model",
  "default_model_anthropic",
  "default_model_openai",
  "default_model_glm",
  "archive_after_days",
  "cleanup_after_days",
  "step_provider_scheme",
  "step_model_scheme",
  "step_provider_review",
  "step_model_review",
  "step_provider_schedule",
  "step_model_schedule",
  "step_provider_execute",
  "step_model_execute",
  "step_provider_test",
  "step_model_test",
  "step_provider_skills",
  "step_model_skills",
]);

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_SETTINGS.has(key)) continue;

    const existing = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();

    if (existing) {
      db.update(appSettings)
        .set({ value: String(value) })
        .where(eq(appSettings.key, key))
        .run();
    } else {
      db.insert(appSettings)
        .values({ id: crypto.randomUUID(), key, value: String(value) })
        .run();
    }
  }

  return NextResponse.json({ ok: true });
}
