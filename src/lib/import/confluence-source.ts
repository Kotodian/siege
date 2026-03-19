import type { ImportSource } from "./types";

function confluenceHeaders(
  email: string,
  apiToken: string
): Record<string, string> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

// Strip HTML tags and convert basic elements to markdown
function htmlToMarkdown(html: string): string {
  let md = html;

  // Block elements first
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "---\n\n");

  // Inline elements
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(
    /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    "[$2]($1)"
  );

  // Code blocks
  md = md.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    "```\n$1\n```\n\n"
  );

  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Collapse multiple blank lines
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
}

function parseMarkdownToSchemes(
  markdown: string
): { description: string; schemes: Array<{ title: string; content: string }> } {
  const lines = markdown.split("\n");
  const schemes: Array<{ title: string; content: string }> = [];
  let description = "";
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      if (current) {
        schemes.push({
          title: current.title,
          content: current.lines.join("\n").trim(),
        });
      }
      current = { title: h2[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      description += line + "\n";
    }
  }
  if (current) {
    schemes.push({
      title: current.title,
      content: current.lines.join("\n").trim(),
    });
  }

  return { description: description.trim(), schemes };
}

export const confluenceSource: ImportSource = {
  name: "confluence",

  async validate(config) {
    const { base_url, email, api_token } = config;
    if (!base_url || !email || !api_token) return false;
    try {
      const res = await fetch(
        `${base_url}/rest/api/content?limit=1`,
        { headers: confluenceHeaders(email, api_token) }
      );
      return res.ok;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { base_url, email, api_token } = config;
    const headers = confluenceHeaders(email, api_token);

    const cql = query
      ? `type=page AND text~"${query}"`
      : "type=page ORDER BY lastmodified DESC";

    const res = await fetch(
      `${base_url}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20`,
      { headers }
    );
    if (!res.ok) return [];

    const data = (await res.json()) as {
      results: Array<{
        id: string;
        title: string;
        _links?: { webui?: string };
      }>;
    };

    return data.results.map((page) => ({
      id: page.id,
      title: page.title,
      description: "",
      source: "confluence",
      sourceUrl: page._links?.webui
        ? `${base_url}${page._links.webui}`
        : undefined,
    }));
  },

  async fetchItem(config, itemId) {
    const { base_url, email, api_token } = config;
    const headers = confluenceHeaders(email, api_token);

    const res = await fetch(
      `${base_url}/rest/api/content/${itemId}?expand=body.storage`,
      { headers }
    );
    if (!res.ok)
      throw new Error(`Confluence page fetch failed: ${res.status}`);

    const page = (await res.json()) as {
      title: string;
      body?: { storage?: { value?: string } };
    };

    const html = page.body?.storage?.value || "";
    const markdown = htmlToMarkdown(html);
    const { description, schemes } = parseMarkdownToSchemes(markdown);

    const finalSchemes =
      schemes.length > 0
        ? schemes
        : [{ title: page.title, content: markdown }];

    return {
      planName: page.title,
      planDescription: description,
      planTag: "feature",
      schemes: finalSchemes,
    };
  },
};
