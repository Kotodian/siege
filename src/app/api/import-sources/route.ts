import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { importConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function maskConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (
      key.includes("key") ||
      key.includes("token") ||
      key.includes("password")
    ) {
      masked[key] =
        value.length > 8
          ? value.slice(0, 4) + "****" + value.slice(-4)
          : "****";
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export async function GET() {
  const db = getDb();
  const configs = db.select().from(importConfigs).all();

  const result = configs.map((c) => {
    const parsed = JSON.parse(c.config) as Record<string, string>;
    return {
      ...c,
      config: maskConfig(parsed),
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { source, config } = body;

  if (!source || !config) {
    return NextResponse.json(
      { error: "source and config are required" },
      { status: 400 }
    );
  }

  const validSources = ["notion", "jira", "confluence", "mcp", "feishu", "github", "gitlab"];
  if (!validSources.includes(source)) {
    return NextResponse.json(
      { error: `Invalid source: ${source}` },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(importConfigs)
    .values({
      id,
      source,
      config: JSON.stringify(config),
    })
    .run();

  const created = db
    .select()
    .from(importConfigs)
    .where(eq(importConfigs.id, id))
    .get();

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  db.delete(importConfigs).where(eq(importConfigs.id, id)).run();

  return NextResponse.json({ success: true });
}
