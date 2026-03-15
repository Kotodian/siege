CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '',
	`severity` text DEFAULT 'info' NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`content` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
