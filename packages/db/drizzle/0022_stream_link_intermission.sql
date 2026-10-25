ALTER TABLE "stream_channels" ADD COLUMN "intermission_after_minutes" integer;--> statement-breakpoint
ALTER TABLE "stream_channels" ADD COLUMN "pinned_intermission" boolean DEFAULT false NOT NULL;