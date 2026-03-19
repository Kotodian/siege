import type { ImportSource, ImportableItem } from "./types";

function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
  };
}

function labelsToTag(labels: string[]): string {
  for (const label of labels) {
    const name = label.toLowerCase();
    if (name.includes("bug")) return "bug";
    if (name.includes("feature") || name.includes("enhancement")) return "feature";
    if (name.includes("refactor")) return "refactor";
    if (name.includes("doc")) return "docs";
    if (name.includes("test")) return "test";
    if (name.includes("perf")) return "perf";
  }
  return "feature";
}

export const gitlabSource: ImportSource = {
  name: "gitlab",

  async validate(config) {
    const { base_url, token } = config;
    if (!base_url || !token) return false;
    try {
      const res = await fetch(`${base_url}/api/v4/user`, {
        headers: gitlabHeaders(token),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { base_url, token, project_id } = config;
    const headers = gitlabHeaders(token);
    const items: ImportableItem[] = [];

    if (project_id) {
      // List issues from specific project
      const params = new URLSearchParams({
        state: "opened",
        per_page: "20",
        order_by: "updated_at",
        sort: "desc",
      });
      if (query) params.set("search", query);

      const res = await fetch(
        `${base_url}/api/v4/projects/${encodeURIComponent(project_id)}/issues?${params}`,
        { headers }
      );
      if (!res.ok) return [];

      const data = (await res.json()) as Array<{
        iid: number;
        title: string;
        web_url: string;
        labels: string[];
        state: string;
      }>;

      for (const issue of data) {
        items.push({
          id: `${project_id}#${issue.iid}`,
          title: `#${issue.iid} ${issue.title}`,
          description: issue.labels.join(", ") || issue.state,
          source: "gitlab",
          sourceUrl: issue.web_url,
        });
      }
    } else if (query) {
      // Search across all projects
      const params = new URLSearchParams({
        scope: "issues",
        search: query,
        per_page: "20",
      });
      const res = await fetch(
        `${base_url}/api/v4/search?${params}`,
        { headers }
      );
      if (!res.ok) return [];

      const data = (await res.json()) as Array<{
        iid: number;
        project_id: number;
        title: string;
        web_url: string;
        labels: string[];
      }>;

      for (const issue of data) {
        items.push({
          id: `${issue.project_id}#${issue.iid}`,
          title: `#${issue.iid} ${issue.title}`,
          description: issue.labels.join(", "),
          source: "gitlab",
          sourceUrl: issue.web_url,
        });
      }
    }

    return items;
  },

  async fetchItem(config, itemId) {
    const { base_url, token } = config;
    const headers = gitlabHeaders(token);

    // itemId format: "projectId#iid"
    const match = itemId.match(/^(.+)#(\d+)$/);
    if (!match) throw new Error(`Invalid GitLab issue ID: ${itemId}`);
    const [, projectId, iidStr] = match;
    const iid = parseInt(iidStr, 10);

    const res = await fetch(
      `${base_url}/api/v4/projects/${encodeURIComponent(projectId)}/issues/${iid}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitLab issue fetch failed: ${res.status}`);

    const issue = (await res.json()) as {
      iid: number;
      title: string;
      description: string | null;
      labels: string[];
      web_url: string;
    };

    const tag = labelsToTag(issue.labels);
    const body = issue.description || "";

    // Parse body — H2 sections become schemes
    const schemes: Array<{ title: string; content: string }> = [];
    let description = "";
    let current: { title: string; lines: string[] } | null = null;

    for (const line of body.split("\n")) {
      const h2 = line.match(/^## (.+)/);
      if (h2) {
        if (current) {
          schemes.push({ title: current.title, content: current.lines.join("\n").trim() });
        }
        current = { title: h2[1], lines: [] };
      } else if (current) {
        current.lines.push(line);
      } else {
        description += line + "\n";
      }
    }
    if (current) {
      schemes.push({ title: current.title, content: current.lines.join("\n").trim() });
    }

    if (schemes.length === 0) {
      schemes.push({ title: issue.title, content: body });
    }

    return {
      planName: `#${issue.iid} ${issue.title}`,
      planDescription: description.trim(),
      planTag: tag,
      schemes,
    };
  },
};
