import { describe, it, expect } from 'vitest';
import { BOT_USERNAMES, BOT_USER_IDS } from './bots.js';

// "Today's streak" no longer has a client-side simulation to test — bots
// get a real daily_runs row from scripts/simulate-bot-day.mjs instead,
// read back through the exact same query path (and resolve_push odds) a
// real player's run goes through. What's left here is just the roster's
// own integrity.
describe('BOT_USERNAMES', () => {
  it('has no duplicate names', () => {
    const lower = BOT_USERNAMES.map((n) => n.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('every username has a matching BOT_USER_IDS entry', () => {
    for (const name of BOT_USERNAMES) {
      expect(typeof BOT_USER_IDS[name]).toBe('string');
    }
  });
});
