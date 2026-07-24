import { describe, it, expect, afterEach, vi } from 'vitest';
import { pacificDateString, msUntilNextPacificMidnight } from './pacificDate.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('pacificDateString', () => {
  it('flips at 08:00 UTC during PST (winter) — the fixed UTC-8 hour', () => {
    expect(pacificDateString(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
    expect(pacificDateString(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15');
  });

  it('flips at 07:00 UTC during PDT (summer) — not the fixed PST hour', () => {
    expect(pacificDateString(new Date('2026-07-24T06:59:00Z'))).toBe('2026-07-23');
    expect(pacificDateString(new Date('2026-07-24T07:00:00Z'))).toBe('2026-07-24');
  });

  it('defaults to the current system time when no date is passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
    expect(pacificDateString()).toBe('2026-03-10');
  });
});

describe('msUntilNextPacificMidnight', () => {
  it('returns a full day right at Pacific midnight', () => {
    expect(msUntilNextPacificMidnight(new Date('2026-07-24T07:00:00Z'))).toBe(86400000);
  });

  it('counts down as the Pacific day elapses', () => {
    // One hour past Pacific midnight (still PDT, so 08:00 UTC = 1am local).
    expect(msUntilNextPacificMidnight(new Date('2026-07-24T08:00:00Z'))).toBe(86400000 - 3600000);
  });

  it('is down to about a second just before the next Pacific midnight', () => {
    const ms = msUntilNextPacificMidnight(new Date('2026-07-25T06:59:59Z'));
    expect(ms).toBeLessThanOrEqual(1000);
    expect(ms).toBeGreaterThan(0);
  });
});
