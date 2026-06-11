CREATE TABLE "user_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level_id" integer NOT NULL,
	"task_index" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_task_unique" UNIQUE("user_id","level_id","task_index")
);
