ALTER TABLE "automation_runs" ADD COLUMN "playlist_kind" text DEFAULT 'in_play' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "promotional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "overlay_state" ADD COLUMN "slots" jsonb DEFAULT '{}'::jsonb NOT NULL;