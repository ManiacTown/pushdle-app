// Player-facing changelog for the /updates page — hand-written, not
// generated from git log directly (commit messages are written for other
// engineers, not players), but every entry traces back to a real commit on
// the date shown. Newest first. Add a new entry here whenever a real
// player-visible change ships; skip pure refactors/internal fixes that
// nobody outside the codebase would ever notice.
export const CHANGELOG = [
  {
    date: '2026-08-03',
    title: 'Money Mode buff and a round of bug fixes',
    items: [
      'Money Mode odds are now a real, better 97% you live · 3% you don’t.',
      'The Money Mode switch button now steps out of the way while a classic run is in progress, and slides back in smoothly once it’s over.',
      'Fixed badge pop-ups showing badges you’d already earned as if they were brand new — this hit Money Mode especially hard.',
      'Fixed the coin-hitting-the-vault sound not playing on some phones.',
      'The weekly Money Mode leaderboard podium now only ever shows a real, completed week.',
      'Swapped the insurance shield emoji for a proper icon everywhere it shows up.',
      'New players get a smoother start on their very first classic run.',
    ],
  },
  {
    date: '2026-07-31',
    title: 'Shop panel fix and small cleanup',
    items: [
      'Fixed another case where the shop panel could get cut off at the bottom, this time on mobile.',
      'Fixed a typo in the "How to play" section.',
      'Added a Discord icon to the nav bar, right next to "How to play" — click it to join the server.',
      'Tabs left open in the background now pick up new updates more reliably instead of occasionally getting stuck on an old version.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'Polish pass',
    items: [
      'Money Mode now unlocks automatically the first time you play a classic run — no more waiting around for it.',
      'The shop panel now resizes smoothly when you switch tabs instead of snapping.',
      'Fixed a visual bug where the shop panel’s border could get clipped off on some tabs.',
      'New badge pop-ups now fade away on their own a few seconds after appearing.',
      'Added a Discord link to the footer — come hang out.',
    ],
  },
  {
    date: '2026-07-29',
    title: 'Cosmetics and weekly insurance',
    items: [
      'The Money Mode shop is now organized into tabs: push-button skins, name colors, row backgrounds, and upgrades.',
      'Added a Cosmetics section to your Profile page for equipping anything you’ve bought.',
      'Added Weekly Bust Insurance — once a week, a bust banks half your run instead of losing it all.',
    ],
  },
  {
    date: '2026-07-28',
    title: 'Diamond shop opens',
    items: [
      'Added Diamonds — a new currency you can earn while playing Money Mode.',
      'Opened the first shop item: a Diamond-themed push-button skin for classic mode.',
      'Cleaned up the leaderboard so a genuinely empty tab no longer looks like a broken one.',
      'Accessibility improvements to the login form and leaderboard podium.',
    ],
  },
  {
    date: '2026-07-27',
    title: 'Money Mode badges and a weekly leaderboard',
    items: [
      'Added a full set of Money Mode badges, plus a weekly money leaderboard with a live countdown.',
      '"New badge earned" pop-ups now show up for Money Mode too, not just classic.',
      'Behind-the-scenes hardening to keep badge and stat data honest.',
    ],
  },
  {
    date: '2026-07-24',
    title: 'Onboarding, and a first look at Money Mode',
    items: [
      'Added a "how to play" welcome guide for first-time visitors.',
      'Started building Money Mode — a real-cash-style variant sitting alongside classic streak mode.',
      'Fixed a bug that could let account stats be tampered with.',
    ],
  },
  {
    date: '2026-07-23',
    title: 'Pushdle launches',
    items: [
      'Pushdle goes live: tap to push, keep your streak alive, one run a day.',
      'Added the daily leaderboard and account creation, so your streaks are saved and ranked.',
      'Added Share and Copy buttons so you can show off (or commiserate about) your run.',
      'Pushdle is now installable as an app on your phone’s home screen.',
      'Fixed the daily reset to actually happen at Pacific midnight instead of UTC, so the leaderboard doesn’t flip hours early for most players.',
    ],
  },
];
