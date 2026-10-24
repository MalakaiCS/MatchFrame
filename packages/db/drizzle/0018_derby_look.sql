-- Derby: a built-in look where each team plays in its own colour (packages/graphics/src/react/theme-derby.tsx): team
-- blocks with the crest breaking out of the end, a white score plate, scorers on the break board and a full-screen
-- statistics board between the teams' colour panels. An original design in the style of an Australian club football
-- broadcast, with no league or broadcaster marks. Immutable version 1.
INSERT INTO themes (id, organisation_id, key, name, description) VALUES ('00000000-0000-4000-a000-00000000000b', NULL, 'derby', 'Derby', 'Australian club football style: each team in its own colour, crests breaking out and a white score plate.') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO theme_versions (id, theme_id, version, supported_sports, config) VALUES ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-00000000000b', 1, '["football","basketball","netball","rugby_league","afl","hockey","futsal"]', '{"themeKey":"derby","primary":"#2443E0","secondary":"#15171C","accent":"#FFC629","text":"#15171C","panel":"#FFFFFF","font":"''Red Hat Display Variable'', ''Inter Variable'', ui-sans-serif, sans-serif","radius":0,"motion":"full","entranceMs":320,"exitMs":260,"safeArea":0.05,"scorebug":{"variant":"box","position":"left"}}') ON CONFLICT DO NOTHING;
