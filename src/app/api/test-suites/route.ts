import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { testSuites, testCases, testResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const suite = db
    .select()
    .from(testSuites)
    .where(eq(testSuites.planId, planId))
    .get();

  if (!suite) {
    return NextResponse.json(null);
  }

  const cases = db
    .select()
    .from(testCases)
    .where(eq(testCases.testSuiteId, suite.id))
    .all();

  // Get latest result for each case
  const casesWithResults = await Promise.all(
    cases.map(async (tc) => {
      const results = db
        .select()
        .from(testResults)
        .where(eq(testResults.testCaseId, tc.id))
        .all();
      return { ...tc, results };
    })
  );

  return NextResponse.json({ ...suite, cases: casesWithResults });
}
