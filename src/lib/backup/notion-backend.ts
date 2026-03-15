import type { BackupBackend } from "./types";

// Notion backend - requires API key and database ID
export const notionBackend: BackupBackend = {
  name: "notion",

  async validate(config) {
    if (!config.api_key || !config.database_id) return false;

    try {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${config.database_id}`,
        {
          headers: {
            Authorization: `Bearer ${config.api_key}`,
            "Notion-Version": "2022-06-28",
          },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  },

  async backup(projects, config) {
    const { api_key, database_id } = config;
    if (!api_key || !database_id) {
      throw new Error("api_key and database_id are required");
    }

    for (const project of projects) {
      for (const plan of project.plans) {
        // Build markdown content for the page
        let content = `# ${project.name} / ${plan.name}\n\n`;
        content += `**Status:** ${plan.status}\n\n`;

        if (plan.description) {
          content += `${plan.description}\n\n`;
        }

        for (const scheme of plan.schemes) {
          content += `## ${scheme.title}\n\n${scheme.content}\n\n`;
        }

        // Create a page in the Notion database
        await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${api_key}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { database_id },
            properties: {
              Name: {
                title: [
                  {
                    text: {
                      content: `${project.name} - ${plan.name}`,
                    },
                  },
                ],
              },
            },
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [
                    {
                      type: "text",
                      text: { content: content.slice(0, 2000) },
                    },
                  ],
                },
              },
            ],
          }),
        });
      }
    }
  },
};
