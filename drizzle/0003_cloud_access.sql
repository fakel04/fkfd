CREATE TABLE `cloud_access` (
	`member_email` text NOT NULL,
	`note_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`member_email`, `note_id`)
);
--> statement-breakpoint
UPDATE `members` SET `role` = 'member' WHERE `role` IN ('viewer', 'editor');
