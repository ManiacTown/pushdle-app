// One-time cleanup: seed-bots.mjs used to give some bots a flair emoji
// (only when their seeded stats actually earned it); bots shouldn't have
// any flair at all now — see the no-flair change in generateStats there.
// This clears selected_emoji on every already-created bot profile so the
// existing 50 match that going forward, without needing to delete and
// recreate any of them.
//
// Run with:
//   SB_URL=<supabase url> SB_SERVICE_KEY=<service_role key> node scripts/clear-bot-flair.mjs

import { BOT_USER_IDS } from '../src/lib/bots.js';

const url = process.env.SB_URL;
const serviceKey = process.env.SB_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Set SB_URL and SB_SERVICE_KEY env vars first.');
  process.exit(1);
}

const ids = Object.values(BOT_USER_IDS);
const res = await fetch(`${url}/rest/v1/profiles?id=in.(${ids.join(',')})`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Prefer: 'return=representation',
  },
  body: JSON.stringify({ selected_emoji: null }),
});
const data = await res.json();
if (!res.ok) {
  console.error('FAILED:', res.status, JSON.stringify(data));
  process.exit(1);
}
console.log(`cleared flair on ${data.length} bot profiles`);
