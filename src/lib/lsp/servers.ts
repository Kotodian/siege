import { execSync } from "child_process";

interface ServerConfig {
  command: string;
  args: string[];
  languageId: string;
}

const SERVER_CONFIGS: Record<string, ServerConfig> = {
  typescript: { command: "npx", args: ["typescript-language-server", "--stdio"], languageId: "typescript" },
  javascript: { command: "npx", args: ["typescript-language-server", "--stdio"], languageId: "javascript" },
  rust: { command: "rust-analyzer", args: [], languageId: "rust" },
  go: { command: "gopls", args: ["serve"], languageId: "go" },
  python: { command: "pylsp", args: [], languageId: "python" },
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".rs": "rust",
  ".go": "go",
  ".py": "python",
};

export function getLanguageFromPath(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXT_TO_LANG[ext] || null;
}

export function getServerConfig(language: string): ServerConfig | null {
  return SERVER_CONFIGS[language] || null;
}

export function isServerAvailable(language: string): boolean {
  const config = SERVER_CONFIGS[language];
  if (!config) return false;

  // npx-based servers are always "available" if node is installed
  if (config.command === "npx") return true;

  try {
    execSync(`which ${config.command}`, { encoding: "utf-8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
