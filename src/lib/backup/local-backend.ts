import fs from "fs";
import path from "path";
import type { BackupBackend, ExportProject } from "./types";

function planToMarkdown(plan: ExportProject["plans"][0]): string {
  let md = `# ${plan.name}\n\n`;
  md += `**Status:** ${plan.status}\n\n`;
  if (plan.description) {
    md += `${plan.description}\n\n`;
  }
  return md;
}

function schemeToMarkdown(scheme: { title: string; content: string }): string {
  return `# ${scheme.title}\n\n${scheme.content}\n`;
}

export const localBackend: BackupBackend = {
  name: "local",

  async validate(config) {
    const exportPath = config.export_path;
    if (!exportPath) return false;
    try {
      fs.accessSync(path.dirname(exportPath), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },

  async backup(projects, config) {
    const exportPath = config.export_path;
    if (!exportPath) throw new Error("export_path is required");

    for (const project of projects) {
      const projectDir = path.join(exportPath, project.name.replace(/[/\\]/g, "_"));
      fs.mkdirSync(projectDir, { recursive: true });

      for (const plan of project.plans) {
        const planDir = path.join(projectDir, plan.name.replace(/[/\\]/g, "_"));
        fs.mkdirSync(planDir, { recursive: true });

        // Plan description
        fs.writeFileSync(
          path.join(planDir, "plan.md"),
          planToMarkdown(plan)
        );

        // Schemes
        if (plan.schemes.length > 0) {
          const schemesDir = path.join(planDir, "schemes");
          fs.mkdirSync(schemesDir, { recursive: true });
          plan.schemes.forEach((scheme, i) => {
            const filename = `${String(i + 1).padStart(2, "0")}-${scheme.title.replace(/[/\\]/g, "_")}.md`;
            fs.writeFileSync(
              path.join(schemesDir, filename),
              schemeToMarkdown(scheme)
            );
          });
        }

        // Schedule
        if (plan.scheduleItems.length > 0) {
          let scheduleMd = "# Schedule\n\n";
          for (const item of plan.scheduleItems) {
            scheduleMd += `## ${item.title}\n\n`;
            scheduleMd += `**Status:** ${item.status}\n\n`;
            if (item.description) {
              scheduleMd += `${item.description}\n\n`;
            }
          }
          fs.writeFileSync(path.join(planDir, "schedule.md"), scheduleMd);
        }

        // Test results
        if (plan.testResults.length > 0) {
          let testsMd = "# Test Results\n\n";
          for (const result of plan.testResults) {
            testsMd += `## ${result.name}: ${result.status}\n\n`;
            if (result.output) {
              testsMd += `\`\`\`\n${result.output}\n\`\`\`\n\n`;
            }
          }
          const testsDir = path.join(planDir, "tests");
          fs.mkdirSync(testsDir, { recursive: true });
          fs.writeFileSync(path.join(testsDir, "test-results.md"), testsMd);
        }
      }
    }
  },
};
