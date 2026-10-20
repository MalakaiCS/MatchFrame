-- Premier look, version 2: the motion graphics pack style (deep purple glass, angular facets, a cyan-to-magenta rule,
-- white score plates, Outfit type). Published versions are immutable, so this is a new version; profiles published
-- on version 1 keep it until they are published again.
UPDATE themes SET description = 'Deep purple glass panels cut with angular facets, a cyan-to-magenta rule, white score plates and a geometric typeface: the top-flight football broadcast look.' WHERE id = '00000000-0000-4000-a000-000000000004';
--> statement-breakpoint
INSERT INTO theme_versions (id, theme_id, version, supported_sports, config) VALUES ('00000000-0000-4000-b000-000000000014', '00000000-0000-4000-a000-000000000004', 2, '["football","basketball","netball","rugby_league","afl","hockey"]', '{"themeKey": "premier", "primary": "#E90052", "secondary": "#37003C", "accent": "#04F5FF", "text": "#37003C", "panel": "#FFFFFF", "font": "''Outfit Variable'', ''Inter Variable'', ui-sans-serif, sans-serif", "radius": 10, "motion": "full", "entranceMs": 360, "exitMs": 280, "safeArea": 0.05, "scorebug": {"variant": "box", "position": "left"}, "stings": true}') ON CONFLICT DO NOTHING;
