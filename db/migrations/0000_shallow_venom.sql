CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_university` integer DEFAULT false NOT NULL,
	`color_token` text DEFAULT 'neutral' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`assessment_type` text DEFAULT 'other' NOT NULL,
	`weight_percent` real NOT NULL,
	`due_week` integer,
	`due_week_end` integer,
	`due_at` text,
	`is_exam` integer DEFAULT false NOT NULL,
	`exam_minutes` integer,
	`read_brief_at` text,
	`started_at` text,
	`main_work_done_at` text,
	`checked_at` text,
	`is_submitted` integer DEFAULT false NOT NULL,
	`submitted_at` text,
	`submission_verified_at` text,
	`estimated_minutes` integer,
	`source_url` text,
	`source_last_checked_at` text,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`user_edited_fields` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignments_module_idx` ON `assignments` (`module_id`);--> statement-breakpoint
CREATE INDEX `assignments_due_idx` ON `assignments` (`due_at`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`google_event_id` text,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`area_id` text,
	`module_id` text,
	`synced_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_google_event_id_unique` ON `calendar_events` (`google_event_id`);--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `calendar_events` (`start_at`);--> statement-breakpoint
CREATE TABLE `capture_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resolved_task_id` text,
	`resolved_at` text,
	FOREIGN KEY (`resolved_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbox_unresolved_idx` ON `capture_inbox` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `fixed_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`area_id` text NOT NULL,
	`module_id` text,
	`day_of_week` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`from_week` integer,
	`to_week` integer,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`marks_awarded` real NOT NULL,
	`marks_possible` real DEFAULT 100 NOT NULL,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`feedback_note` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_assignment_idx` ON `grades` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `module_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`week_number` integer NOT NULL,
	`title` text NOT NULL,
	`first_reviewed_at` text,
	`last_reviewed_at` text,
	`next_review_at` text,
	`review_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_module_idx` ON `module_topics` (`module_id`);--> statement-breakpoint
CREATE INDEX `topics_next_review_idx` ON `module_topics` (`next_review_at`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`credits` integer,
	`trimester` text NOT NULL,
	`coordinator` text,
	`ucd_url` text,
	`syllabus_summary` text,
	`student_effort_hours` integer,
	`assessment_profile` text DEFAULT 'continuous' NOT NULL,
	`attendance_mandatory` integer DEFAULT false NOT NULL,
	`color_token` text DEFAULT 'neutral' NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modules_code_unique` ON `modules` (`code`);--> statement-breakpoint
CREATE TABLE `overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`week_number` integer NOT NULL,
	`area_id` text NOT NULL,
	`reason` text NOT NULL,
	`overage_hours` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `overrides_week_idx` ON `overrides` (`term_id`,`week_number`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`google_drive_file_id` text,
	`week_number` integer,
	`source` text DEFAULT 'drive' NOT NULL,
	`url` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resources_module_idx` ON `resources` (`module_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`area_id` text NOT NULL,
	`module_id` text,
	`assignment_id` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_at` text,
	`week_number` integer,
	`estimated_minutes` integer,
	`actual_minutes` integer,
	`priority_override` integer,
	`scheduled_start_at` text,
	`scheduled_end_at` text,
	`is_required_weekly` integer DEFAULT false NOT NULL,
	`deferred_reason` text,
	`deferred_at` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_week_idx` ON `tasks` (`week_number`);--> statement-breakpoint
CREATE INDEX `tasks_module_idx` ON `tasks` (`module_id`);--> statement-breakpoint
CREATE TABLE `time_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`area_id` text NOT NULL,
	`module_id` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`week_number` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sessions_week_idx` ON `time_sessions` (`week_number`);--> statement-breakpoint
CREATE INDEX `sessions_area_idx` ON `time_sessions` (`area_id`);--> statement-breakpoint
CREATE TABLE `week_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`week_number` integer NOT NULL,
	`area_id` text NOT NULL,
	`planned_hours` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allocations_week_area_idx` ON `week_allocations` (`term_id`,`week_number`,`area_id`);--> statement-breakpoint
CREATE TABLE `weekly_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`task_title` text NOT NULL,
	`default_estimated_minutes` integer,
	`default_day` integer,
	`required` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
