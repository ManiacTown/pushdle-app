// Shared by Home.jsx (classic mode's own JSX) and MoneyMode.jsx — driving
// the classic <-> money mode-switch transition. Home.jsx owns the actual
// `modeTransition` state (see startModeSwitch there) since it's the one
// deciding which of the two mode branches is even mounted; this module is
// just the pure "given the current transition state and which numbered
// slot a piece of UI is, what inline style should it have" function, so
// both places animate off the exact same timing/keyframes instead of two
// hand-tuned copies drifting apart.
//
// Each mode's content is broken into a few numbered "slots" (0: main
// panel(s), 1: the push/bag button area, 2: description text, 3: anything
// else — cash-out button, resolved-reveal block, dead-state share
// buttons). On a switch, the CURRENTLY mounted mode's slots animate out
// in slot order (staggered by MODE_TRANSITION_SLOT_DELAY each), then the
// mode actually flips, then the newly-mounted mode's slots animate in in
// the same order. Only one mode is ever mounted at a time (matches the
// existing {uiMode === 'money' ? <MoneyMode/> : <classic/>} structure) —
// this is a sequential exit-then-enter, not two trees sliding past each
// other simultaneously.
export const MODE_TRANSITION_SLOT_DELAY = 40; // ms between each slot starting
export const MODE_TRANSITION_SLOT_DURATION = 170; // ms each slot's own animation takes
// Last slot (index 3) starts at 3*DELAY and runs DURATION more — that's
// how long one phase (exit, or enter) takes end to end.
export const MODE_TRANSITION_PHASE_MS = 3 * MODE_TRANSITION_SLOT_DELAY + MODE_TRANSITION_SLOT_DURATION;

// `transition` is null (no transition in progress) or
// { direction: 'forward'|'backward', phase: 'exit'|'enter' } — forward
// means classic-to-money (matches the "Money variant →" button's own
// arrow), backward means money-to-classic ("← Back to classic"). Forward
// exits slide left/enter from the right; backward is the mirror.
export function modeSlotStyle(transition, slotIndex) {
  if (!transition) return undefined;
  const { direction, phase } = transition;
  const delay = slotIndex * MODE_TRANSITION_SLOT_DELAY;
  const forward = direction === 'forward';
  let name;
  if (phase === 'exit') {
    name = forward ? 'modeSlideOutLeft' : 'modeSlideOutRight';
  } else {
    name = forward ? 'modeSlideInFromRight' : 'modeSlideInFromLeft';
  }
  return {
    animation: `${name} ${MODE_TRANSITION_SLOT_DURATION}ms ease-${phase === 'exit' ? 'in' : 'out'} forwards`,
    animationDelay: `${delay}ms`,
  };
}
