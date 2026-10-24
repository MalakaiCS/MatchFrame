-- Row-level security and least-privilege grants. Roles bs_app / bs_worker are created by src/migrate.ts.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_org_ids(p_user text) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organisation_id FROM memberships WHERE user_id = p_user AND status = 'active'
$$;
--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "allocations" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_keys" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "asset_derivatives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_derivatives" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "asset_derivatives" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_logs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "automation_cues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_cues" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "automation_cues" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "automation_runs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "brands" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "broadcast_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "broadcast_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "broadcast_sessions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "campaigns" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "capacity_reservations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capacity_reservations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "capacity_reservations" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "clips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clips" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "clips" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "clubs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clubs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "clubs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "competitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "competitions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "compilations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compilations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "compilations" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "control_room_layouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "control_room_layouts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "control_room_layouts" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "creative_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "creative_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "creative_sets" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "creatives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "creatives" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "creatives" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "destinations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "destinations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "destinations" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "export_jobs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "fact_corrections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fact_corrections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fact_corrections" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "game_plan_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "game_plan_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "game_plan_versions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "game_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "game_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "game_plans" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "graphic_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "graphic_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "graphic_templates" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "highlight_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "highlight_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "highlight_requests" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "idempotency_records" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inputs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "leagues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leagues" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leagues" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "match_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_facts" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "match_lineups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_lineups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_lineups" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "match_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_state" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_state" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "matches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "matches" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_assets" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "outbox_events" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "output_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "output_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "output_sessions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "overlay_commands" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overlay_commands" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "overlay_commands" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "overlay_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overlay_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "overlay_credentials" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "overlay_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overlay_state" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "overlay_state" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "overlays" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overlays" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "overlays" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "permission_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permission_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "permission_grants" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "players" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "players" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "provider_resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "provider_resources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "provider_resources" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "recording_parts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recording_parts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recording_parts" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "recording_segments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recording_segments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recording_segments" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recordings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recordings" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "renderer_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "renderer_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "renderer_sessions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "roster_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "roster_memberships" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "scorer_leases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scorer_leases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scorer_leases" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "seasons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seasons" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "seasons" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "share_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "share_links" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "sponsor_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sponsor_decisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sponsor_decisions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "sponsor_exposures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sponsor_exposures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sponsor_exposures" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "stream_outputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stream_outputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stream_outputs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "teams" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "template_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "template_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "template_versions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "theme_profile_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "theme_profile_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "theme_profile_versions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "theme_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "theme_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "theme_profiles" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "trigger_occurrences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trigger_occurrences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trigger_occurrences" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "usage_ledger" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "venues" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "venues" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_deliveries" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoints" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_read ON organisations FOR SELECT TO bs_app USING (id = app_current_org() OR id IN (SELECT app_user_org_ids(app_current_user())));
--> statement-breakpoint
CREATE POLICY org_write ON organisations FOR INSERT TO bs_app WITH CHECK (id = app_current_org());
--> statement-breakpoint
CREATE POLICY org_update ON organisations FOR UPDATE TO bs_app USING (id = app_current_org()) WITH CHECK (id = app_current_org());
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON memberships FOR SELECT TO bs_app USING (organisation_id = app_current_org() OR user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY membership_write ON memberships FOR ALL TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "themes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "themes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY theme_read ON themes FOR SELECT TO bs_app USING (organisation_id IS NULL OR organisation_id = app_current_org());
--> statement-breakpoint
CREATE POLICY theme_write ON themes FOR ALL TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO bs_app, bs_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bs_app, bs_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bs_app, bs_worker;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM bs_app, bs_worker;
--> statement-breakpoint
REVOKE DELETE ON match_facts, fact_corrections FROM bs_app, bs_worker;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON theme_versions FROM bs_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_overlay_credential(p_hash text)
RETURNS TABLE(organisation_id uuid, overlay_id uuid, purpose text, token_version int, revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organisation_id, c.overlay_id, c.purpose, c.token_version, c.revoked_at IS NOT NULL
  FROM overlay_credentials c WHERE c.token_hash = p_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_share_link(p_public_id text)
RETURNS TABLE(organisation_id uuid, id uuid, resource_type text, resource_id uuid, token_hash text, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.organisation_id, s.id, s.resource_type, s.resource_id, s.token_hash, s.expires_at, s.revoked_at FROM share_links s WHERE s.public_id = p_public_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_invitation(p_hash text)
RETURNS TABLE(organisation_id uuid, id uuid, email text, role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.organisation_id, i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at FROM invitations i WHERE i.token_hash = p_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_api_key(p_prefix text)
RETURNS TABLE(organisation_id uuid, id uuid, key_hash text, scopes jsonb, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.organisation_id, k.id, k.key_hash, k.scopes, k.expires_at, k.revoked_at FROM api_keys k WHERE k.prefix = p_prefix
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_overlay_credential(text), resolve_share_link(text), resolve_invitation(text), resolve_api_key(text), app_user_org_ids(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_overlay_credential(text), resolve_share_link(text), resolve_invitation(text), resolve_api_key(text), app_user_org_ids(text) TO bs_app, bs_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'published versions are immutable (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END $$;
--> statement-breakpoint
CREATE TRIGGER theme_versions_immutable BEFORE UPDATE OR DELETE ON "theme_versions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER theme_profile_versions_immutable BEFORE UPDATE OR DELETE ON "theme_profile_versions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER template_versions_immutable BEFORE UPDATE OR DELETE ON "template_versions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER game_plan_versions_immutable BEFORE UPDATE OR DELETE ON "game_plan_versions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE remaining int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active')) THEN
    SELECT count(*) INTO remaining FROM memberships
      WHERE organisation_id = OLD.organisation_id AND role = 'owner' AND status = 'active' AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'an organisation must keep at least one owner' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER memberships_last_owner BEFORE UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('outbox', NEW.topic); RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_notify AFTER INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION outbox_notify();
--> statement-breakpoint
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "entitlements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "entitlements" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
