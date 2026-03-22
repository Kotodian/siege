import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviewItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const body = await req.json();
  const { resolved, resolution } = body;
  const db = getDb();

  db.update(reviewItems)
    .set({
      ...(resolved !== undefined && { resolved }),
      ...(resolution !== undefined && { resolution }),
    })
    .where(eq(reviewItems.id, itemId))
    .run();

  const item = db
    .select()
    .from(reviewItems)
    .where(eq(reviewItems.id, itemId))
    .get();
  return NextResponse.json(item);
}
