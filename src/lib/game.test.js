import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SUCCESS_CHANCE,
  FIRST_PRESS_SUCCESS_CHANCE,
  rollPush,
  formatRarity,
  rarityForStreak,
  earnedBadges,
  buildShareText,
  BADGES,
  BADGE_EMOJI,
  RARITY_META,
} from './game.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rollPush', () => {
  it('uses the first-press chance only at streak 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(FIRST_PRESS_SUCCESS_CHANCE - 0.0001);
    expect(rollPush(0)).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(FIRST_PRESS_SUCCESS_CHANCE + 0.00001);
    expect(rollPush(0)).toBe(false);
  });

  it('uses the normal chance for any streak beyond the first press', () => {
    vi.spyOn(Math, 'random').mockReturnValue(SUCCESS_CHANCE - 0.001);
    expect(rollPush(1)).toBe(true);
    expect(rollPush(50)).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(SUCCESS_CHANCE + 0.001);
    expect(rollPush(1)).toBe(false);
  });
});

describe('rarityForStreak', () => {
  it('is exactly 100% at streak 0 (guaranteed survival of zero presses)', () => {
    expect(rarityForStreak(0)).toBe(100);
  });

  it('matches the documented 0.9^streak formula', () => {
    expect(rarityForStreak(1)).toBeCloseTo(90, 5);
    expect(rarityForStreak(10)).toBeCloseTo(Math.pow(0.9, 10) * 100, 5);
  });

  it('decreases monotonically as streak grows', () => {
    const a = rarityForStreak(10);
    const b = rarityForStreak(20);
    expect(b).toBeLessThan(a);
  });
});

describe('formatRarity', () => {
  it('shows two decimals under 1%', () => {
    expect(formatRarity(0.5)).toBe('0.50%');
  });

  it('shows one decimal between 1% and 10%', () => {
    expect(formatRarity(5.5)).toBe('5.5%');
  });

  it('rounds to a whole number at 10% and above', () => {
    expect(formatRarity(50.4)).toBe('50%');
    expect(formatRarity(10)).toBe('10%');
  });
});

describe('earnedBadges', () => {
  it('earns nothing from all-zero stats', () => {
    const stats = { bestStreak: 0, totalPushes: 0, dayStreak: 0, bustedAtZero: false, bustedAtOne: false };
    expect(earnedBadges(stats)).toEqual([]);
  });

  it('earns exactly the badges whose threshold is met, not ones above it', () => {
    const stats = { bestStreak: 20, totalPushes: 0, dayStreak: 0, bustedAtZero: false, bustedAtOne: false };
    const ids = earnedBadges(stats).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['streak-1', 'streak-10', 'streak-20']));
    expect(ids).not.toContain('streak-30');
  });

  it('treats the two bust badges independently of streak/push stats', () => {
    const stats = { bestStreak: 0, totalPushes: 0, dayStreak: 0, bustedAtZero: true, bustedAtOne: false };
    const ids = earnedBadges(stats).map((b) => b.id);
    expect(ids).toContain('bust-0');
    expect(ids).not.toContain('bust-1');
  });

  it('every badge id is unique', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('BADGE_EMOJI', () => {
  it('only maps badges that are rare or above', () => {
    for (const id of Object.keys(BADGE_EMOJI)) {
      const badge = BADGES.find((b) => b.id === id);
      expect(badge, `BADGE_EMOJI references unknown badge id "${id}"`).toBeTruthy();
      expect(badge.rarity).not.toBe('common');
    }
  });

  it('every emoji flair value is unique (so picking one always identifies one badge)', () => {
    const values = Object.values(BADGE_EMOJI);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every rare-and-up badge has an assigned emoji', () => {
    const rareUp = BADGES.filter((b) => b.rarity !== 'common');
    for (const b of rareUp) {
      expect(BADGE_EMOJI[b.id], `${b.id} (${b.rarity}) has no flair emoji`).toBeTruthy();
    }
  });
});

describe('buildShareText', () => {
  const url = 'https://pushdle.example';

  it('calls out busting on the very first push specially', () => {
    const text = buildShareText({ streak: 0, url });
    expect(text).toContain('very first push');
    expect(text).toContain('🔴');
    expect(text).not.toContain('🟢');
  });

  it('includes the exact streak count and one green circle per push', () => {
    const text = buildShareText({ streak: 5, url });
    expect(text).toContain('survived 5 pushes');
    expect(text).toContain('🟢🟢🟢🟢🟢🔴');
  });

  it('uses singular "push" for a streak of exactly 1', () => {
    expect(buildShareText({ streak: 1, url })).toContain('survived 1 push ');
  });

  it('is uncapped — a megastreak gets its full, ridiculous row of circles', () => {
    const text = buildShareText({ streak: 40, url });
    expect(text).toContain('🟢'.repeat(40) + '🔴');
    expect(text).toContain('survived 40 pushes');
  });

  it('always includes the passed-in url', () => {
    expect(buildShareText({ streak: 3, url })).toContain(url);
  });
});

describe('RARITY_META', () => {
  it('has an entry for every rarity used by a badge', () => {
    const usedRarities = new Set(BADGES.map((b) => b.rarity));
    for (const r of usedRarities) {
      expect(RARITY_META[r]).toBeTruthy();
    }
  });
});
