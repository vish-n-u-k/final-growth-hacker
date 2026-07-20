CREATE TABLE "brain_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"summary" text,
	"facts" jsonb,
	"user_resolved" jsonb,
	"priority_queue" jsonb,
	"last_updated" timestamp with time zone DEFAULT now(),
	CONSTRAINT "brain_context_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "brain_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"insight" text NOT NULL,
	"affected_item_ids" uuid[],
	"impact_score" integer DEFAULT 0,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brand_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"api_key" text,
	"metadata" jsonb,
	"connected_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone,
	CONSTRAINT "brand_integration_unique" UNIQUE("brand_id","provider")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text NOT NULL,
	"keywords" text,
	"industry" text,
	"target_audience" text,
	"usp" text,
	"brand_voice" text,
	"logo_url" text,
	"theme_color" text,
	"playbook" jsonb,
	"analytics_snapshot" jsonb,
	"analytics_snapshot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"link" text NOT NULL,
	"member_count" integer,
	"activity_score" integer,
	"relevance_score" integer,
	"competitor_presence" boolean DEFAULT false,
	"health_score" integer,
	"last_analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "communities_unique" UNIQUE("brand_id","platform","platform_id")
);
--> statement-breakpoint
CREATE TABLE "community_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"sentiment_positive" integer,
	"sentiment_neutral" integer,
	"sentiment_negative" integer,
	"pain_points" jsonb,
	"culture_summary" text,
	"top_posts" jsonb,
	"analyzed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "community_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"date" text NOT NULL,
	"posts_shared" integer DEFAULT 0,
	"comments_received" integer DEFAULT 0,
	"reactions_received" integer DEFAULT 0,
	"shares_received" integer DEFAULT 0,
	"replies_posted" integer DEFAULT 0,
	"website_visits" integer DEFAULT 0,
	"trial_signups" integer DEFAULT 0,
	"sentiment_score" integer,
	"engagement_rate" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "community_performance_unique" UNIQUE("community_id","date")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"url" text NOT NULL,
	"name" text,
	"type" text,
	"market_position" text,
	"primary_strength" text,
	"discovered_in" text,
	"discovered_at" timestamp with time zone DEFAULT now(),
	"last_analyzed_at" timestamp with time zone,
	CONSTRAINT "competitors_unique" UNIQUE("brand_id","url")
);
--> statement-breakpoint
CREATE TABLE "engagement_strategy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"conversation_starters" jsonb,
	"value_posts" jsonb,
	"soft_pitches" jsonb,
	"optimal_times" jsonb,
	"reply_strategy" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"keywords" text,
	"is_completed" boolean DEFAULT false,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "frekto_scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"topic" text NOT NULL,
	"post_type" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"frekto_job_id" text,
	"output_url" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id_a" uuid NOT NULL,
	"item_id_b" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "module_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"ai_detail" text,
	"ai_highlight" text,
	"ai_narrative" text,
	"ai_action" text,
	"ai_verified" boolean DEFAULT false,
	"ai_verified_at" timestamp with time zone,
	"user_checked" boolean DEFAULT false,
	"user_checked_at" timestamp with time zone,
	"completed_by" text,
	"fixable" boolean DEFAULT false,
	"fix_type" text,
	"fix_input_key" text,
	"fix_integration_provider" text,
	"ai_draft" text,
	"ai_data" jsonb,
	"user_skipped" boolean DEFAULT false,
	"user_skip_reason" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "module_item_unique" UNIQUE("module_id","slug")
);
--> statement-breakpoint
CREATE TABLE "module_page_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"word_count" integer DEFAULT 0,
	"verdict" text NOT NULL,
	"urgency" text NOT NULL,
	"reason" text,
	"action" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "module_page_audit_unique" UNIQUE("module_id","url")
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"requirements" jsonb,
	"score" integer DEFAULT 0,
	"last_analyzed_at" timestamp with time zone,
	"agent_branch" text,
	"agent_pr_url" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "brain_context" ADD CONSTRAINT "brain_context_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_insights" ADD CONSTRAINT "brain_insights_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_integrations" ADD CONSTRAINT "brand_integrations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_analysis" ADD CONSTRAINT "community_analysis_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_performance" ADD CONSTRAINT "community_performance_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_strategy" ADD CONSTRAINT "engagement_strategy_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frekto_scheduled_posts" ADD CONSTRAINT "frekto_scheduled_posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_item_id_a_module_items_id_fk" FOREIGN KEY ("item_id_a") REFERENCES "public"."module_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_item_id_b_module_items_id_fk" FOREIGN KEY ("item_id_b") REFERENCES "public"."module_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_categories" ADD CONSTRAINT "module_categories_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_categories" ADD CONSTRAINT "module_categories_parent_id_module_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."module_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_category_id_module_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."module_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_page_audit" ADD CONSTRAINT "module_page_audit_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;