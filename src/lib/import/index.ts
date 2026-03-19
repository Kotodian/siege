import type { ImportSource } from "./types";
import { notionSource } from "./notion-source";
import { jiraSource } from "./jira-source";
import { confluenceSource } from "./confluence-source";
import { mcpSource } from "./mcp-source";
import { feishuSource } from "./feishu-source";
import { githubSource } from "./github-source";
import { gitlabSource } from "./gitlab-source";

const sources: Record<string, ImportSource> = {
  notion: notionSource,
  jira: jiraSource,
  confluence: confluenceSource,
  feishu: feishuSource,
  github: githubSource,
  gitlab: gitlabSource,
  mcp: mcpSource,
};

export function getImportSource(name: string): ImportSource | undefined {
  return sources[name];
}

export function listImportSources(): string[] {
  return Object.keys(sources);
}
