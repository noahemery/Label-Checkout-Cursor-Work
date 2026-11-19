import { describe, expect, it } from 'vitest';
import { computeRunQuantities, formatRunsSummary } from './splitRuns';

describe('computeRunQuantities — D365 Split column', () => {
  it('splits into full runs with the remainder last', () => {
    expect(computeRunQuantities(900, 250)).toEqual([250, 250, 250, 150]);
  });

  it('is one run when there is no split or the split covers the order', () => {
    expect(computeRunQuantities(900, null)).toEqual([900]);
    expect(computeRunQuantities(900, 900)).toEqual([900]);
    expect(computeRunQuantities(900, 0)).toEqual([900]);
  });

  it('has no runs for an empty order', () => {
    expect(computeRunQuantities(0, 250)).toEqual([]);
  });
});

describe('formatRunsSummary', () => {
  it('summarizes equal runs and a remainder', () => {
    expect(formatRunsSummary(900, 250)).toBe('250 × 3 + 150');
    expect(formatRunsSummary(3000, 1000)).toBe('1000 × 3');
  });

  it('shows a dash for a single run', () => {
    expect(formatRunsSummary(900, null)).toBe('—');
  });
});
