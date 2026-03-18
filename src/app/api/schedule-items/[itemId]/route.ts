import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scheduleItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const body = await req.json();
  const { title, description, startDate, endDate, order, engine, skills, status } = body;
  const db = getDb();

  db.update(scheduleItems)
    .set({
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(startDate !== undefined && { startDate }),
      ...(endDate !== undefined && { endDate }),
      ...(order !== undefined && { order }),
      ...(engine !== undefined && { engine }),
      ...(skills !== undefined && { skills }),
      ...(status !== undefined && { status }),
    })
    .where(eq(scheduleItems.id, itemId))
    .run();

  const item = db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, itemId))
    .get();
  return NextResponse.json(item);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const db = getDb();
  db.delete(scheduleItems).where(eq(scheduleItems.id, itemId)).run();
  return NextResponse.json({ success: true });
}
