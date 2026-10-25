// Partial updates. zod 4's .partial() still fills in a field's .default() when the field is left out, so an update
// that names only a team's logo would reset its colours to the defaults (and editing a note or a webhook would
// reset its kind or switch it back on). Parse the update, then keep only the fields it gave.
import type { z } from 'zod';

export function parsePatch<S extends z.ZodType>(schema: S, input: object): Partial<z.output<S>> {
  const parsed = schema.parse(input) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in input)) as Partial<z.output<S>>;
}
