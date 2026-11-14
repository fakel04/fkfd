CREATE TABLE `calendar_connections` (
	`board_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text,
	`refresh_token` text,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`last_sync` text,
	`error` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_links` (
	`board_id` text NOT NULL,
	`task_id` text NOT NULL,
	`event_id` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`baseline` text DEFAULT 'null' NOT NULL,
	`pending` text,
	`conflict` text,
	`resolution` text,
	`checked_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`board_id`, `task_id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_links_event` ON `calendar_links` (`board_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `calendar_oauth` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`time_zone` text NOT NULL,
	`expires_at` integer NOT NULL
);
