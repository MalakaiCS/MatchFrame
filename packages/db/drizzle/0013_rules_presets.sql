-- An organisation's own rules presets per sport, offered beside the built-in ones.
CREATE TABLE "rules_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"sport" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_presets_id_org" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
ALTER TABLE "rules_presets" ADD CONSTRAINT "rules_presets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_presets_name_uq" ON "rules_presets" USING btree ("organisation_id","sport","name");--> statement-breakpoint
ALTER TABLE "rules_presets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rules_presets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "rules_presets" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
