CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_key_unique` ON `app_settings` (`key`);--> statement-breakpoint
CREATE TABLE `backup_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`backend` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`schedule_cron` text DEFAULT '0 2 * * *' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backup_history` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_config_id` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`items_count` integer DEFAULT 0,
	`error_message` text,
	FOREIGN KEY (`backup_config_id`) REFERENCES `backup_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cli_engines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`default_args` text DEFAULT '{}',
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`status` text DEFAULT 'draft' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`target_repo_path` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`scheme_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '',
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`execution_log` text DEFAULT '',
	`engine` text DEFAULT 'claude-code',
	`skills` text DEFAULT '[]',
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheme_id`) REFERENCES `schemes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schemes` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '',
	`source_type` text DEFAULT 'manual' NOT NULL,
	`search_results` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`test_suite_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`type` text DEFAULT 'unit' NOT NULL,
	`generated_code` text DEFAULT '',
	`file_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`test_suite_id`) REFERENCES `test_suites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`test_case_id` text NOT NULL,
	`run_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text NOT NULL,
	`output` text DEFAULT '',
	`error_message` text,
	`duration_ms` integer DEFAULT 0,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
