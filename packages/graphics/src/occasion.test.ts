import { describe, expect, it } from 'vitest';
import { occasionLine } from './data';

describe('occasion line under the match header', () => {
  const competition = { name: 'Coastal League', shortName: null, logoUrl: null };
  it('shows the round beside the competition in the finals only', () => {
    expect(occasionLine({ competition, round: 'Grand Final', stage: 'finals' })).toBe('Coastal League · Grand Final');
    expect(occasionLine({ competition, round: '12', stage: 'regular' })).toBe('Coastal League');
    expect(occasionLine({ competition, round: null, stage: 'finals' })).toBe('Coastal League');
    expect(occasionLine({ competition })).toBe('Coastal League');
  });
});
