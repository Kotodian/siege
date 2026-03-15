export interface ExportPlan {
  name: string;
  description: string;
  status: string;
  schemes: Array<{ title: string; content: string }>;
  scheduleItems: Array<{ title: string; description: string; status: string }>;
  testResults: Array<{ name: string; status: string; output: string }>;
}

export interface ExportProject {
  name: string;
  description: string;
  targetRepoPath: string;
  plans: ExportPlan[];
}

export interface BackupBackend {
  name: string;
  validate(config: Record<string, string>): Promise<boolean>;
  backup(projects: ExportProject[], config: Record<string, string>): Promise<void>;
}
