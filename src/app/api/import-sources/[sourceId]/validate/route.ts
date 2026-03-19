import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { importConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getImportSource } from "@/lib/import";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const { sourceId } = await params;
  const db = getDb();

  const config = db
    .select()
    .from(importConfigs)
    .where(eq(importConfigs.id, sourceId))
    .get();

  if (!config) {
    return NextResponse.json(
      { error: "Import config not found" },
      { status: 404 }
    );
  }

  const source = getImportSource(config.source);
  if (!source) {
    return NextResponse.json(
      { error: `Unknown source: ${config.source}` },
      { status: 400 }
    );
  }

  const configObj = JSON.parse(config.config) as Record<string, string>;
  const valid = await source.validate(configObj);

  return NextResponse.json({ valid });
}
