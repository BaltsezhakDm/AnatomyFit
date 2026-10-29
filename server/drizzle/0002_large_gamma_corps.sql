CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`step` real,
	`factor` real DEFAULT 1 NOT NULL,
	`factor_source` text DEFAULT 'same' NOT NULL,
	`base_load` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `machines_user_exercise_idx` ON `machines` (`user_id`,`exercise_id`);--> statement-breakpoint
ALTER TABLE `workout_sets` ADD `machine_id` text REFERENCES machines(id);