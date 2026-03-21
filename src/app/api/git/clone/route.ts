import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { parseJsonBody } from "@/lib/utils";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * POST /api/git/clone
 * Clone any git repository (GitLab, Gitea, Bitbucket, etc.)
 * Uses plain `git clone`, not gh CLI.
 */
export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { url, targetDir } = body as { url: string; targetDir?: string };

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Extract repo name from URL
  const repoName = url.split("/").pop()?.replace(".git", "") || "repo";
  const cloneTarget = targetDir || path.join(os.homedir(), "projects", repoName);

  if (fs.existsSync(cloneTarget)) {
    return NextResponse.json({ path: cloneTarget, alreadyExists: true });
  }

  try {
    fs.mkdirSync(path.dirname(cloneTarget), { recursive: true });
    execSync(`git clone ${JSON.stringify(url)} ${JSON.stringify(cloneTarget)} 2>&1`, {
      encoding: "utf-8",
      timeout: 120000,
    });
    return NextResponse.json({ path: cloneTarget, alreadyExists: false }, { status: 201 });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const msg = (err.stderr || err.stdout || err.message || "Clone failed").trim();
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
