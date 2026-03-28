ALTER TABLE `projects` ADD `remote_host` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `remote_user` text DEFAULT 'root';--> statement-breakpoint
ALTER TABLE `projects` ADD `remote_repo_path` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `remote_enabled` integer DEFAULT false NOT NULL;