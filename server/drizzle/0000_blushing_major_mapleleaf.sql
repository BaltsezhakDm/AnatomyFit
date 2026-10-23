CREATE TABLE `body_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`log_date` text NOT NULL,
	`weight` real,
	`body_fat_percentage` real,
	`waist_cm` real,
	`chest_cm` real,
	`arm_cm` real,
	`thigh_cm` real,
	`comment` text,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `body_measurements_user_updated_idx` ON `body_measurements` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `body_measurements_user_log_date_idx` ON `body_measurements` (`user_id`,`log_date`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`category` text DEFAULT 'strength' NOT NULL,
	`movement_pattern` text NOT NULL,
	`equipment` text NOT NULL,
	`uses_bodyweight` integer DEFAULT 0 NOT NULL,
	`is_custom` integer DEFAULT 0 NOT NULL,
	`muscle_loads` text NOT NULL,
	`instructions` text,
	`is_favorite` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercises_user_updated_idx` ON `exercises` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `exercises_movement_pattern_idx` ON `exercises` (`movement_pattern`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`media_type` text NOT NULL,
	`file_path` text,
	`public_url` text,
	`thumbnail_url` text,
	`mime_type` text,
	`file_size` integer,
	`duration_sec` real,
	`external_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`record_type` text NOT NULL,
	`value` real NOT NULL,
	`set_id` text,
	`achieved_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `workout_sets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `personal_records_user_exercise_idx` ON `personal_records` (`user_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `program_days` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`name` text NOT NULL,
	`day_order` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `program_days_program_idx` ON `program_days` (`program_id`);--> statement-breakpoint
CREATE INDEX `program_days_updated_idx` ON `program_days` (`updated_at`);--> statement-breakpoint
CREATE TABLE `program_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`program_day_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer DEFAULT 1 NOT NULL,
	`target_sets` integer DEFAULT 3 NOT NULL,
	`target_reps_min` integer DEFAULT 8,
	`target_reps_max` integer DEFAULT 12,
	`target_rpe` real,
	`rest_seconds` integer,
	`superset_tag` text,
	`notes` text,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`program_day_id`) REFERENCES `program_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `program_exercises_day_idx` ON `program_exercises` (`program_day_id`);--> statement-breakpoint
CREATE INDEX `program_exercises_exercise_idx` ON `program_exercises` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `program_exercises_updated_idx` ON `program_exercises` (`updated_at`);--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_public` integer DEFAULT 0 NOT NULL,
	`exercise_ids` text,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `programs_user_updated_idx` ON `programs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`unit_system` text DEFAULT 'metric' NOT NULL,
	`default_rest_duration_sec` integer DEFAULT 90 NOT NULL,
	`exercise_view_mode` text DEFAULT 'classic' NOT NULL,
	`sound_enabled` integer DEFAULT 1 NOT NULL,
	`vibration_enabled` integer DEFAULT 1 NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`username` text NOT NULL,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`program_day_id` text,
	`name` text NOT NULL,
	`session_type` text DEFAULT 'free' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`feeling` text,
	`total_duration_sec` integer,
	`comment` text,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_day_id`) REFERENCES `program_days`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workout_sessions_user_updated_idx` ON `workout_sessions` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workout_sessions_user_started_idx` ON `workout_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`set_order` integer DEFAULT 1 NOT NULL,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`weight` real NOT NULL,
	`reps` integer NOT NULL,
	`rpe` real,
	`rir` integer,
	`comment` text,
	`log_date` text NOT NULL,
	`completed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_sets_user_updated_idx` ON `workout_sets` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workout_sets_session_idx` ON `workout_sets` (`session_id`);--> statement-breakpoint
CREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `workout_sets_user_log_date_idx` ON `workout_sets` (`user_id`,`log_date`);