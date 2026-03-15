import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";

interface ProviderStatus {
  configured: boolean;
  masked: string;
  baseURL: string;
  mode: "apikey" | "proxy" | "none";
}

interface AiConfigStatus {
  anthropic: ProviderStatus;
  openai: ProviderStatus;
  glm: ProviderStatus;
}

function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

function getSetting(key: string): string | undefined {
  const db = getDb();
  const s = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return s?.value || undefined;
}

function saveSetting(key: string, value: string) {
  const db = getDb();
  const existing = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();

  if (existing) {
    db.update(appSettings)
      .set({ value })
      .where(eq(appSettings.key, key))
      .run();
  } else {
    db.insert(appSettings)
      .values({ id: crypto.randomUUID(), key, value })
      .run();
  }
}

type ProviderName = "anthropic" | "openai" | "glm";

const ENV_KEYS: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  glm: "GLM_API_KEY",
};

function getProviderStatus(provider: ProviderName): ProviderStatus {
  const envKey = ENV_KEYS[provider];
  const settingKeyApi = `${provider}_api_key`;
  const settingKeyUrl = `${provider}_base_url`;

  const apiKey = process.env[envKey] || getSetting(settingKeyApi);
  const baseURL = getSetting(settingKeyUrl) || "";

  let mode: "apikey" | "proxy" | "none" = "none";
  if (baseURL && apiKey) mode = "proxy";
  else if (apiKey) mode = "apikey";
  else if (baseURL) mode = "proxy";

  return {
    configured: !!apiKey || !!baseURL,
    masked: maskKey(apiKey),
    baseURL,
    mode,
  };
}

function checkClaudeLogin(): { loggedIn: boolean; installed: boolean } {
  try {
    execSync("which claude", { encoding: "utf-8", timeout: 3000 });
  } catch {
    return { loggedIn: false, installed: false };
  }
  try {
    // claude auth status or similar — check if API key is available via claude CLI
    const output = execSync("claude auth status 2>&1 || true", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const loggedIn = output.includes("logged in") || output.includes("authenticated");
    return { loggedIn, installed: true };
  } catch {
    return { loggedIn: false, installed: true };
  }
}

// GET: check AI config status
export async function GET() {
  const claude = checkClaudeLogin();
  const status = {
    anthropic: getProviderStatus("anthropic"),
    openai: getProviderStatus("openai"),
    glm: getProviderStatus("glm"),
    claude: { installed: claude.installed, loggedIn: claude.loggedIn },
  };
  return NextResponse.json(status);
}

// POST: save AI config
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider, apiKey, baseURL } = body as {
    provider: ProviderName;
    apiKey?: string;
    baseURL?: string;
  };

  if (!provider) {
    return NextResponse.json(
      { error: "provider is required" },
      { status: 400 }
    );
  }

  if (!apiKey && !baseURL) {
    return NextResponse.json(
      { error: "apiKey or baseURL is required" },
      { status: 400 }
    );
  }

  // Save to DB settings
  if (apiKey) {
    saveSetting(`${provider}_api_key`, apiKey);
    // Also set in process.env for immediate use
    const envKey = ENV_KEYS[provider];
    process.env[envKey] = apiKey;
  }

  if (baseURL !== undefined) {
    if (baseURL) {
      saveSetting(`${provider}_base_url`, baseURL);
    } else {
      // Clear base URL
      const db = getDb();
      db.delete(appSettings)
        .where(eq(appSettings.key, `${provider}_base_url`))
        .run();
    }
  }

  return NextResponse.json(getProviderStatus(provider));
}
