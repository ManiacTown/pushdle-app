// Push-button subtext quips (see Home.jsx, which shows one of these in
// place of the default "1 in 10 chance this ends it." text every 3
// pushes once the streak reaches 3). Grouped into tiers by streak so the
// tone escalates alongside the actual odds — light teasing early, full
// unhinged-legend energy by the time you're deep into "this shouldn't be
// possible" territory — while staying clever/humorous throughout, never
// actually grim. Each tier's `max` is inclusive; the last tier has none
// (covers everything above its min).

const TIER_1 = {
  min: 3,
  max: 9,
  quotes: [
    'Ooh, look at you go.',
    'Still feeling lucky?',
    'Cute streak. Keep going?',
    'The button trusts you. Mostly.',
    'Baby steps, big dreams.',
    "You're on a roll. Literally.",
    'So far so good. Suspiciously good.',
    'Confidence: rising. Wisdom: pending.',
    'This is fine. Probably.',
    'Not bad for a rookie.',
    'The odds are still smiling.',
    'Keep this up and people will notice.',
    'Small streak, big ego incoming.',
    "You call this a warm-up?",
    'Every legend starts somewhere.',
    '10% still says hi.',
    'Nothing to see here. Yet.',
    'The math still likes you.',
    'Early days. Stay humble.',
    'One push closer to bragging rights.',
    'Green light. For now.',
    "You've survived worse decisions.",
    'This could be a fluke. Could be.',
    "The button hasn't judged you. Yet.",
    'Warming up the RNG gods.',
    'Low stakes, high hopes.',
    'You again? Bold.',
    'Consider this a gentle warning.',
    'So far, purely theoretical bravery.',
    "The streak is cute. Don't get attached.",
  ],
};

const TIER_2 = {
  min: 10,
  max: 19,
  quotes: [
    "Okay, now you're just showing off.",
    'The house is starting to notice you.',
    'This is where people usually mess up.',
    'Double digits. Double the regret potential.',
    "You should probably stop. You won't.",
    'The odds are quietly recalculating.',
    'Bragging rights unlocked. Barely.',
    'Somewhere, a badge is being drafted.',
    "This is the part where it gets dumb.",
    'Your luck owes somebody money.',
    "10% is still a real number, you know.",
    'The button is starting to sweat.',
    'Ego: inflating. Odds: unchanged.',
    'Legends and idiots look identical right now.',
    "You're one push from a great story.",
    'This is either skill or delusion.',
    "The math hasn't forgotten about you.",
    'Getting greedy is a whole personality now.',
    'People will ask "why didn\'t you stop."',
    'Your ancestors are cautiously proud.',
    "You're basically gambling with extra steps.",
    'The streak is watching you back.',
    'This is the "famous last words" zone.',
    'Somewhere a stat sheet just got interesting.',
    'The button respects you. Barely.',
    'Double digits. RNG is taking notes.',
    'This is your villain origin arc.',
    'Confidence has left the building.',
    "You're not lucky. You're just early.",
    'Every push is a tiny act of defiance.',
  ],
};

const TIER_3 = {
  min: 20,
  max: 39,
  quotes: [
    'This is objectively a bad decision.',
    'Your common sense filed a complaint.',
    '20+. The RNG gods are whispering.',
    'This is how legends and idiots overlap.',
    'The odds are personally offended now.',
    "You're not pushing your luck. You're bullying it.",
    'Somewhere, statisticians are stress-eating.',
    'This streak has its own gravity now.',
    'The button has started praying for you.',
    "You've entered main-character odds territory.",
    'This is fine. This is definitely fine.',
    'Your luck is running on fumes and spite.',
    'The house wants a word with you.',
    'This is either genius or a cry for help.',
    "You've made the RNG uncomfortable.",
    'Somewhere, a badge is sweating.',
    "This is the streak your friends won't believe.",
    "You're daring the math to intervene.",
    'The odds keep shrinking. You keep smiling.',
    'This is a documented cry for chaos.',
    'You\'ve unlocked "concerning levels of luck."',
    'Even confidence is starting to get nervous.',
    'This streak deserves its own theme music.',
    "You're not tempting fate. You're dating it.",
    'The math has started taking this personally.',
    'This is peak "one more push" energy.',
    'Somewhere, a probability class just got harder.',
    "You've officially left reasonable behind.",
    'This is either history or a really good story.',
    'The RNG is quietly furious with you.',
  ],
};

const TIER_4 = {
  min: 40,
  max: Infinity,
  quotes: [
    'At this point you ARE the odds.',
    'The RNG has given up and started clapping.',
    "This shouldn't be possible. And yet.",
    "You've broken math. Congratulations.",
    'Somewhere, 0.9 to the 40th is crying in a corner.',
    'The house has stopped pretending to be calm.',
    'This is no longer luck. This is a lifestyle.',
    'You are the reason statisticians drink.',
    'Legends will be written. Poorly, but written.',
    "The button has never seen anything like you.",
    'This streak needs a warning label.',
    "You've made probability theory personal.",
    'Somewhere, a leaderboard is shaking.',
    'The RNG gods have requested a meeting.',
    'This is what myths are made of.',
    "You're not playing the game anymore. You're haunting it.",
    'Even the odds are asking for a break.',
    'This streak is a statistical crime scene.',
    "You've achieved main-character immunity. Allegedly.",
    "The math has stopped trying to warn you.",
    'This is beyond luck. This is a phenomenon.',
    'Somewhere, a badge is being invented just for this.',
    "You've made 10% feel like a lie.",
    'This is the streak people will not believe.',
    'The RNG has filed for early retirement.',
    "You're not pushing your luck. You're wearing it as armor.",
    'This is unreasonable. Beautifully unreasonable.',
    'Even fate is taking notes at this point.',
    "You've turned probability into a personal grudge.",
    'This streak belongs in a museum.',
  ],
};

const QUOTE_TIERS = [TIER_1, TIER_2, TIER_3, TIER_4];

export function getQuoteForStreak(streak) {
  const tier = QUOTE_TIERS.find((t) => streak >= t.min && streak <= t.max) ?? QUOTE_TIERS[QUOTE_TIERS.length - 1];
  const pool = tier.quotes;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Same idea, but for the "Run over. Come back tomorrow." subtext once
// busted (see Home.jsx) — one extra tier below TIER_1's streak-3 floor,
// since a bust can happen at streak 0 (no push-quip tier ever covers
// that), and the tone here reacts to how far the run actually got rather
// than escalating turn-by-turn the way the live quips do.
const BUST_TIER_0 = {
  min: 0,
  max: 2,
  quotes: [
    'Well, that escalated quickly.',
    "Bold strategy. Didn't pay off.",
    'The math got you early this time.',
    'That was fast. Impressively fast.',
    'Zero to busted in record time.',
    'Not even a warm-up. Rude.',
    'The RNG had other plans.',
    "That's one way to start the day.",
    'Efficient. Devastating, but efficient.',
    'The button remembers this.',
    'Tomorrow is a fresh start. Use it.',
    'Statistically rare. Personally annoying.',
    'You blinked and it was over.',
    'That 1% found you fast.',
    'A short story with a sad ending.',
  ],
};

const BUST_TIER_1 = {
  min: 3,
  max: 9,
  quotes: [
    "A modest run, a familiar ending.",
    'You had a good few pushes there.',
    "Every streak's gotta end somewhere.",
    "That's a respectable little run.",
    'Not legendary, but not nothing.',
    'The odds finally caught up.',
    'Solid effort. The button remains undefeated.',
    'You gave it a shot. It gave you nothing.',
    'A humble streak, humbly ended.',
    'Well, you tried. Kind of.',
    'The house always collects eventually.',
    "That's a story you'll tell once.",
    'Short-lived, but full of hope.',
    "Not your day. Try again tomorrow.",
    'The streak had potential. Had.',
  ],
};

const BUST_TIER_2 = {
  min: 10,
  max: 19,
  quotes: [
    'Double digits, then double the pain.',
    'So close to something impressive.',
    'The math finally had its say.',
    'That was a genuinely good run.',
    'You almost had a great story.',
    'The RNG waited. Then it struck.',
    'A real run, a real ending.',
    "That one's going to sting a little.",
    'You pushed your luck. It pushed back.',
    'Respectable. Painfully respectable.',
    "The odds don't do almost.",
    'That was a real effort. Real bust, too.',
    'You earned that bad feeling.',
    'A solid streak, gone in an instant.',
    'The button finally won one.',
  ],
};

const BUST_TIER_3 = {
  min: 20,
  max: 39,
  quotes: [
    'That was going to be a legend. Was.',
    "The RNG couldn't let that slide.",
    'A masterpiece, ruined at the last second.',
    "That's going to haunt you a little.",
    'You built something incredible. Then, poof.',
    'The math finally got its revenge.',
    'That was too good to last. Literally.',
    'A tragedy in the finest sense.',
    "You'll be thinking about this one tomorrow.",
    'The odds waited a long time for that.',
    'That deserved a better ending.',
    'Somewhere, the RNG is celebrating.',
    'A genuine heartbreaker.',
    'You flew too close to the leaderboard.',
    'That run earned its own eulogy.',
  ],
};

const BUST_TIER_4 = {
  min: 40,
  max: Infinity,
  quotes: [
    'That was basically a religious experience. Then it ended.',
    'The universe finally balanced the books.',
    'You broke the game. The game broke back.',
    'That deserved a standing ovation, not a bust.',
    'History will remember this run. And this ending.',
    'The RNG had to end that eventually. Eventually.',
    "That's a run people will ask you about for years.",
    'You were basically unkillable. Basically.',
    'The math waited as long as it possibly could.',
    'That ending hurt the whole leaderboard.',
    'A legend, felled by a single percent.',
    'You made the impossible look routine. Until now.',
    'Somewhere, the odds are finally exhaling.',
    'That run belonged in a museum. Now it\'s a memory.',
    'The button will talk about this one for a while.',
  ],
};

const BUST_QUOTE_TIERS = [BUST_TIER_0, BUST_TIER_1, BUST_TIER_2, BUST_TIER_3, BUST_TIER_4];

export function getBustQuoteForStreak(streak) {
  const tier = BUST_QUOTE_TIERS.find((t) => streak >= t.min && streak <= t.max) ?? BUST_QUOTE_TIERS[BUST_QUOTE_TIERS.length - 1];
  const pool = tier.quotes;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Clicking the button after it's already busted for the day (see
// pokeBustedButton in Home.jsx) doesn't restart anything — it's a dead
// button for the rest of the day — but every few pokes gets one of these
// instead of the regular bust quote, briefly, rather than just doing
// nothing. Not reacting to how far the run got (unlike the bust quotes
// above) since this is commentary on the poking itself, not the run.
const POKE_QUOTES = [
  "It's not going to un-bust itself.",
  'Poking it will not help. Also, please stop.',
  "Still broken. Still your fault.",
  'The button has nothing left to give.',
  "That's not how any of this works.",
  'Denial is not a valid strategy.',
  "It's resting. Unlike you, apparently.",
  'Tomorrow. Not now. Tomorrow.',
  'The crack is decorative now. Leave it be.',
  "You've made your point. Several times.",
  'This is between you and your patience now.',
  'The button has filed a complaint.',
  'Knocking will not open this door.',
  "Persistent. Wrong, but persistent.",
];

export function getPokeQuip() {
  return POKE_QUOTES[Math.floor(Math.random() * POKE_QUOTES.length)];
}

// ---- Money variant (see MoneyMode.jsx) ----
// Flat pools, not tiered by pushes/earnings like the classic quotes above
// — money runs are much shorter on average (95% survival vs. classic's
// 90%, but busting is still real, and cash-out ends most runs early
// anyway), so there's less of a natural "escalating tone" arc to hang a
// tier system on. Money-flavored humor (greed, banking, risk) rather than
// reusing the streak-flavored lines above.

const MONEY_QUOTES = [
  "Greed is a strategy. A bad one, but a strategy.",
  'The bag is heavier now. Coincidence?',
  "You could stop. You won't.",
  'Every push is a tiny negotiation with regret.',
  'The bank teller has questions.',
  "This is fine. It's all still theoretical money.",
  'Diversifying your portfolio, one push at a time.',
  'The house always has a cut. This is not the house.',
  "You're not gambling. You're 'investing.'",
  'Somewhere, a financial advisor is sighing.',
  'The bag knows you want more. It always knows.',
  'Cash out is right there. Right there.',
  "One more push. Very responsible of you.",
  'This is technically a savings plan.',
  'The math still takes its 5% eventually.',
  "You've made banking look like an extreme sport.",
  'The bag is starting to feel personal.',
  'Risk it for the biscuit. Or the rent.',
  "Your wallet is watching this happen live.",
  'This is the opposite of a rainy day fund.',
];

export function getMoneyQuote() {
  return MONEY_QUOTES[Math.floor(Math.random() * MONEY_QUOTES.length)];
}

// Idle text once a money run busts — picked once at the moment it happens
// and held (not re-rolled by poking, unlike POKE_QUOTES above), same as
// classic's bustQuote. Busting in money mode loses only this run's
// unbanked earnings, so the tone leans "that money's gone, not you."
const MONEY_BUST_QUOTES = [
  'The bag ran out of luck before you did.',
  'That money is gone. You, presumably, are fine.',
  'Unbanked and unbothered? Let\'s go with that.',
  'The bag bit back. It happens.',
  'Well, that was theoretical money anyway.',
  "Easy come, easier go.",
  'The house always collects eventually.',
  'That cash-out button was right there.',
  "You'll bank it next time. Probably.",
  'A bold run, an unbanked ending.',
  'The bag has trust issues now.',
  'Some money you never really had.',
  "That's a lesson in diversification.",
  'The math finally sent an invoice.',
  'Tomorrow, the bag resets. So do you.',
];

export function getMoneyBustQuote() {
  return MONEY_BUST_QUOTES[Math.floor(Math.random() * MONEY_BUST_QUOTES.length)];
}

// Idle text once a money run is successfully banked — picked once at the
// moment it happens, same pattern as the bust quote above but with the
// opposite energy (satisfied, a little smug) since this is the one good
// outcome the mode has.
const MONEY_BANK_QUOTES = [
  'Locked in. The bag respects discipline.',
  "That's the whole game, actually: knowing when to stop.",
  'Real money now. Not theoretical anymore.',
  'The wallet just got a little heavier.',
  'A rare display of restraint. Well played.',
  "You beat the bag at its own game.",
  'That one actually made it to the bank.',
  'Greed: managed. Bag: defeated.',
  'The math owes you one, for once.',
  'Cashed out, no regrets, mostly.',
  'A responsible adult decision. Shocking.',
  'The bag is a little lighter. Your wallet is not.',
  "That's what a win looks like around here.",
  'Banked and unbothered.',
  'The house did not, in fact, always win.',
];

export function getMoneyBankQuote() {
  return MONEY_BANK_QUOTES[Math.floor(Math.random() * MONEY_BANK_QUOTES.length)];
}
