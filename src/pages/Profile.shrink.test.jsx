import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile from './Profile.jsx';

// Regression test for a real bug: the username-shrink effect used to write
// name.style.fontSize directly via a ref while the JSX's own style prop
// still hardcoded fontSize: 22. That works on the render that computes the
// shrink, but any *unrelated* re-render of Profile (one the effect's
// dependency array doesn't cover) makes React re-apply the JSX's literal
// 22 and silently undoes the shrink. Fixed by routing the value through
// state instead of writing the DOM directly. This test forces exactly that
// "unrelated re-render" and asserts the shrunk size survives it.

const mockUser = { id: 'u1', user_metadata: { username: 'A'.repeat(20) }, email: 'test@test.com' };
const mockStats = { bestStreak: 5, totalPushes: 10, dayStreak: 3, bustedAtZero: false, bustedAtOne: false };

vi.mock('../lib/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
    selectedEmoji: null,
    updateSelectedEmoji: vi.fn(),
    stats: mockStats,
  }),
}));

vi.mock('../lib/spotlight.js', () => ({
  spotlightMove: () => {},
}));

// jsdom has no layout engine — getBoundingClientRect/scrollWidth are always
// 0 unless stubbed. Widths chosen so the row is deliberately too narrow for
// the 20-char username at its base 22px size, forcing a real shrink.
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.id === 'test-marker-row' || this.getAttribute?.('data-row') === '1') {
      return { width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40 };
    }
    if (this.tagName === 'BUTTON') {
      return { width: 80, height: 30, top: 0, left: 0, right: 80, bottom: 30 };
    }
    if (this.className?.toString?.().includes('mono')) {
      return { width: 30, height: 20, top: 0, left: 0, right: 30, bottom: 20 };
    }
    return { width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40 };
  });
  Object.defineProperty(Element.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      // Roughly proportional to current font-size, like real text would be.
      const fontSize = parseFloat(this.style?.fontSize) || 22;
      return this.tagName === 'H2' ? fontSize * 12 : 0;
    },
  });
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

describe('Profile username shrink survives unrelated re-renders', () => {
  beforeEach(() => {
    localStorage.clear();
    stubLayout();
  });

  it('keeps the shrunk font-size after a re-render the effect does not depend on', async () => {
    // Harness wraps Profile with its own state so we can force a re-render
    // of Profile without touching `user` or `stats.dayStreak` — exactly
    // the "unrelated re-render" scenario the bug depended on.
    let forceRerender;
    function Harness() {
      const [, setTick] = useState(0);
      forceRerender = () => setTick((t) => t + 1);
      return (
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      );
    }

    await act(async () => {
      render(<Harness />);
    });

    const h2 = screen.getByText(mockUser.user_metadata.username);
    const shrunkSize = parseFloat(h2.style.fontSize);
    // Row is 300px, the Log out button + gap eat a chunk of it, natural text
    // width at 22px is 20*22*12 (way over 300) — it must have shrunk below 22.
    expect(shrunkSize).toBeLessThan(22);
    expect(shrunkSize).toBeGreaterThanOrEqual(12); // the documented floor

    await act(async () => {
      forceRerender();
    });

    const h2After = screen.getByText(mockUser.user_metadata.username);
    expect(parseFloat(h2After.style.fontSize)).toBe(shrunkSize);
  });
});
