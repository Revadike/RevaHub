CREATE TABLE "logs" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"task_run_id" text,
	"module_instance_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"module_name" text NOT NULL,
	"label" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_restart" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"name" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"label" text NOT NULL,
	"native" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_name" text NOT NULL,
	"label" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_config_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_payload" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"name" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"label" text NOT NULL,
	"native" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_module_instance_id_module_instances_id_fk" FOREIGN KEY ("module_instance_id") REFERENCES "public"."module_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_instances" ADD CONSTRAINT "module_instances_module_name_modules_name_fk" FOREIGN KEY ("module_name") REFERENCES "public"."modules"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_configs" ADD CONSTRAINT "task_configs_task_name_tasks_name_fk" FOREIGN KEY ("task_name") REFERENCES "public"."tasks"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_config_id_task_configs_id_fk" FOREIGN KEY ("task_config_id") REFERENCES "public"."task_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logs_task_run_id_idx" ON "logs" USING btree ("task_run_id");--> statement-breakpoint
CREATE INDEX "logs_module_instance_id_idx" ON "logs" USING btree ("module_instance_id");--> statement-breakpoint
CREATE INDEX "logs_timestamp_desc_idx" ON "logs" USING btree ("timestamp");