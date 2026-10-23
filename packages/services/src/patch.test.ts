import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parsePatch } from './patch';

describe('partial updates', () => {
  const schema = z.object({ name: z.string().trim(), colour: z.string().default('#3EA6FF'), enabled: z.boolean().default(true) }).partial();
  it('leave out the fields not given, whatever their defaults', () => {
    // what .partial() alone does: the defaults come back
    expect(schema.parse({ name: 'x' })).toEqual({ name: 'x', colour: '#3EA6FF', enabled: true });
    expect(parsePatch(schema, { name: '  Harbour ' })).toEqual({ name: 'Harbour' });
    expect(parsePatch(schema, { enabled: false })).toEqual({ enabled: false });
    expect(parsePatch(schema, {})).toEqual({});
  });
  it('still checks what is given', () => {
    expect(() => parsePatch(schema, { enabled: 'yes' })).toThrow();
  });
});
