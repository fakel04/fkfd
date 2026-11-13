CREATE TABLE `members` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_unique` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`owner_name` text NOT NULL,
	`created_at` text NOT NULL
);
