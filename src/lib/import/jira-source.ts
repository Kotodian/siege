import type { ImportSource } from "./types";

function jiraHeaders(email: string, apiToken: string): Record<string, string> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Convert Atlassian Document Format (ADF) to markdown
function adfToMarkdown(node: {
  type: string;
  content?: Array<Record<string, unknown>>;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string }>;
}): string {
  if (!node) return "";

  if (node.type === "text") {
    let text = node.text || "";
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
      }
    }
    return text;
  }

  const children = (node.content || [])
    .map((child) => adfToMarkdown(child as typeof node))
    .join("");

  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return children + "\n\n";
    case "heading": {
      const level = (node.attrs?.level as number) || 1;
      return "#".repeat(level) + " " + children + "\n\n";
    }
    case "bulletList":
      return (node.content || [])
        .map((li) => "- " + adfToMarkdown(li as typeof node).trim())
        .join("\n") + "\n\n";
    case "orderedList":
      return (node.content || [])
        .map(
          (li, i) =>
            `${i + 1}. ` + adfToMarkdown(li as typeof node).trim()
        )
        .join("\n") + "\n\n";
    case "listItem":
      return children;
    case "codeBlock": {
      const lang = (node.attrs?.language as string) || "";
      return "```" + lang + "\n" + children + "```\n\n";
    }
    case "blockquote":
      return children
        .split("\n")
        .map((l: string) => "> " + l)
        .join("\n") + "\n\n";
    case "rule":
      return "---\n\n";
    default:
      return children;
  }
}

function issueTypeToTag(issueType: string): string {
  const lower = issueType.toLowerCase();
  if (lower.includes("bug")) return "bug";
  if (lower.includes("epic") || lower.includes("story")) return "feature";
  if (lower.includes("task")) return "chore";
  return "feature";
}

export const jiraSource: ImportSource = {
  name: "jira",

  async validate(config) {
    const { base_url, email, api_token } = config;
    if (!base_url || !email || !api_token) return false;
    try {
      const res = await fetch(`${base_url}/rest/api/3/myself`, {
        headers: jiraHeaders(email, api_token),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { base_url, email, api_token } = config;
    const headers = jiraHeaders(email, api_token);

    const jql = query
      ? `text ~ "${query}" ORDER BY updated DESC`
      : "ORDER BY updated DESC";
    const res = await fetch(
      `${base_url}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,issuetype,status`,
      { headers }
    );
    if (!res.ok) return [];

    const data = (await res.json()) as {
      issues: Array<{
        id: string;
        key: string;
        self: string;
        fields: {
          summary: string;
          issuetype?: { name: string };
          status?: { name: string };
        };
      }>;
    };

    return data.issues.map((issue) => ({
      id: issue.key,
      title: `[${issue.key}] ${issue.fields.summary}`,
      description: `${issue.fields.issuetype?.name || ""} - ${issue.fields.status?.name || ""}`,
      source: "jira",
      sourceUrl: `${base_url}/browse/${issue.key}`,
    }));
  },

  async fetchItem(config, itemId) {
    const { base_url, email, api_token } = config;
    const headers = jiraHeaders(email, api_token);

    // Fetch the issue with description and subtasks
    const res = await fetch(
      `${base_url}/rest/api/3/issue/${itemId}?fields=summary,description,issuetype,subtasks`,
      { headers }
    );
    if (!res.ok) throw new Error(`Jira issue fetch failed: ${res.status}`);

    const issue = (await res.json()) as {
      key: string;
      fields: {
        summary: string;
        description?: Record<string, unknown>;
        issuetype?: { name: string };
        subtasks?: Array<{
          key: string;
          fields: { summary: string };
        }>;
      };
    };

    const description = issue.fields.description
      ? adfToMarkdown(
          issue.fields.description as Parameters<typeof adfToMarkdown>[0]
        ).trim()
      : "";

    const tag = issueTypeToTag(issue.fields.issuetype?.name || "");

    // Sub-tasks become schemes
    const schemes: Array<{ title: string; content: string }> = [];

    if (issue.fields.subtasks && issue.fields.subtasks.length > 0) {
      for (const sub of issue.fields.subtasks) {
        // Fetch each subtask description
        try {
          const subRes = await fetch(
            `${base_url}/rest/api/3/issue/${sub.key}?fields=summary,description`,
            { headers }
          );
          if (subRes.ok) {
            const subIssue = (await subRes.json()) as {
              fields: {
                summary: string;
                description?: Record<string, unknown>;
              };
            };
            const subDesc = subIssue.fields.description
              ? adfToMarkdown(
                  subIssue.fields.description as Parameters<
                    typeof adfToMarkdown
                  >[0]
                ).trim()
              : "";
            schemes.push({
              title: `[${sub.key}] ${sub.fields.summary}`,
              content: subDesc,
            });
          }
        } catch {
          schemes.push({
            title: `[${sub.key}] ${sub.fields.summary}`,
            content: "",
          });
        }
      }
    }

    // If no subtasks, use the issue description as a single scheme
    if (schemes.length === 0) {
      schemes.push({
        title: issue.fields.summary,
        content: description,
      });
    }

    return {
      planName: `[${issue.key}] ${issue.fields.summary}`,
      planDescription: description,
      planTag: tag,
      schemes,
    };
  },
};
