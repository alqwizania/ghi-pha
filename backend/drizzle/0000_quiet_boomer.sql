CREATE TABLE IF NOT EXISTS "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"assessment_type" varchar(50) NOT NULL,
	"ihr_question_1" boolean,
	"ihr_question_1_notes" text,
	"ihr_question_2" boolean,
	"ihr_question_2_notes" text,
	"ihr_question_3" boolean,
	"ihr_question_3_notes" text,
	"ihr_question_4" boolean,
	"ihr_question_4_notes" text,
	"ihr_decision" varchar(50),
	"rra_hazard_assessment" jsonb,
	"rra_exposure_assessment" jsonb,
	"rra_context_assessment" jsonb,
	"rra_overall_risk" varchar(20),
	"rra_confidence_level" varchar(20),
	"rra_key_uncertainties" jsonb,
	"rra_recommendations" jsonb,
	"status" varchar(50) DEFAULT 'Draft',
	"assigned_to" uuid NOT NULL,
	"reviewed_by" uuid,
	"outcome_decision" varchar(50),
	"outcome_justification" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"escalation_level" varchar(50) DEFAULT 'Director',
	"priority" varchar(20) NOT NULL,
	"escalation_reason" text NOT NULL,
	"recommended_actions" jsonb,
	"director_status" varchar(50) DEFAULT 'Pending Review',
	"director_decision" text,
	"director_notes" text,
	"actions_taken" jsonb,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"escalated_at" timestamp with time zone DEFAULT now(),
	"escalated_by" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listener_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"language" varchar(10) DEFAULT 'en',
	"priority" integer DEFAULT 2,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monitored_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(50) DEFAULT 'twitter' NOT NULL,
	"account_handle" varchar(255) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"account_type" varchar(50) NOT NULL,
	"region" varchar(100),
	"priority" integer DEFAULT 2,
	"is_active" boolean DEFAULT true,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "monitored_accounts_account_handle_unique" UNIQUE("account_handle")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beacon_event_id" varchar(255),
	"source_url" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"disease" varchar(255) NOT NULL,
	"country" varchar(100) NOT NULL,
	"location" varchar(255),
	"date_reported" date NOT NULL,
	"date_onset" date,
	"cases" integer DEFAULT 0,
	"deaths" integer DEFAULT 0,
	"case_fatality_rate" numeric(5, 2),
	"description" text,
	"outbreak_status" varchar(50),
	"triage_status" varchar(50) DEFAULT 'Pending Triage',
	"triaged_by" uuid,
	"triaged_at" timestamp with time zone,
	"triage_notes" text,
	"rejection_reason" text,
	"priority_score" numeric(5, 2),
	"gcc_relevant" boolean DEFAULT false,
	"saudi_risk_level" varchar(20),
	"current_status" varchar(50) DEFAULT 'New',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_beacon_sync" timestamp with time zone,
	CONSTRAINT "signals_beacon_event_id_unique" UNIQUE("beacon_event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(50) DEFAULT 'twitter' NOT NULL,
	"post_id" varchar(255) NOT NULL,
	"author" varchar(255) NOT NULL,
	"author_handle" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"language" varchar(10) DEFAULT 'en',
	"location" varchar(255),
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"urls" jsonb DEFAULT '[]'::jsonb,
	"engagement" jsonb DEFAULT '{"likes":0,"retweets":0,"replies":0}'::jsonb,
	"detected_keywords" jsonb DEFAULT '[]'::jsonb,
	"relevance_score" numeric(5, 2) DEFAULT '0',
	"sentiment_score" numeric(5, 2),
	"verification_status" varchar(50) DEFAULT 'Pending',
	"related_signal_id" uuid,
	"promoted_at" timestamp with time zone,
	"promoted_by" uuid,
	"is_dismissed" boolean DEFAULT false,
	"posted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "social_signals_post_id_unique" UNIQUE("post_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'Analyst' NOT NULL,
	"password_hash" text NOT NULL,
	"permissions" jsonb DEFAULT '{"dashboard":"view","triage":"view","assessment":"view","escalation":"view"}'::jsonb,
	"last_login" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_related_signal_id_signals_id_fk" FOREIGN KEY ("related_signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_promoted_by_users_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
