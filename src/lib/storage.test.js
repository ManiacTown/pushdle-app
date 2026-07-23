import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as storage from './storage.js';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setDay(isoDate) {
  vi.setSystemTime(new Date(`${isoDate}T12:00:00Z`));
}

describe('getItem/setItem/removeItem', () => {
  it('round-trips a value and namespaces the raw localStorage key', () => {
    return storage.setItem('foo', { a: 1 }).then(async () => {
      expect(await storage.getItem('foo')).toEqual({ a: 1 });
      expect(localStorage.getItem('pushdle:foo')).toBe('{"a":1}');
    });
  });

  it('returns null instead of throwing on corrupted JSON', async () => {
    localStorage.setItem('pushdle:broken', '{not valid json');
    expect(await storage.getItem('broken')).toBeNull();
  });

  it('removeItem clears the namespaced key', async () => {
    await storage.setItem('x', 1);
    await storage.removeItem('x');
    expect(await storage.getItem('x')).toBeNull();
  });
});

describe('getTodayState / saveTodayState', () => {
  it('defaults to a fresh playing run when nothing is saved', async () => {
    setDay('2026-07-21');
    expect(await storage.getTodayState()).toEqual({
      date: '2026-07-21',
      streak: 0,
      status: 'playing',
      newBestToday: false,
    });
  });

  it('returns the saved run when it matches today', async () => {
    setDay('2026-07-21');
    await storage.saveTodayState({ streak: 5, status: 'playing', newBestToday: true });
    expect(await storage.getTodayState()).toMatchObject({ streak: 5, status: 'playing', newBestToday: true });
  });

  it('discards a stale run from a previous day', async () => {
    setDay('2026-07-21');
    await storage.saveTodayState({ streak: 12, status: 'dead', newBestToday: false });
    setDay('2026-07-22');
    expect(await storage.getTodayState()).toEqual({
      date: '2026-07-22',
      streak: 0,
      status: 'playing',
      newBestToday: false,
    });
  });
});

describe('getBestStreak / setBestStreak', () => {
  it('defaults to 0', async () => {
    expect(await storage.getBestStreak()).toBe(0);
  });

  it('persists whatever is set', async () => {
    await storage.setBestStreak(42);
    expect(await storage.getBestStreak()).toBe(42);
  });
});

describe('getStats', () => {
  it('fills in defaults for any missing fields', async () => {
    await storage.setItem('stats', { totalPushes: 3 });
    expect(await storage.getStats()).toEqual({
      totalPushes: 3,
      dayStreak: 0,
      lastPlayedDate: null,
      bustedAtZero: false,
      bustedAtOne: false,
    });
  });
});

describe('incrementTotalPushes', () => {
  it('increments from whatever the current count is', async () => {
    await storage.saveStats({ totalPushes: 9, dayStreak: 0, lastPlayedDate: null, bustedAtZero: false, bustedAtOne: false });
    const updated = await storage.incrementTotalPushes();
    expect(updated.totalPushes).toBe(10);
    expect(await storage.getStats()).toMatchObject({ totalPushes: 10 });
  });
});

describe('recordDailyPlay', () => {
  it('starts a brand-new day streak at 1', async () => {
    setDay('2026-07-21');
    const updated = await storage.recordDailyPlay();
    expect(updated.dayStreak).toBe(1);
    expect(updated.lastPlayedDate).toBe('2026-07-21');
  });

  it('is a no-op if already recorded today (does not double-increment)', async () => {
    setDay('2026-07-21');
    await storage.recordDailyPlay();
    const second = await storage.recordDailyPlay();
    expect(second.dayStreak).toBe(1);
  });

  it('extends the streak when played on the very next calendar day', async () => {
    setDay('2026-07-21');
    await storage.recordDailyPlay();
    setDay('2026-07-22');
    const updated = await storage.recordDailyPlay();
    expect(updated.dayStreak).toBe(2);
  });

  it('resets to 1 if a day was skipped', async () => {
    setDay('2026-07-21');
    await storage.recordDailyPlay();
    setDay('2026-07-23'); // skipped the 22nd
    const updated = await storage.recordDailyPlay();
    expect(updated.dayStreak).toBe(1);
  });
});

describe('resetBadgeProgress', () => {
  it('wipes both bestStreak and the stats blob', async () => {
    await storage.setBestStreak(99);
    await storage.saveStats({ totalPushes: 500, dayStreak: 30, lastPlayedDate: '2026-07-20', bustedAtZero: true, bustedAtOne: true });
    await storage.resetBadgeProgress();
    expect(await storage.getBestStreak()).toBe(0);
    expect(await storage.getStats()).toEqual({
      totalPushes: 0,
      dayStreak: 0,
      lastPlayedDate: null,
      bustedAtZero: false,
      bustedAtOne: false,
    });
  });
});

describe('getSelectedEmoji / setSelectedEmoji', () => {
  it('defaults to null and round-trips a value', async () => {
    expect(await storage.getSelectedEmoji()).toBeNull();
    await storage.setSelectedEmoji('🔥');
    expect(await storage.getSelectedEmoji()).toBe('🔥');
  });
});
