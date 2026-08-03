// Short synthesized sound effects (Web Audio API oscillators, no audio
// asset files) — fits the game's synthesized-neon look better than sampled
// audio, and skips any asset licensing/loading-size concerns entirely.
// Every cue here is deliberately tiny (well under half a second) and quiet
// (peak gain never above ~0.16) — the brief was "satisfying, not
// overpowering," so these are meant to sit under the visuals, not compete
// with them.

const MUTE_KEY = 'pushdle:soundMuted';

// One AudioContext for the whole app, created lazily — browsers block
// audio until a real user gesture, and every call site here already only
// runs from inside a click handler, so creating it on first use (rather
// than at module load) is both simpler and always safe.
let ctx = null;
function getCtx() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMuted();

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // localStorage unavailable (private browsing, etc.) — mute state just
    // won't persist across reloads, not worth failing over.
  }
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// A single short tone: ramps up fast (10ms, avoids a click/pop from
// starting at full volume instantly) then decays exponentially to silence
// over `duration` — the standard "plucked" envelope shape for a short UI
// blip. `freqEnd`, if given, glides the pitch from `freq` to it over the
// same duration (a rising or falling sweep, used for the success/bust
// cues below rather than a flat tone).
function tone({ freq, duration, type = 'sine', gain = 0.14, freqEnd, delay = 0 }) {
  if (muted) return;
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const start = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// A soft, low tap — plays immediately on every push, before the outcome
// (success/bust) is even known, so the button always feels like it
// physically responded to the press rather than waiting on the network/
// suspense delay to react at all.
export function playPush() {
  unlockFiles();
  tone({ freq: 190, freqEnd: 150, duration: 0.07, type: 'sine', gain: 0.1 });
}

// A brighter, rising chime on a successful push. Pitch climbs a little
// with the streak (capped so it never gets shrill on a long run) — a
// small, subtle echo of the same "climbing tension" idea the background
// glow/heartbeat already carry, not a competing effect.
export function playSuccess(streak = 0) {
  const base = 520 + Math.min(streak, 30) * 6;
  tone({ freq: base, freqEnd: base * 1.4, duration: 0.13, type: 'sine', gain: 0.13 });
}

// A dull, falling thud on bust — sawtooth (not sine) and low-pitched so it
// reads as an impact rather than another chime, sliding down rather than
// up to sell "the run just ended," and quieter than the push/success cues
// since a real bust already has the screen-flash/shake for the big
// reaction — this is just a quiet undertone, not the main event.
export function playBust() {
  tone({ freq: 150, freqEnd: 55, duration: 0.3, type: 'sawtooth', gain: 0.14 });
}

// A light, airy tick for moving between pages — nav bar/footer links, a
// leaderboard row opening a profile, a badge toast jumping to /profile,
// "back to leaderboard". Sine (not square — square's rich odd harmonics
// read as buzzy/sharp even at a quiet gain, which is exactly what this was
// getting complaints about), high and brief, so it barely registers as
// more than a soft tap.
export function playNav() {
  tone({ freq: 720, freqEnd: 900, duration: 0.045, type: 'sine', gain: 0.05 });
}

// Setting/clearing a badge as your leaderboard flair (see setFlair in
// Profile.jsx) — a clean two-tone "pop" (a fundamental plus a quieter
// octave layered on top, played together rather than in sequence), swapped
// in after the original triangle-wave sweep read as too reedy/buzzy. Flat
// pitch (no sweep) this time, which is most of why it reads as a rounder
// "pop" rather than a "blip." Deliberately distinct from playBadge (a NEW
// badge being earned, the bigger two-note reward sting played in
// sequence) — this is just toggling which already-earned badge is
// showing, a much smaller moment.
export function playBadgeSelect() {
  tone({ freq: 500, duration: 0.08, type: 'sine', gain: 0.08 });
  tone({ freq: 1000, duration: 0.06, type: 'sine', gain: 0.035 });
}

// The busted, idle button getting poked (see pokeBustedButton in
// Home.jsx) — a soft, dull "boop," quieter and duller than playPush (this
// isn't a real push, nothing is actually happening to the run), triangle
// instead of sine for a slightly flatter, more inert texture befitting
// tapping on something already broken.
export function playPoke() {
  tone({ freq: 240, freqEnd: 180, duration: 0.05, type: 'triangle', gain: 0.07 });
}

// The money bag getting poked once BANKED (see pokeMoneyBag in
// MoneyMode.jsx) — same soft, brief "poke" family as playPoke above (same
// duration/gain/triangle wave), not the sharper sampled coin-collect
// sound, which read as too sharp/clinky for an idle, already-resolved
// moment. Just a gentle upward drift instead of playPoke's downward one,
// enough to read as calm-and-content rather than dull-and-broken.
export function playBankPoke() {
  tone({ freq: 320, freqEnd: 380, duration: 0.06, type: 'triangle', gain: 0.07 });
}

// A small two-note sting for a new badge — the only cue with more than one
// note, since this is the one moment that's actually meant to feel like a
// little reward rather than just tactile feedback.
export function playBadge() {
  tone({ freq: 660, duration: 0.11, type: 'triangle', gain: 0.12 });
  tone({ freq: 880, duration: 0.16, type: 'triangle', gain: 0.12, delay: 0.09 });
}

// A soft filtered-noise whoosh — genuinely airy rather than another tone
// blip, which is why it's built differently from everything above (a short
// burst of white noise through a sweeping bandpass filter, not an
// oscillator). Used for the "Busted!" and "TOP X%" text sliding in during
// the bust reveal (see runBustSequence in Home.jsx) — both are the same
// kind of moment (a panel arriving on screen), so they share this one cue
// rather than needing their own bespoke sound each.
// Money-variant only — real sampled audio (public/coin-collect.mp3,
// public/coin-bank.mp3), not synthesized like everything above. These are
// layered ON TOP of the existing synthesized cues (playSuccess on a
// successful push, the click itself on cash-out) rather than replacing
// them, so nothing above needs to change. One cached Audio() per file,
// rewound to 0 on every play so rapid repeat pushes retrigger cleanly
// instead of queuing/cutting each other off.
const fileCache = {};
function playFile(path, volume = 0.4) {
  if (muted) return;
  let audio = fileCache[path];
  if (!audio) {
    audio = new Audio(path);
    fileCache[path] = audio;
  } else {
    audio.currentTime = 0;
  }
  audio.volume = volume;
  audio.play().catch(() => {});
}

// Mobile WebKit (iOS Safari) only allows a given HTMLMediaElement's play()
// to succeed once THAT SPECIFIC element has been played as a direct,
// synchronous consequence of a user gesture at least once — after that,
// it stays "unlocked" for the rest of the page's session, gesture or not.
// playCoinBank fires ~6s after the Cash Out click (via launchCoinToWallet's
// own setTimeout chain in MoneyMode.jsx), which is far enough removed from
// the original tap that WebKit can silently swallow it — this is what was
// actually reported as "the coin-hitting-the-vault sound doesn't play on
// phone." Priming both sampled files here, called from playPush (which —
// per this file's own top comment — always runs synchronously inside a
// real click handler, on literally every push in both modes), unlocks
// them well before playCoinBank's own much later call ever needs to fire.
let filesUnlocked = false;
function unlockFiles() {
  if (filesUnlocked) return;
  filesUnlocked = true;
  for (const path of ['/coin_collect.mp3', '/coin_bank.mp3']) {
    const audio = new Audio(path);
    fileCache[path] = audio;
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0.4;
      })
      .catch(() => {});
  }
}

// A successful push's coin popping out of the bag (see popCoin/MoneyMode.jsx).
export function playCoinCollect() {
  playFile('/coin_collect.mp3');
}

// The coin actually landing in the wallet on cash-out (see
// launchCoinToWallet/MoneyMode.jsx).
export function playCoinBank() {
  playFile('/coin_bank.mp3');
}

// Pressing the Cash Out button itself (see cashOut/MoneyMode.jsx) — a
// quick, rising confirm blip, deliberately distinct from playPush's
// falling thud (this is a deposit action, not a push) and from
// playCoinBank above (that one's reserved for the coin actually landing a
// couple seconds later, not the click that sets it in motion).
export function playBankPress() {
  tone({ freq: 300, freqEnd: 460, duration: 0.08, type: 'triangle', gain: 0.12 });
}

// The money-variant combo bar (see MoneyMode.jsx) filling up and
// resetting — a bright two-note "ding," the one other multi-note cue
// besides playBadge, since filling the bar is meant to feel like a small
// reward beat too, not just another tick.
export function playComboFull() {
  tone({ freq: 720, duration: 0.09, type: 'sine', gain: 0.11 });
  tone({ freq: 1080, duration: 0.14, type: 'sine', gain: 0.1, delay: 0.07 });
}

// A full combo bar rolling a diamond instead of the usual money bonus (see
// MoneyMode.jsx's push success branch and resolve_money_push's 10% roll)
// — a brighter, three-note ascending twinkle rather than playComboFull's
// two-note ding, since this is the rarer of the two possible payouts and
// should read as the bigger moment. Sine throughout (no triangle/sawtooth
// warmth) for a clean, glassy tone matching the diamond's own "crystal"
// look rather than something rounder.
export function playDiamond() {
  tone({ freq: 1200, duration: 0.09, type: 'sine', gain: 0.1 });
  tone({ freq: 1500, duration: 0.09, type: 'sine', gain: 0.11, delay: 0.06 });
  tone({ freq: 1900, duration: 0.16, type: 'sine', gain: 0.13, delay: 0.12 });
}

// The shop panel opening/closing (see the Shop button toggle in Home.jsx)
// — a quick rising sweep to open, the same sweep reversed (falling) to
// close, so the pair reads as one panel sliding out and back rather than
// two unrelated blips. Triangle (not sine) for a touch more "mechanical
// sliding" texture, distinct from the plainer confirm/nav tones elsewhere.
export function playShopOpen() {
  tone({ freq: 420, freqEnd: 640, duration: 0.09, type: 'triangle', gain: 0.09 });
}

export function playShopClose() {
  tone({ freq: 640, freqEnd: 420, duration: 0.08, type: 'triangle', gain: 0.08 });
}

// Weekly bust insurance saving an otherwise-lost run (see
// resolve_money_push's bust branch and MoneyMode.jsx's
// triggerInsuranceSave) — a warm, relieved two-note rise, triangle (not
// sine) to sit apart from playComboFull/playDiamond's brighter/glassier
// reward tones and playBankPress's sharper confirm blip. This is "relief,"
// not "reward" — a bust still happened, just a softened one.
export function playInsuranceSave() {
  tone({ freq: 340, freqEnd: 480, duration: 0.14, type: 'triangle', gain: 0.11 });
  tone({ freq: 480, freqEnd: 600, duration: 0.16, type: 'triangle', gain: 0.1, delay: 0.1 });
}

// The shield physically launching off the status pill toward the bag (see
// MoneyMode.jsx's runInsuranceRevealSequence/.money-shield-fly--jump in
// global.css) — played the instant the JUMP phase starts, not the moment
// the bust itself resolved. Two-part shape (a quick rising launch sweep
// immediately followed by a lower falling thud) so the cue itself reads
// as "leaping, then touching down," distinct from playInsuranceSave —
// that one's the separate "insurance worked" relief chime, deliberately
// held back until the later COVER phase instead of layering both cues
// at once, so the two beats read as distinct moments, not a rushed pair.
export function playShieldJump() {
  tone({ freq: 200, freqEnd: 720, duration: 0.12, type: 'sine', gain: 0.1 });
  tone({ freq: 900, freqEnd: 420, duration: 0.11, type: 'triangle', gain: 0.09, delay: 0.12 });
}

export function playReveal() {
  if (muted) return;
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const duration = 0.22;
  const start = audioCtx.currentTime;
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.6;
  filter.frequency.setValueAtTime(1800, start);
  filter.frequency.exponentialRampToValueAtTime(450, start + duration);
  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(0.05, start + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  noise.connect(filter).connect(gainNode).connect(audioCtx.destination);
  noise.start(start);
  noise.stop(start + duration + 0.02);
}
