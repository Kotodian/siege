CREATE TABLE `import_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
