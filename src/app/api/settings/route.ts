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

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  for (const [key, value] of Object.entries(body)) {
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
