CREATE TABLE `board_operations` (
	`board_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result_revision` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`board_id`, `operation_id`)
);
