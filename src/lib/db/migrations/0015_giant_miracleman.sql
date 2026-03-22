CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`type` text DEFAULT 'project' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
