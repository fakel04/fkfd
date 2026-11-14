CREATE TABLE `task_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`file_key` text,
	`file_name` text,
	`file_size` integer,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_materials_task` ON `task_materials` (`board_id`,`task_id`,`created_at`);