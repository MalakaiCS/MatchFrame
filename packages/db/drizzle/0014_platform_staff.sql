CREATE TABLE "platform_audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" text,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"organisation_id" uuid,
	"reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"source" text DEFAULT 'granted' NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_role_chk" CHECK ("platform_staff"."role" in ('owner','admin','moderator','support')),
	CONSTRAINT "platform_staff_source_chk" CHECK ("platform_staff"."source" in ('granted','config'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_target_idx" ON "platform_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
-- Site staff read every organisation, membership and plan (directories); everything else of an organisation only
-- inside that organisation's tenant context, as for its members. Writes stay tenant-scoped.
CREATE OR REPLACE FUNCTION app_staff_role(p_user text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM platform_staff WHERE user_id = p_user
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_role(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_role(text) TO bs_app, bs_worker;
--> statement-breakpoint
CREATE POLICY staff_read ON organisations FOR SELECT TO bs_app USING ((SELECT app_staff_role(app_current_user())) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY staff_read ON memberships FOR SELECT TO bs_app USING ((SELECT app_staff_role(app_current_user())) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY staff_read ON entitlements FOR SELECT TO bs_app USING ((SELECT app_staff_role(app_current_user())) IS NOT NULL);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON platform_audit_logs FROM bs_app, bs_worker;
--> statement-breakpoint
-- A suspended organisation's outputs, public match pages, share links, API keys and invitations stop resolving.
CREATE OR REPLACE FUNCTION resolve_overlay_credential(p_hash text)
RETURNS TABLE(organisation_id uuid, overlay_id uuid, purpose text, token_version int, revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organisation_id, c.overlay_id, c.purpose, c.token_version, c.revoked_at IS NOT NULL
  FROM overlay_credentials c JOIN organisations o ON o.id = c.organisation_id AND o.status = 'active' WHERE c.token_hash = p_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_share_link(p_public_id text)
RETURNS TABLE(organisation_id uuid, id uuid, resource_type text, resource_id uuid, token_hash text, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.organisation_id, s.id, s.resource_type, s.resource_id, s.token_hash, s.expires_at, s.revoked_at
  FROM share_links s JOIN organisations o ON o.id = s.organisation_id AND o.status = 'active' WHERE s.public_id = p_public_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_invitation(p_hash text)
RETURNS TABLE(organisation_id uuid, id uuid, email text, role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.organisation_id, i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
  FROM invitations i JOIN organisations o ON o.id = i.organisation_id AND o.status = 'active' WHERE i.token_hash = p_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_api_key(p_prefix text)
RETURNS TABLE(organisation_id uuid, id uuid, key_hash text, scopes jsonb, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.organisation_id, k.id, k.key_hash, k.scopes, k.expires_at, k.revoked_at
  FROM api_keys k JOIN organisations o ON o.id = k.organisation_id AND o.status = 'active' WHERE k.prefix = p_prefix
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_match_public_token(p_token text) RETURNS TABLE(match_id uuid, organisation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.organisation_id FROM matches m JOIN organisations o ON o.id = m.organisation_id AND o.status = 'active'
  WHERE m.public_token IS NOT NULL AND m.public_token = p_token
$$;
