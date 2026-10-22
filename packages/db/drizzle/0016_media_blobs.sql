-- Files kept in the database when object storage cannot take them (small files: images, logos, fonts).
CREATE TABLE "media_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_blobs" ADD CONSTRAINT "media_blobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_blobs_org_idx" ON "media_blobs" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "media_blobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "media_blobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_blobs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
