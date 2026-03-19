import type { ImportSource, ImportableItem } from "./types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function richTextToPlain(richText: Array<{ plain_text?: string }>): string {
  return richText.map((t) => t.plain_text || "").join("");
}

function blocksToMarkdown(
  blocks: Array<{ type: string; [key: string]: unknown }>
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const data = block[block.type] as
      | { rich_text?: Array<{ plain_text?: string }> }
      | undefined;
    const text = data?.rich_text ? richTextToPlain(data.rich_text) : "";

    switch (block.type) {
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${text}`);
        break;
      case "to_do": {
        const checked = (data as { checked?: boolean })?.checked;
        lines.push(`- [${checked ? "x" : " "}] ${text}`);
        break;
      }
      case "code": {
        const lang =
          (data as { language?: string })?.language || "";
        lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
        break;
      }
      case "divider":
        lines.push("---");
        break;
      default:
        if (text) lines.push(text);
        break;
    }
    lines.push("");
  }
  return lines.join("\n");
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

export const notionSource: ImportSource = {
  name: "notion",

  async validate(config) {
    const { api_key } = config;
    if (!api_key) return false;
    try {
      const res = await fetch(`${NOTION_API}/users/me`, {
        headers: notionHeaders(api_key),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { api_key, database_id } = config;
    const headers = notionHeaders(api_key);
    const items: ImportableItem[] = [];

    if (database_id) {
      // Query specific database
      const res = await fetch(
        `${NOTION_API}/databases/${database_id}/query`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            query
              ? {
                  filter: {
                    property: "title",
                    title: { contains: query },
                  },
                  page_size: 20,
                }
              : { page_size: 20 }
          ),
        }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results: Array<{
          id: string;
          url?: string;
          properties: Record<
            string,
            { type: string; title?: Array<{ plain_text?: string }> }
          >;
        }>;
      };

      for (const page of data.results) {
        const titleProp = Object.values(page.properties).find(
          (p) => p.type === "title"
        );
        const title = titleProp?.title
          ? richTextToPlain(titleProp.title)
          : "Untitled";
        items.push({
          id: page.id,
          title,
          description: "",
          source: "notion",
          sourceUrl: page.url,
        });
      }
    } else {
      // Search all pages
      const res = await fetch(`${NOTION_API}/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: query || "",
          filter: { property: "object", value: "page" },
          page_size: 20,
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results: Array<{
          id: string;
          url?: string;
          properties?: Record<
            string,
            { type: string; title?: Array<{ plain_text?: string }> }
          >;
        }>;
      };

      for (const page of data.results) {
        const titleProp = page.properties
          ? Object.values(page.properties).find((p) => p.type === "title")
          : undefined;
        const title = titleProp?.title
          ? richTextToPlain(titleProp.title)
          : "Untitled";
        items.push({
          id: page.id,
          title,
          description: "",
          source: "notion",
          sourceUrl: page.url,
        });
      }
    }

    return items;
  },

  async fetchItem(config, itemId) {
    const { api_key } = config;
    const headers = notionHeaders(api_key);

    // Get page title
    const pageRes = await fetch(`${NOTION_API}/pages/${itemId}`, { headers });
    if (!pageRes.ok) throw new Error(`Notion page fetch failed: ${pageRes.status}`);
    const page = (await pageRes.json()) as {
      properties: Record<
        string,
        { type: string; title?: Array<{ plain_text?: string }> }
      >;
    };
    const titleProp = Object.values(page.properties).find(
      (p) => p.type === "title"
    );
    const pageTitle = titleProp?.title
      ? richTextToPlain(titleProp.title)
      : "Untitled";

    // Get blocks
    const blocksRes = await fetch(
      `${NOTION_API}/blocks/${itemId}/children?page_size=100`,
      { headers }
    );
    if (!blocksRes.ok) throw new Error(`Notion blocks fetch failed: ${blocksRes.status}`);
    const blocksData = (await blocksRes.json()) as {
      results: Array<{ type: string; [key: string]: unknown }>;
    };

    const markdown = blocksToMarkdown(blocksData.results);
    const { description, schemes } = parseMarkdownToSchemes(markdown);

    // If no H2 sections, treat entire content as one scheme
    const finalSchemes =
      schemes.length > 0
        ? schemes
        : [{ title: pageTitle, content: markdown.trim() }];

    return {
      planName: pageTitle,
      planDescription: description,
      planTag: "feature",
      schemes: finalSchemes,
    };
  },
};
