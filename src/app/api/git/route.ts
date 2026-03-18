import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// GET: check if path is a git repo + current branch
export async function GET(req: NextRequest) {
  const repoPath = req.nextUrl.searchParams.get("path");
  if (!repoPath) return NextResponse.json({ error: "path required" }, { status: 400 });

  const isGit = fs.existsSync(path.join(repoPath, ".git"));
  if (!isGit) return NextResponse.json({ isGit: false });

  try {
    const branch = execSync("git branch --show-current", { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
    const branches = execSync("git branch --list", { cwd: repoPath, encoding: "utf-8", timeout: 5000 })
      .split("\n").map(b => b.replace(/^\*?\s+/, "").trim()).filter(Boolean);
    return NextResponse.json({ isGit: true, currentBranch: branch, branches });
  } catch {
    return NextResponse.json({ isGit: true, currentBranch: "unknown", branches: [] });
  }
}

// POST: create and checkout a new branch
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { repoPath, branchName, baseBranch } = body;

  if (!repoPath || !branchName) {
    return NextResponse.json({ error: "repoPath and branchName required" }, { status: 400 });
  }

  try {
    // Create branch from specified base, or from current HEAD
    if (baseBranch) {
      execSync(`git checkout -b "${branchName}" "${baseBranch}"`, { cwd: repoPath, encoding: "utf-8", timeout: 10000 });
    } else {
      execSync(`git checkout -b "${branchName}"`, { cwd: repoPath, encoding: "utf-8", timeout: 10000 });
    }
    const current = execSync("git branch --show-current", { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
    return NextResponse.json({ success: true, branch: current });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
