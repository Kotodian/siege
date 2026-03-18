import { NextResponse } from "next/server";
import { execSync, spawn, type ChildProcess } from "child_process";

// Track the active login process so it persists across requests
let loginProcess: ChildProcess | null = null;

// GET: check GitHub auth status
export async function GET() {
  try {
    execSync("which gh", { encoding: "utf-8", timeout: 3000 });
  } catch {
    return NextResponse.json({ authenticated: false, ghInstalled: false, username: "" });
  }

  try {
    const output = execSync("gh auth status 2>&1", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const userMatch = output.match(/Logged in to github\.com account (\S+)/);
    if (userMatch) {
      // Clean up login process if it's still around
      if (loginProcess) {
        loginProcess.kill();
        loginProcess = null;
      }
      return NextResponse.json({
        authenticated: true,
        ghInstalled: true,
        username: userMatch[1],
      });
    }
    return NextResponse.json({ authenticated: false, ghInstalled: true, username: "" });
  } catch {
    return NextResponse.json({ authenticated: false, ghInstalled: true, username: "" });
  }
}

// POST: start GitHub OAuth device flow via gh CLI
export async function POST() {
  // Check if gh is installed
  try {
    execSync("which gh", { encoding: "utf-8", timeout: 3000 });
  } catch {
    return NextResponse.json(
      { error: "gh_not_installed" },
      { status: 503 }
    );
  }

  // Already authenticated?
  try {
    const output = execSync("gh auth status 2>&1", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const userMatch = output.match(/Logged in to github\.com account (\S+)/);
    if (userMatch) {
      return NextResponse.json({
        status: "already_authenticated",
        username: userMatch[1],
      });
    }
  } catch {
    // Not authenticated, proceed
  }

  // Kill existing login process if any
  if (loginProcess) {
    loginProcess.kill();
    loginProcess = null;
  }

  // Spawn gh auth login --web and capture the device code
  return new Promise<NextResponse>((resolve) => {
    let output = "";
    let resolved = false;

    const proc = spawn("gh", [
      "auth", "login",
      "--web",
      "-p", "https",
      "-h", "github.com",
      "--skip-ssh-key",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    loginProcess = proc;

    const handleData = (data: Buffer) => {
      output += data.toString();
      // Parse: "! First copy your one-time code: XXXX-XXXX"
      const codeMatch = output.match(/one-time code:\s*(\S+)/);
      if (codeMatch && !resolved) {
        resolved = true;
        resolve(NextResponse.json({
          status: "pending",
          code: codeMatch[1],
          verificationUrl: "https://github.com/login/device",
        }));
      }
    };

    proc.stdout.on("data", handleData);
    proc.stderr.on("data", handleData);

    proc.on("close", () => {
      if (loginProcess === proc) loginProcess = null;
      if (!resolved) {
        resolved = true;
        resolve(NextResponse.json(
          { error: "login_process_ended" },
          { status: 500 }
        ));
      }
    });

    // Timeout after 30s if we never get a code
    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        loginProcess = null;
        resolved = true;
        resolve(NextResponse.json(
          { error: "timeout" },
          { status: 500 }
        ));
      }
    }, 30000);
  });
}
