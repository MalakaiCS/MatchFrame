-- Token and host lookups that must work before a tenant context exists (the API role is under forced RLS).
CREATE OR REPLACE FUNCTION resolve_match_public_token(p_token text) RETURNS TABLE(match_id uuid, organisation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, organisation_id FROM matches WHERE public_token IS NOT NULL AND public_token = p_token
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_match_public_token(text) TO bs_app, bs_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_branding_host(p_host text) RETURNS TABLE(id uuid, name text, branding jsonb, logo_asset_id uuid, brand_color text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, branding, logo_asset_id, brand_color FROM organisations WHERE custom_domain IS NOT NULL AND custom_domain = p_host AND status = 'active'
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_branding_host(text) TO bs_app, bs_worker;
