import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../catalog';
import { DEFAULT_THEMES, LOOKS, THEME_KEYS } from '../data';
import { THEMES } from './index';

describe('built-in looks', () => {
  it('every look has defaults, a name and description, and draws every built-in graphic', () => {
    expect(THEME_KEYS).toHaveLength(10);
    for (const key of THEME_KEYS) {
      expect(DEFAULT_THEMES[key].themeKey).toBe(key);
      for (const c of ['primary', 'secondary', 'accent', 'text', 'panel'] as const) expect(DEFAULT_THEMES[key][c]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(LOOKS.find((l) => l.key === key)?.description).toBeTruthy();
      const missing = BUILTIN_TEMPLATES.map((t) => t.key.replace('builtin:', '')).filter((k) => typeof THEMES[key][k] !== 'function');
      expect(missing, `${key} is missing ${missing.join(', ')}`).toEqual([]);
    }
    expect(new Set(LOOKS.map((l) => l.key))).toEqual(new Set(THEME_KEYS));
  });
});
