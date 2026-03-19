import type { ImportSource, ImportableItem } from "./types";

const GITHUB_API = "https://api.github.com";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function labelsToTag(labels: Array<{ name: string }>): string {
  for (const label of labels) {
    const name = label.name.toLowerCase();
    if (name.includes("bug")) return "bug";
    if (name.includes("feature") || name.includes("enhancement")) return "feature";
    if (name.includes("refactor")) return "refactor";
    if (name.includes("doc")) return "docs";
    if (name.includes("test")) return "test";
    if (name.includes("perf")) return "perf";
  }
  return "feature";
}

export const githubSource: ImportSource = {
  name: "github",

  async validate(config) {
    const { token } = config;
    if (!token) return false;
    try {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers: githubHeaders(token),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { token, repo } = config;
    const headers = githubHeaders(token);
    const items: ImportableItem[] = [];

    if (repo) {
      // List issues from specific repo
      const params = new URLSearchParams({
        state: "open",
        per_page: "20",
        sort: "updated",
        direction: "desc",
      });
      const url = query
        ? `${GITHUB_API}/search/issues?q=${encodeURIComponent(query + ` repo:${repo} is:issue`)}&per_page=20`
        : `${GITHUB_API}/repos/${repo}/issues?${params}`;

      const res = await fetch(url, { headers });
      if (!res.ok) return [];

      if (query) {
        const data = (await res.json()) as {
          items: Array<{
            number: number;
            title: string;
            html_url: string;
            labels: Array<{ name: string }>;
            state: string;
          }>;
        };
        for (const issue of data.items) {
          items.push({
            id: `${repo}#${issue.number}`,
            title: `#${issue.number} ${issue.title}`,
            description: issue.labels.map((l) => l.name).join(", ") || issue.state,
            source: "github",
            sourceUrl: issue.html_url,
          });
        }
      } else {
        const data = (await res.json()) as Array<{
          number: number;
          title: string;
          html_url: string;
          labels: Array<{ name: string }>;
          state: string;
          pull_request?: unknown;
        }>;
        // Filter out PRs (issues endpoint returns PRs too)
        for (const issue of data.filter((i) => !i.pull_request)) {
          items.push({
            id: `${repo}#${issue.number}`,
            title: `#${issue.number} ${issue.title}`,
            description: issue.labels.map((l) => l.name).join(", ") || issue.state,
            source: "github",
            sourceUrl: issue.html_url,
          });
        }
      }
    } else if (query) {
      // Search across all repos
      const res = await fetch(
        `${GITHUB_API}/search/issues?q=${encodeURIComponent(query + " is:issue")}&per_page=20`,
        { headers }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        items: Array<{
          number: number;
          title: string;
          html_url: string;
          repository_url: string;
          labels: Array<{ name: string }>;
        }>;
      };

      for (const issue of data.items) {
        const repoName = issue.repository_url.replace(`${GITHUB_API}/repos/`, "");
        items.push({
          id: `${repoName}#${issue.number}`,
          title: `${repoName}#${issue.number} ${issue.title}`,
          description: issue.labels.map((l) => l.name).join(", "),
          source: "github",
          sourceUrl: issue.html_url,
        });
      }
    }

    return items;
  },

  async fetchItem(config, itemId) {
    const { token } = config;
    const headers = githubHeaders(token);

    // itemId format: "owner/repo#number"
    const match = itemId.match(/^(.+)#(\d+)$/);
    if (!match) throw new Error(`Invalid GitHub issue ID: ${itemId}`);
    const [, repo, numberStr] = match;
    const number = parseInt(numberStr, 10);

    // Fetch issue
    const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${number}`, {
      headers,
    });
    if (!res.ok) throw new Error(`GitHub issue fetch failed: ${res.status}`);

    const issue = (await res.json()) as {
      number: number;
      title: string;
      body: string | null;
      labels: Array<{ name: string }>;
      html_url: string;
    };

    const tag = labelsToTag(issue.labels);
    const body = issue.body || "";

    // Parse body — H2 sections become schemes, or use whole body as single scheme
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
      planName: `#${issue.number} ${issue.title}`,
      planDescription: description.trim(),
      planTag: tag,
      schemes,
    };
  },
};
