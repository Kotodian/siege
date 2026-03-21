import fs from "fs";
import path from "path";

export interface SkillInfo {
  name: string;
  source: string;
  description: string;
  filePath: string;
  content: string;
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function scanSkillDirectory(
  dirPath: string,
  source: string
): SkillInfo[] {
  const skills: SkillInfo[] = [];

  if (!fs.existsSync(dirPath)) return skills;

  const entries = fs.readdirSync(dirPath, { recursive: true });
  for (const entry of entries) {
    const entryStr = typeof entry === "string" ? entry : entry.toString();
    if (!entryStr.endsWith(".md")) continue;

    const filePath = path.join(dirPath, entryStr);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    const name =
      frontmatter.name || path.basename(filePath, ".md");
    const description = frontmatter.description || "";

    skills.push({
      name: `${source}:${name}`,
      source,
      description,
      filePath,
      content,
    });
  }

  return skills;
}

export function scanAllSkills(): SkillInfo[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const skillsBaseDir = path.join(homeDir, ".claude", "skills");

  const skills: SkillInfo[] = [];

  // 1. Scan ~/.claude/skills/ (user custom skills)
  if (fs.existsSync(skillsBaseDir)) {
    const entries = fs.readdirSync(skillsBaseDir);
    for (const entry of entries) {
      const entryPath = path.join(skillsBaseDir, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        skills.push(...scanSkillDirectory(entryPath, entry));
      } else if (stat.isFile() && entry.endsWith(".md")) {
        const content = fs.readFileSync(entryPath, "utf-8");
        const frontmatter = parseFrontmatter(content);
        skills.push({
          name: frontmatter.name || path.basename(entry, ".md"),
          source: "custom",
          description: frontmatter.description || "",
          filePath: entryPath,
          content,
        });
      }
    }
  }

  // 2. Scan ~/.claude/plugins/cache/ (plugin skills)
  const pluginsDir = path.join(homeDir, ".claude", "plugins", "cache");
  if (fs.existsSync(pluginsDir)) {
    try {
      // Walk: plugins/cache/<org>/<plugin>/<version>/skills/<skill-name>/SKILL.md
      for (const org of fs.readdirSync(pluginsDir)) {
        const orgPath = path.join(pluginsDir, org);
        if (!fs.statSync(orgPath).isDirectory()) continue;
        for (const plugin of fs.readdirSync(orgPath)) {
          const pluginPath = path.join(orgPath, plugin);
          if (!fs.statSync(pluginPath).isDirectory()) continue;
          for (const version of fs.readdirSync(pluginPath)) {
            const skillsPath = path.join(pluginPath, version, "skills");
            if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) continue;
            for (const skillDir of fs.readdirSync(skillsPath)) {
              const skillDirPath = path.join(skillsPath, skillDir);
              if (!fs.statSync(skillDirPath).isDirectory()) continue;
              const skillFile = path.join(skillDirPath, "SKILL.md");
              if (!fs.existsSync(skillFile)) continue;

              const content = fs.readFileSync(skillFile, "utf-8");
              const frontmatter = parseFrontmatter(content);
              const source = `${plugin}`;
              const name = frontmatter.name || skillDir;
              // Deduplicate: skip if already added with same name
              if (skills.some(s => s.name === name || s.name === `${source}:${name}`)) continue;
              skills.push({
                name,
                source,
                description: frontmatter.description || "",
                filePath: skillFile,
                content,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[skills] Failed to scan plugins:", err);
    }
  }

  return skills;
}

export function getSkillContent(skills: SkillInfo[], names: string[]): string {
  return skills
    .filter((s) => names.includes(s.name))
    .map((s) => `## Skill: ${s.name}\n\n${s.content}`)
    .join("\n\n---\n\n");
}
