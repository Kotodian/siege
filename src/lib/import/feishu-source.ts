import type { ImportSource, ImportableItem } from "./types";

const FEISHU_API = "https://open.feishu.cn/open-apis";

async function getTenantAccessToken(
  appId: string,
  appSecret: string
): Promise<string> {
  const res = await fetch(
    `${FEISHU_API}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );
  const data = (await res.json()) as {
    code: number;
    tenant_access_token?: string;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error("Failed to get Feishu tenant_access_token");
  }
  return data.tenant_access_token;
}

function feishuHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

// Extract plain text from Feishu element array
function elementsToText(
  elements: Array<{
    text_run?: { content: string; text_element_style?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; link?: { url: string } } };
    mention_user?: { user_id: string };
    equation?: { content: string };
  }>
): string {
  if (!elements) return "";
  return elements
    .map((el) => {
      if (el.text_run) {
        let text = el.text_run.content || "";
        const style = el.text_run.text_element_style;
        if (style?.link?.url) {
          const url = decodeURIComponent(style.link.url);
          text = `[${text}](${url})`;
        }
        if (style?.bold) text = `**${text}**`;
        if (style?.italic) text = `*${text}*`;
        if (style?.strikethrough) text = `~~${text}~~`;
        return text;
      }
      if (el.equation) return `$${el.equation.content}$`;
      return "";
    })
    .join("");
}

interface FeishuBlock {
  block_id: string;
  block_type: number;
  parent_id: string;
  children?: string[];
  [key: string]: unknown;
}

// Block type constants
const BLOCK_TYPES: Record<number, string> = {
  1: "page",
  2: "text",
  3: "heading1",
  4: "heading2",
  5: "heading3",
  6: "heading4",
  7: "heading5",
  8: "heading6",
  9: "heading7",
  10: "heading8",
  11: "heading9",
  12: "bullet",
  13: "ordered",
  14: "code",
  15: "quote",
  17: "todo",
  19: "divider",
  22: "table",
  27: "image",
  37: "callout",
};

function blockToMarkdown(block: FeishuBlock): string {
  const typeName = BLOCK_TYPES[block.block_type] || "";
  const blockData = block[typeName] as
    | { elements?: Array<Record<string, unknown>>; style?: Record<string, unknown> }
    | undefined;
  const elements = blockData?.elements as Parameters<typeof elementsToText>[0] | undefined;
  const text = elements ? elementsToText(elements) : "";

  switch (typeName) {
    case "text":
      return text + "\n";
    case "heading1":
      return `# ${text}\n`;
    case "heading2":
      return `## ${text}\n`;
    case "heading3":
      return `### ${text}\n`;
    case "heading4":
      return `#### ${text}\n`;
    case "heading5":
    case "heading6":
    case "heading7":
    case "heading8":
    case "heading9":
      return `##### ${text}\n`;
    case "bullet":
      return `- ${text}\n`;
    case "ordered":
      return `1. ${text}\n`;
    case "code": {
      const codeData = block.code as { body?: { elements?: Parameters<typeof elementsToText>[0] }; language?: number } | undefined;
      const codeText = codeData?.body?.elements
        ? elementsToText(codeData.body.elements)
        : text;
      return "```\n" + codeText + "\n```\n";
    }
    case "quote":
      return `> ${text}\n`;
    case "todo": {
      const done = (blockData?.style as { done?: boolean })?.done;
      return `- [${done ? "x" : " "}] ${text}\n`;
    }
    case "divider":
      return "---\n";
    case "callout":
      return `> ${text}\n`;
    default:
      return text ? text + "\n" : "";
  }
}

function blocksToMarkdown(blocks: FeishuBlock[]): string {
  return blocks.map((b) => blockToMarkdown(b)).join("\n");
}

function parseMarkdownToSchemes(
  markdown: string,
  fallbackTitle: string
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

  if (schemes.length === 0) {
    schemes.push({ title: fallbackTitle, content: markdown.trim() });
  }

  return { description: description.trim(), schemes };
}

export const feishuSource: ImportSource = {
  name: "feishu",

  async validate(config) {
    const { app_id, app_secret } = config;
    if (!app_id || !app_secret) return false;
    try {
      await getTenantAccessToken(app_id, app_secret);
      return true;
    } catch {
      return false;
    }
  },

  async listItems(config, query) {
    const { app_id, app_secret, space_id } = config;
    const token = await getTenantAccessToken(app_id, app_secret);
    const headers = feishuHeaders(token);
    const items: ImportableItem[] = [];

    if (query) {
      // Search wiki nodes
      const body: Record<string, unknown> = {
        query,
        page_size: 20,
      };
      if (space_id) body.space_id = space_id;

      const res = await fetch(`${FEISHU_API}/wiki/v2/nodes/search`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        code: number;
        data?: {
          items?: Array<{
            node_token: string;
            obj_token: string;
            title: string;
            url?: string;
            obj_type: string;
          }>;
        };
      };

      for (const node of data.data?.items || []) {
        items.push({
          id: node.obj_token,
          title: node.title,
          description: node.obj_type || "doc",
          source: "feishu",
          sourceUrl: node.url,
        });
      }
    } else if (space_id) {
      // List nodes in space
      const res = await fetch(
        `${FEISHU_API}/wiki/v2/spaces/${space_id}/nodes?page_size=20`,
        { headers }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        code: number;
        data?: {
          items?: Array<{
            node_token: string;
            obj_token: string;
            title: string;
            url?: string;
            obj_type: string;
          }>;
        };
      };

      for (const node of data.data?.items || []) {
        items.push({
          id: node.obj_token,
          title: node.title,
          description: node.obj_type || "doc",
          source: "feishu",
          sourceUrl: node.url,
        });
      }
    } else {
      // List spaces first, then user picks
      const res = await fetch(
        `${FEISHU_API}/wiki/v2/spaces?page_size=20`,
        { headers }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        code: number;
        data?: {
          items?: Array<{
            space_id: string;
            name: string;
            description?: string;
          }>;
        };
      };

      for (const space of data.data?.items || []) {
        items.push({
          id: `space:${space.space_id}`,
          title: space.name,
          description: space.description || "",
          source: "feishu",
        });
      }
    }

    return items;
  },

  async fetchItem(config, itemId) {
    const { app_id, app_secret } = config;
    const token = await getTenantAccessToken(app_id, app_secret);
    const headers = feishuHeaders(token);

    // Get document info
    const docRes = await fetch(
      `${FEISHU_API}/docx/v1/documents/${itemId}`,
      { headers }
    );
    if (!docRes.ok)
      throw new Error(`Feishu document fetch failed: ${docRes.status}`);
    const doc = (await docRes.json()) as {
      data?: { document?: { title?: string } };
    };
    const docTitle = doc.data?.document?.title || "Untitled";

    // Get all blocks
    const blocksRes = await fetch(
      `${FEISHU_API}/docx/v1/documents/${itemId}/blocks/${itemId}/children?page_size=500`,
      { headers }
    );
    if (!blocksRes.ok)
      throw new Error(`Feishu blocks fetch failed: ${blocksRes.status}`);
    const blocksData = (await blocksRes.json()) as {
      data?: { items?: FeishuBlock[] };
    };

    const blocks = blocksData.data?.items || [];
    const markdown = blocksToMarkdown(blocks);
    const { description, schemes } = parseMarkdownToSchemes(
      markdown,
      docTitle
    );

    return {
      planName: docTitle,
      planDescription: description,
      planTag: "feature",
      schemes,
    };
  },
};
