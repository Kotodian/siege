import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { backupConfigs, backupHistory } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { runBackup } from "@/lib/backup";

// List backup configs with latest history
export async function GET() {
  const db = getDb();
  const configs = db.select().from(backupConfigs).all();

  const result = configs.map((config) => {
    const history = db
      .select()
      .from(backupHistory)
      .where(eq(backupHistory.backupConfigId, config.id))
      .orderBy(desc(backupHistory.startedAt))
      .limit(5)
      .all();

    return { ...config, history };
  });

  return NextResponse.json(result);
}

// Create backup config
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { backend, config, scheduleCron, enabled } = body;

  if (!backend) {
    return NextResponse.json(
      { error: "backend is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(backupConfigs)
    .values({
      id,
      backend,
      config: JSON.stringify(config || {}),
      scheduleCron: scheduleCron || "0 2 * * *",
      enabled: enabled !== false,
    })
    .run();

  const created = db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, id))
    .get();
  return NextResponse.json(created, { status: 201 });
}

// Trigger backup manually
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { configId } = body;

  if (!configId) {
    return NextResponse.json(
      { error: "configId is required" },
      { status: 400 }
    );
  }

  const result = await runBackup(configId);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
