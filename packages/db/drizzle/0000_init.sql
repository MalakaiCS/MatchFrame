CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organisation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"placement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "asset_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_derivatives_uq" UNIQUE("asset_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organisation_id" uuid NOT NULL,
	"actor_user_id" text,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_cues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"cue_key" text NOT NULL,
	"item_index" integer NOT NULL,
	"action" text NOT NULL,
	"params" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"duration_ms" integer,
	"state" text NOT NULL,
	"reason" text,
	"dispatched_revision" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_cues_key_uq" UNIQUE("cue_key")
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"game_plan_version_id" uuid NOT NULL,
	"playlist_id" text NOT NULL,
	"trigger_id" text NOT NULL,
	"iteration" text NOT NULL,
	"execution_key" text NOT NULL,
	"priority" integer NOT NULL,
	"layers" jsonb NOT NULL,
	"trigger_context" jsonb NOT NULL,
	"source_fact_id" uuid,
	"source_fact_revision" integer,
	"state" text NOT NULL,
	"reason" text,
	"deadline_at" timestamp with time zone,
	"rehearsal" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_exec_uq" UNIQUE("execution_key"),
	CONSTRAINT "automation_runs_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "broadcast_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"input_id" uuid,
	"room_name" text NOT NULL,
	"state" text NOT NULL,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"scheduled_stop_at" timestamp with time zone,
	"error" jsonb,
	"demo" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_sessions_room_name_unique" UNIQUE("room_name"),
	CONSTRAINT "broadcast_sessions_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"creative_set_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"total_cap" integer,
	"per_match_cap" integer,
	"min_spacing_seconds" integer DEFAULT 0 NOT NULL,
	"excluded_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_sponsorship" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "campaigns_dates_chk" CHECK ("campaigns"."ends_at" > "campaigns"."starts_at"),
	CONSTRAINT "campaigns_priority_chk" CHECK ("campaigns"."priority" between 1 and 4),
	CONSTRAINT "campaigns_weight_chk" CHECK ("campaigns"."weight" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "capacity_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"output_session_id" uuid NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_reservations_output_session_id_unique" UNIQUE("output_session_id")
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid,
	"recording_id" uuid,
	"source_clip_id" uuid,
	"title" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"part_id" uuid,
	"in_ms" integer NOT NULL,
	"out_ms" integer NOT NULL,
	"markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"object_key" text,
	"thumbnail_key" text,
	"probe" jsonb,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"owner_team_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clips_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "clips_range_chk" CHECK ("clips"."out_ms" > "clips"."in_ms")
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"logo_asset_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubs_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"league_id" uuid,
	"name" text NOT NULL,
	"short_name" text,
	"sport" text NOT NULL,
	"logo_asset_id" uuid,
	"rules_version" text NOT NULL,
	"rules_config" jsonb NOT NULL,
	"default_timezone" text NOT NULL,
	"theme_profile_id" uuid,
	"game_plan_version_id" uuid,
	"output_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "competitions_sport_chk" CHECK ("competitions"."sport" in ('football','basketball'))
);
--> statement-breakpoint
CREATE TABLE "compilations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"clip_ids" jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_room_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_sets_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"creative_set_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"width" integer,
	"height" integer,
	"aspect_ratio" double precision,
	"mime_type" text,
	"duration_ms" integer,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creatives_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'custom' NOT NULL,
	"server_url" text NOT NULL,
	"stream_key_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'self-hosted' NOT NULL,
	"features" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"state" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"output_key" text,
	"output_probe" jsonb,
	"output_bytes" bigint,
	"worker_pid" integer,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_jobs_job_key_unique" UNIQUE("job_key"),
	CONSTRAINT "export_jobs_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "fact_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"game_plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sport" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gpv_uq" UNIQUE("game_plan_id","version"),
	CONSTRAINT "gpv_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "game_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sport" text NOT NULL,
	"draft" jsonb NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_plans_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "graphic_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"draft" jsonb NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graphic_templates_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "highlight_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"fact_id" uuid,
	"fact_revision" integer DEFAULT 0 NOT NULL,
	"output_id" uuid NOT NULL,
	"recipe_version" text NOT NULL,
	"request_key" text NOT NULL,
	"label" text NOT NULL,
	"target_capture_at" timestamp with time zone NOT NULL,
	"preroll_ms" integer NOT NULL,
	"postroll_ms" integer NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"mapping_confidence" text DEFAULT 'calibrated' NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"clip_id" uuid,
	"shortened" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "highlight_requests_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"organisation_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" uuid NOT NULL,
	"intent_hash" text NOT NULL,
	"command_type" text NOT NULL,
	"response" jsonb NOT NULL,
	"status_code" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_organisation_id_scope_key_pk" PRIMARY KEY("organisation_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'rtmp' NOT NULL,
	"team_id" uuid,
	"venue_id" uuid,
	"stream_key_enc" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"bound_session_id" uuid,
	"binding_version" integer DEFAULT 0 NOT NULL,
	"source_delay_ms" integer DEFAULT 0 NOT NULL,
	"calibration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inputs_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"scope_type" text,
	"scope_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_chk" CHECK ("invitations"."role" <> 'owner')
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "match_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"side" text,
	"team_id" uuid,
	"player_id" uuid,
	"payload" jsonb NOT NULL,
	"period_id" text NOT NULL,
	"clock_ms" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" text,
	"device_id" text,
	"command_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"historical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_facts_seq" UNIQUE("match_id","sequence"),
	CONSTRAINT "match_facts_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "match_facts_side_chk" CHECK ("match_facts"."side" is null or "match_facts"."side" in ('home','away'))
);
--> statement-breakpoint
CREATE TABLE "match_lineups" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"teams" jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_state" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'scheduled' NOT NULL,
	"projection" jsonb NOT NULL,
	"clocks" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"external_id" text,
	"round" text,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"venue_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"sport" text NOT NULL,
	"sport_rules_version" text NOT NULL,
	"rules_config" jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"theme_profile_version" jsonb,
	"game_plan_version_id" uuid,
	"scoring_source" text DEFAULT 'courtside' NOT NULL,
	"scorer_source_delay_ms" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "matches_teams_differ" CHECK ("matches"."home_team_id" <> "matches"."away_team_id")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_key" text NOT NULL,
	"original_mime" text,
	"detected_mime" text,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"expected_bytes" bigint,
	"checksum" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"state" text NOT NULL,
	"error" text,
	"owner_team_id" uuid,
	"retain_until" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_org" UNIQUE("organisation_id","user_id"),
	CONSTRAINT "memberships_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "memberships_role_chk" CHECK ("memberships"."role" in ('owner','admin','producer','operator','scorer','club_manager','viewer'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" text,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en-AU' NOT NULL,
	"timezone" text DEFAULT 'Australia/Brisbane' NOT NULL,
	"brand_color" text,
	"logo_asset_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organisation_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_seq" integer,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"broadcast_session_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"state" text NOT NULL,
	"fence" integer DEFAULT 1 NOT NULL,
	"preset" jsonb NOT NULL,
	"reporting_authority" text NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "output_sessions_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "overlay_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" text,
	"result_revision" integer,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlay_commands_uq" UNIQUE("overlay_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "overlay_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_version" integer NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlay_credentials_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "overlay_state" (
	"overlay_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"inhibited" boolean DEFAULT false NOT NULL,
	"scorebug_visible" boolean DEFAULT false NOT NULL,
	"layers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"displayed_revision" integer DEFAULT 0 NOT NULL,
	"displayed_at" timestamp with time zone,
	"owner_worker" text,
	"owner_fence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'graphics' NOT NULL,
	"output_id" uuid,
	"theme_profile_version_id" uuid,
	"theme_version_id" uuid,
	"game_plan_version_id" uuid,
	"pending_theme_profile_version_id" uuid,
	"public_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlays_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "overlays_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"action" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"short_name" text,
	"default_number" integer,
	"position" text,
	"photo_asset_id" uuid,
	"date_of_birth" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "provider_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"provider_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"fence" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"part_index" integer NOT NULL,
	"egress_id" text,
	"capture_start_at" timestamp with time zone,
	"playlist_key" text,
	"mp4_key" text,
	"input_delay_ms" integer DEFAULT 0 NOT NULL,
	"calibration_ms" integer DEFAULT 0 NOT NULL,
	"discontinuities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'RECORDING' NOT NULL,
	"duration_ms" integer,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_parts_uq" UNIQUE("recording_id","part_index")
);
--> statement-breakpoint
CREATE TABLE "recording_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"object_key" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"media_offset_ms" integer NOT NULL,
	"discontinuity" boolean DEFAULT false NOT NULL,
	"object_exists" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_segments_uq" UNIQUE("part_id","seq")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"output_session_id" uuid,
	"output_id" uuid,
	"kind" text DEFAULT 'programme' NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"storage_prefix" text NOT NULL,
	"mp4_key" text,
	"playlist_key" text,
	"duration_ms" integer,
	"probe" jsonb,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"retain_until" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "renderer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"instance_id" text NOT NULL,
	"is_reporting_authority" boolean DEFAULT false NOT NULL,
	"displayed_revision" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "roster_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"number" integer,
	"position" text,
	"valid_from" date,
	"valid_to" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorer_leases" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"holder_user_id" text,
	"holder_device_id" text,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"taken_over_from" text,
	"takeover_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "seasons_comp_name" UNIQUE("competition_id","name")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "sponsor_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"overlay_id" uuid,
	"placement" text NOT NULL,
	"campaign_id" uuid,
	"creative_id" uuid,
	"outcome" text NOT NULL,
	"reason" text,
	"inputs" jsonb NOT NULL,
	"request_key" text NOT NULL,
	"rehearsal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_decisions_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
CREATE TABLE "sponsor_exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"output_session_id" uuid,
	"decision_id" uuid,
	"campaign_id" uuid,
	"creative_id" uuid NOT NULL,
	"placement" text NOT NULL,
	"cue_id" text NOT NULL,
	"revision" integer NOT NULL,
	"evidence_type" text NOT NULL,
	"renderer_session_id" uuid,
	"interval_key" text NOT NULL,
	"first_visible_at" timestamp with time zone NOT NULL,
	"last_confirmed_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"visible_area" double precision,
	"destination_statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_exposures_interval_key_unique" UNIQUE("interval_key")
);
--> statement-breakpoint
CREATE TABLE "stream_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"input_id" uuid,
	"overlay_id" uuid,
	"mode" text NOT NULL,
	"name" text NOT NULL,
	"preset" text DEFAULT '720p30' NOT NULL,
	"record" boolean DEFAULT true NOT NULL,
	"hls" boolean DEFAULT true NOT NULL,
	"holding_slate" text DEFAULT 'waiting' NOT NULL,
	"preroll_seconds" integer DEFAULT 0 NOT NULL,
	"postroll_seconds" integer DEFAULT 120 NOT NULL,
	"calibration_ms" integer DEFAULT 0 NOT NULL,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"auto_schedule" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_outputs_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "stream_outputs_mode_chk" CHECK ("stream_outputs"."mode" in ('PROGRAMME','CLEAN'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"club_id" uuid,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"sport" text NOT NULL,
	"logo_asset_id" uuid,
	"primary_color" text DEFAULT '#3EA6FF' NOT NULL,
	"secondary_color" text DEFAULT '#0B1220' NOT NULL,
	"away_primary_color" text,
	"away_secondary_color" text,
	"grade" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_id_org" UNIQUE("id","organisation_id"),
	CONSTRAINT "teams_abbr_chk" CHECK (char_length("teams"."abbreviation") between 2 and 5)
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"scene" jsonb NOT NULL,
	"variables" jsonb NOT NULL,
	"layers" jsonb NOT NULL,
	"asset_ids" jsonb NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_uq" UNIQUE("template_id","version"),
	CONSTRAINT "template_versions_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "theme_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"theme_version_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tpv_uq" UNIQUE("profile_id","version"),
	CONSTRAINT "tpv_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "theme_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"competition_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_profiles_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "theme_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"supported_sports" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_versions_uq" UNIQUE("theme_id","version")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_occurrences" (
	"organisation_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_occurrences_overlay_id_occurrence_key_pk" PRIMARY KEY("overlay_id","occurrence_key")
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"module" text NOT NULL,
	"session_ref" text,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"interval_start" timestamp with time zone NOT NULL,
	"interval_end" timestamp with time zone NOT NULL,
	"dedup_key" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text NOT NULL,
	"input_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"last_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_uq" UNIQUE("endpoint_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_leases" (
	"resource" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"fence" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_campaign_id_organisation_id_campaigns_id_organisation_id_fk" FOREIGN KEY ("campaign_id","organisation_id") REFERENCES "public"."campaigns"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivatives" ADD CONSTRAINT "asset_derivatives_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivatives" ADD CONSTRAINT "asset_derivatives_asset_id_organisation_id_media_assets_id_organisation_id_fk" FOREIGN KEY ("asset_id","organisation_id") REFERENCES "public"."media_assets"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_cues" ADD CONSTRAINT "automation_cues_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_cues" ADD CONSTRAINT "automation_cues_run_id_organisation_id_automation_runs_id_organisation_id_fk" FOREIGN KEY ("run_id","organisation_id") REFERENCES "public"."automation_runs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_overlay_id_organisation_id_overlays_id_organisation_id_fk" FOREIGN KEY ("overlay_id","organisation_id") REFERENCES "public"."overlays"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_sessions" ADD CONSTRAINT "broadcast_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_organisation_id_brands_id_organisation_id_fk" FOREIGN KEY ("brand_id","organisation_id") REFERENCES "public"."brands"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_creative_set_id_organisation_id_creative_sets_id_organisation_id_fk" FOREIGN KEY ("creative_set_id","organisation_id") REFERENCES "public"."creative_sets"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_league_id_organisation_id_leagues_id_organisation_id_fk" FOREIGN KEY ("league_id","organisation_id") REFERENCES "public"."leagues"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compilations" ADD CONSTRAINT "compilations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_room_layouts" ADD CONSTRAINT "control_room_layouts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_sets" ADD CONSTRAINT "creative_sets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_sets" ADD CONSTRAINT "creative_sets_brand_id_organisation_id_brands_id_organisation_id_fk" FOREIGN KEY ("brand_id","organisation_id") REFERENCES "public"."brands"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_creative_set_id_organisation_id_creative_sets_id_organisation_id_fk" FOREIGN KEY ("creative_set_id","organisation_id") REFERENCES "public"."creative_sets"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_output_id_organisation_id_stream_outputs_id_organisation_id_fk" FOREIGN KEY ("output_id","organisation_id") REFERENCES "public"."stream_outputs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_corrections" ADD CONSTRAINT "fact_corrections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_corrections" ADD CONSTRAINT "fact_corrections_fact_id_organisation_id_match_facts_id_organisation_id_fk" FOREIGN KEY ("fact_id","organisation_id") REFERENCES "public"."match_facts"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_plan_versions" ADD CONSTRAINT "game_plan_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_plan_versions" ADD CONSTRAINT "game_plan_versions_game_plan_id_organisation_id_game_plans_id_organisation_id_fk" FOREIGN KEY ("game_plan_id","organisation_id") REFERENCES "public"."game_plans"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_plans" ADD CONSTRAINT "game_plans_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_templates" ADD CONSTRAINT "graphic_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight_requests" ADD CONSTRAINT "highlight_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inputs" ADD CONSTRAINT "inputs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_facts" ADD CONSTRAINT "match_facts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_facts" ADD CONSTRAINT "match_facts_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineups" ADD CONSTRAINT "match_lineups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineups" ADD CONSTRAINT "match_lineups_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_state" ADD CONSTRAINT "match_state_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_state" ADD CONSTRAINT "match_state_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_organisation_id_competitions_id_organisation_id_fk" FOREIGN KEY ("competition_id","organisation_id") REFERENCES "public"."competitions"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_id_organisation_id_seasons_id_organisation_id_fk" FOREIGN KEY ("season_id","organisation_id") REFERENCES "public"."seasons"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_organisation_id_teams_id_organisation_id_fk" FOREIGN KEY ("home_team_id","organisation_id") REFERENCES "public"."teams"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_organisation_id_teams_id_organisation_id_fk" FOREIGN KEY ("away_team_id","organisation_id") REFERENCES "public"."teams"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_organisation_id_venues_id_organisation_id_fk" FOREIGN KEY ("venue_id","organisation_id") REFERENCES "public"."venues"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_sessions" ADD CONSTRAINT "output_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_sessions" ADD CONSTRAINT "output_sessions_broadcast_session_id_organisation_id_broadcast_sessions_id_organisation_id_fk" FOREIGN KEY ("broadcast_session_id","organisation_id") REFERENCES "public"."broadcast_sessions"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_sessions" ADD CONSTRAINT "output_sessions_output_id_organisation_id_stream_outputs_id_organisation_id_fk" FOREIGN KEY ("output_id","organisation_id") REFERENCES "public"."stream_outputs"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_commands" ADD CONSTRAINT "overlay_commands_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_commands" ADD CONSTRAINT "overlay_commands_overlay_id_organisation_id_overlays_id_organisation_id_fk" FOREIGN KEY ("overlay_id","organisation_id") REFERENCES "public"."overlays"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_credentials" ADD CONSTRAINT "overlay_credentials_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_credentials" ADD CONSTRAINT "overlay_credentials_overlay_id_organisation_id_overlays_id_organisation_id_fk" FOREIGN KEY ("overlay_id","organisation_id") REFERENCES "public"."overlays"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_state" ADD CONSTRAINT "overlay_state_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_state" ADD CONSTRAINT "overlay_state_overlay_id_organisation_id_overlays_id_organisation_id_fk" FOREIGN KEY ("overlay_id","organisation_id") REFERENCES "public"."overlays"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_membership_id_organisation_id_memberships_id_organisation_id_fk" FOREIGN KEY ("membership_id","organisation_id") REFERENCES "public"."memberships"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_resources" ADD CONSTRAINT "provider_resources_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_parts" ADD CONSTRAINT "recording_parts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_parts" ADD CONSTRAINT "recording_parts_recording_id_organisation_id_recordings_id_organisation_id_fk" FOREIGN KEY ("recording_id","organisation_id") REFERENCES "public"."recordings"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renderer_sessions" ADD CONSTRAINT "renderer_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renderer_sessions" ADD CONSTRAINT "renderer_sessions_overlay_id_organisation_id_overlays_id_organisation_id_fk" FOREIGN KEY ("overlay_id","organisation_id") REFERENCES "public"."overlays"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_memberships" ADD CONSTRAINT "roster_memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_memberships" ADD CONSTRAINT "roster_memberships_player_id_organisation_id_players_id_organisation_id_fk" FOREIGN KEY ("player_id","organisation_id") REFERENCES "public"."players"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_memberships" ADD CONSTRAINT "roster_memberships_team_id_organisation_id_teams_id_organisation_id_fk" FOREIGN KEY ("team_id","organisation_id") REFERENCES "public"."teams"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_memberships" ADD CONSTRAINT "roster_memberships_season_id_organisation_id_seasons_id_organisation_id_fk" FOREIGN KEY ("season_id","organisation_id") REFERENCES "public"."seasons"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorer_leases" ADD CONSTRAINT "scorer_leases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorer_leases" ADD CONSTRAINT "scorer_leases_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competition_id_organisation_id_competitions_id_organisation_id_fk" FOREIGN KEY ("competition_id","organisation_id") REFERENCES "public"."competitions"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_decisions" ADD CONSTRAINT "sponsor_decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_exposures" ADD CONSTRAINT "sponsor_exposures_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_outputs" ADD CONSTRAINT "stream_outputs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_outputs" ADD CONSTRAINT "stream_outputs_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_outputs" ADD CONSTRAINT "stream_outputs_input_id_organisation_id_inputs_id_organisation_id_fk" FOREIGN KEY ("input_id","organisation_id") REFERENCES "public"."inputs"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_club_id_organisation_id_clubs_id_organisation_id_fk" FOREIGN KEY ("club_id","organisation_id") REFERENCES "public"."clubs"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_organisation_id_graphic_templates_id_organisation_id_fk" FOREIGN KEY ("template_id","organisation_id") REFERENCES "public"."graphic_templates"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_profile_versions" ADD CONSTRAINT "theme_profile_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_profile_versions" ADD CONSTRAINT "theme_profile_versions_theme_version_id_theme_versions_id_fk" FOREIGN KEY ("theme_version_id") REFERENCES "public"."theme_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_profile_versions" ADD CONSTRAINT "theme_profile_versions_profile_id_organisation_id_theme_profiles_id_organisation_id_fk" FOREIGN KEY ("profile_id","organisation_id") REFERENCES "public"."theme_profiles"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_profiles" ADD CONSTRAINT "theme_profiles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_versions" ADD CONSTRAINT "theme_versions_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_occurrences" ADD CONSTRAINT "trigger_occurrences_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "allocations_campaign_idx" ON "allocations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_logs" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "automation_cues_due_idx" ON "automation_cues" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "automation_runs_overlay_idx" ON "automation_runs" USING btree ("overlay_id","created_at");--> statement-breakpoint
CREATE INDEX "broadcast_sessions_match_idx" ON "broadcast_sessions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "capacity_active_idx" ON "capacity_reservations" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "clips_org_idx" ON "clips" USING btree ("organisation_id","match_id");--> statement-breakpoint
CREATE INDEX "competitions_org_idx" ON "competitions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "export_jobs_state_idx" ON "export_jobs" USING btree ("organisation_id","state");--> statement-breakpoint
CREATE INDEX "fact_corrections_fact_idx" ON "fact_corrections" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "highlight_requests_state_idx" ON "highlight_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "match_facts_match_idx" ON "match_facts" USING btree ("match_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_external_uq" ON "matches" USING btree ("organisation_id","competition_id","external_id");--> statement-breakpoint
CREATE INDEX "matches_org_sched_idx" ON "matches" USING btree ("organisation_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "media_assets_org_idx" ON "media_assets" USING btree ("organisation_id","kind","state");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("state","position");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "output_sessions_active_uq" ON "output_sessions" USING btree ("output_id") WHERE "output_sessions"."state" not in ('STOPPED','FAILED');--> statement-breakpoint
CREATE INDEX "overlay_commands_overlay_idx" ON "overlay_commands" USING btree ("overlay_id","created_at");--> statement-breakpoint
CREATE INDEX "overlay_credentials_overlay_idx" ON "overlay_credentials" USING btree ("overlay_id","purpose");--> statement-breakpoint
CREATE INDEX "overlays_match_idx" ON "overlays" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "grants_membership_idx" ON "permission_grants" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "players_org_idx" ON "players" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resources_uq" ON "provider_resources" USING btree ("provider","kind","provider_id");--> statement-breakpoint
CREATE INDEX "provider_resources_res_idx" ON "provider_resources" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "recording_segments_time_idx" ON "recording_segments" USING btree ("recording_id","start_at");--> statement-breakpoint
CREATE INDEX "recordings_match_idx" ON "recordings" USING btree ("organisation_id","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renderer_authority_uq" ON "renderer_sessions" USING btree ("overlay_id") WHERE "renderer_sessions"."is_reporting_authority" and "renderer_sessions"."disconnected_at" is null;--> statement-breakpoint
CREATE INDEX "roster_team_season_idx" ON "roster_memberships" USING btree ("team_id","season_id");--> statement-breakpoint
CREATE INDEX "share_links_resource_idx" ON "share_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sponsor_exposures_match_idx" ON "sponsor_exposures" USING btree ("organisation_id","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_outputs_match_mode_uq" ON "stream_outputs" USING btree ("match_id","mode");--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "themes_key_uq" ON "themes" USING btree ("organisation_id","key");--> statement-breakpoint
CREATE INDEX "usage_org_idx" ON "usage_ledger" USING btree ("organisation_id","module","interval_start");