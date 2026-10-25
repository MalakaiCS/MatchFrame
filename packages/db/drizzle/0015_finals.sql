-- Finals series: a match is regular season (counts for the ladder) or finals (knockout, left out of the ladder),
-- with its place in the bracket; a competition can keep its own rules for finals.
ALTER TABLE "competitions" ADD COLUMN "finals_rules_config" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "stage" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "bracket" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_stage_chk" CHECK ("matches"."stage" in ('regular','finals'));