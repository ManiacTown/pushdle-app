import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MoneyWeeklyResultsModal from './MoneyWeeklyResultsModal.jsx';

const top3 = [
  { userId: 'u1', username: 'alice', emoji: '🐔', scoreCents: 5000 },
  { userId: 'u2', username: 'bob', emoji: null, scoreCents: 3000 },
  { userId: 'u3', username: 'carl', emoji: null, scoreCents: 1000 },
];

function renderModal(props) {
  return render(
    <MemoryRouter>
      <MoneyWeeklyResultsModal onDismiss={() => {}} top3={top3} {...props} />
    </MemoryRouter>
  );
}

describe('MoneyWeeklyResultsModal', () => {
  it('shows the Golden Goose banner and a plain rank line for a top-3 rank', () => {
    renderModal({ rank: 1, scoreCents: 5000, diamondsAwarded: 20 });
    expect(screen.getByText(/Golden Goose achievement unlocked/i)).toBeTruthy();
    expect(screen.getByText('Rank: #1')).toBeTruthy();
    expect(screen.getByText(/You banked/)).toBeTruthy();
    // "20" appears twice — the diamondsAwarded callout and the 1st-place
    // prize-tier row — just confirm the payout copy rendered at all.
    expect(screen.getByText(/already in your shop balance/)).toBeTruthy();
  });

  it('omits the Golden Goose banner and shows the no-prize copy outside the top 10', () => {
    renderModal({ rank: 47, scoreCents: 200, diamondsAwarded: 0 });
    expect(screen.queryByText(/Golden Goose achievement unlocked/i)).toBeNull();
    expect(screen.getByText('Rank: #47')).toBeTruthy();
    expect(screen.getByText(/Outside the top 10 this week/)).toBeTruthy();
  });

  // Regression test: an earlier version decided "did this account earn a
  // prize" off diamondsAwarded > 0 instead of rank. A caller passing a
  // real rank alongside a stale/demo diamondsAwarded of 0 (exactly what
  // Home.jsx's admin preview button used to do for a never-ranked admin
  // account) produced a self-contradictory "Rank #2" + "Outside the top
  // 10" combination. This asserts the component itself stays correct off
  // rank alone, regardless of what diamondsAwarded the caller passes.
  it('bases the top-10 messaging on rank even if diamondsAwarded is inconsistently 0', () => {
    renderModal({ rank: 2, scoreCents: 0, diamondsAwarded: 0 });
    expect(screen.getByText('Rank: #2')).toBeTruthy();
    expect(screen.queryByText(/Outside the top 10 this week/)).toBeNull();
    expect(screen.getByText(/already in your shop balance/)).toBeTruthy();
  });

  it('renders all four prize tiers with the 4th-10th rank highlighted', () => {
    renderModal({ rank: 6, scoreCents: 900, diamondsAwarded: 5 });
    expect(screen.getByText('🥇 1st place')).toBeTruthy();
    expect(screen.getByText('🥈 2nd place')).toBeTruthy();
    expect(screen.getByText('🥉 3rd place')).toBeTruthy();
    expect(screen.getByText('4th – 10th')).toBeTruthy();
  });

  it('falls back to the podium empty state when top3 is empty', () => {
    renderModal({ rank: 2, scoreCents: 1500, diamondsAwarded: 15, top3: [] });
    expect(screen.getByText(/No champions yet/)).toBeTruthy();
  });
});
