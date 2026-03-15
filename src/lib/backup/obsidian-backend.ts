import type { BackupBackend } from "./types";
import { localBackend } from "./local-backend";

// Obsidian is just a local filesystem with vault_path as export_path
export const obsidianBackend: BackupBackend = {
  name: "obsidian",

  async validate(config) {
    return localBackend.validate({ export_path: config.vault_path });
  },

  async backup(projects, config) {
    const vaultPath = config.vault_path;
    if (!vaultPath) throw new Error("vault_path is required");

    // Export to Obsidian vault under a "Siege" folder
    return localBackend.backup(projects, {
      export_path: `${vaultPath}/Siege`,
    });
  },
};
