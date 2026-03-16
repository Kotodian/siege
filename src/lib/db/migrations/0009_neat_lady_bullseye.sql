CREATE TABLE `ai_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
