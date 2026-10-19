-- Built-in original themes (organisation_id NULL = available to every tenant). Immutable version 1.
INSERT INTO themes (id, organisation_id, key, name, description) VALUES ('00000000-0000-4000-a000-000000000001', NULL, 'minimal', 'Minimal', 'Flat light panels, hairline rules and a single-row scorebug.') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO theme_versions (id, theme_id, version, supported_sports, config) VALUES ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 1, '["football","basketball"]', '{"themeKey": "minimal", "primary": "#F3F6FB", "secondary": "#0B1220", "accent": "#3EA6FF", "text": "#0B1220", "panel": "#F3F6FB", "font": "Inter Variable", "radius": 2, "motion": "subtle", "entranceMs": 220, "exitMs": 200, "safeArea": 0.05}') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO themes (id, organisation_id, key, name, description) VALUES ('00000000-0000-4000-a000-000000000002', NULL, 'broadcast', 'Broadcast', 'Dark angled panels, team-colour stripes and slide motion.') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO theme_versions (id, theme_id, version, supported_sports, config) VALUES ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 1, '["football","basketball"]', '{"themeKey": "broadcast", "primary": "#3EA6FF", "secondary": "#0B1220", "accent": "#FFCE66", "text": "#F3F6FB", "panel": "#131F32", "font": "Inter Variable", "radius": 4, "motion": "full", "entranceMs": 320, "exitMs": 260, "safeArea": 0.05}') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO themes (id, organisation_id, key, name, description) VALUES ('00000000-0000-4000-a000-000000000003', NULL, 'club', 'Club', 'Team colours forward, rounded badges and centred layouts.') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO theme_versions (id, theme_id, version, supported_sports, config) VALUES ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000003', 1, '["football","basketball"]', '{"themeKey": "club", "primary": "#55D99D", "secondary": "#0B1220", "accent": "#FFFFFF", "text": "#FFFFFF", "panel": "#1C2C43", "font": "Inter Variable", "radius": 18, "motion": "subtle", "entranceMs": 280, "exitMs": 240, "safeArea": 0.05}') ON CONFLICT DO NOTHING;
