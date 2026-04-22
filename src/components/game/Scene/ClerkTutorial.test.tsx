// @vitest-environment jsdom
/**
 * Tests for ClerkTutorial component.
 * Mocks useTutorial and useAudioPlayer to isolate the rendering/UX logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mock useTutorial + useAudioPlayer before importing the component.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useTutorial', () => ({
  useTutorial: vi.fn(),
}));

vi.mock('@/hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(),
}));

import { ClerkTutorial } from './ClerkTutorial';
import { useTutorial } from '@/hooks/useTutorial';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

// ---------------------------------------------------------------------------
// Step text constants (mirror STEP_TEXT from component — avoid import coupling)
// ---------------------------------------------------------------------------

const STEP_TEXT: Record<number, string> = {
  1: 'Court is in session. Before your trial, let me brief you on the rules.',
  2: 'The rank called each round is here.',
  3: 'Tap one or two cards from your hand. A HOLD TO SPEAK button will appear — press and hold it, then call "one queen" or "two queens" (or whatever rank the court is demanding). The rank is locked each round, but the cards you actually play can be anything. Tell the truth, or bluff. The defendant will listen to your voice and decide whether to believe you.',
  4: 'Win by emptying your hand, or by catching him in three lies. If YOU get caught bluffing, you take a strike — three strikes and you lose the session.',
  5: 'The defendant just made his claim. Listen for the tells. Do you believe him?',
  6: 'Well played. Keep winning rounds to advance through the court.',
  7: 'Court is now in recess. Good luck.',
};

// ---------------------------------------------------------------------------
// Default mock setup helpers
// ---------------------------------------------------------------------------

const defaultAdvance = vi.fn();
const defaultSkip = vi.fn();
const defaultPlay = vi.fn();
const defaultOnEnded = vi.fn();

function setupMocks({
  step = 1 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
  active = true,
  isPlaying = false,
}: {
  step?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  active?: boolean;
  isPlaying?: boolean;
} = {}) {
  (useTutorial as Mock).mockReturnValue({
    step,
    active,
    advance: defaultAdvance,
    skip: defaultSkip,
  });

  (useAudioPlayer as Mock).mockReturnValue({
    play: defaultPlay,
    isPlaying,
    onEnded: defaultOnEnded,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClerkTutorial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @testing-library/react doesn't auto-cleanup without globals; wire it here
  // so successive render() calls don't pile up tutorial-backdrop nodes.
  afterEach(() => {
    cleanup();
  });

  it('1. Returns null when tutorial inactive (returning user)', () => {
    setupMocks({ step: 0, active: false });

    const { container } = render(<ClerkTutorial session={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. Renders speech bubble with step 1 text on first mount', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const bubble = screen.getByTestId('tutorial-bubble');
    expect(bubble).toBeTruthy();
    expect(bubble.textContent).toContain(STEP_TEXT[1]);
  });

  it('3. "Got it →" button is disabled while audio is playing', () => {
    setupMocks({ step: 1, active: true, isPlaying: true });

    render(<ClerkTutorial session={null} />);

    const gotItBtn = screen.getByTestId('tutorial-got-it') as HTMLButtonElement;
    expect(gotItBtn.disabled).toBe(true);
  });

  it('4. "Got it →" button is enabled when audio is not playing', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const gotItBtn = screen.getByTestId('tutorial-got-it') as HTMLButtonElement;
    expect(gotItBtn.disabled).toBe(false);
  });

  it('5. Clicking "Got it →" calls advance()', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const gotItBtn = screen.getByTestId('tutorial-got-it');
    fireEvent.click(gotItBtn);

    expect(defaultAdvance).toHaveBeenCalledTimes(1);
  });

  it('6. Clicking "Skip All" calls skip()', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const skipBtn = screen.getByTestId('tutorial-skip');
    fireEvent.click(skipBtn);

    expect(defaultSkip).toHaveBeenCalledTimes(1);
  });

  it('7. Renders correct step text for each of steps 1-7', () => {
    for (let stepNum = 1; stepNum <= 7; stepNum++) {
      vi.clearAllMocks();
      setupMocks({ step: stepNum as 1 | 2 | 3 | 4 | 5 | 6 | 7, active: true, isPlaying: false });

      const { container, unmount } = render(<ClerkTutorial session={null} />);

      const stepText = container.querySelector('[data-testid="tutorial-step-text"]');
      expect(stepText, `Step ${stepNum} text element should exist`).toBeTruthy();
      expect(
        stepText?.textContent,
        `Step ${stepNum} should show correct text`,
      ).toContain(STEP_TEXT[stepNum].slice(0, 40)); // partial match to avoid escaping issues

      unmount();
    }
  });

  it('8. When step === 5 → speech bubble shows step 5 text', () => {
    setupMocks({ step: 5, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const stepText = screen.getByTestId('tutorial-step-text');
    expect(stepText.textContent).toContain(STEP_TEXT[5]);
  });

  it('9. Clerk sprite placeholder renders with CLERK label', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const sprite = screen.getByTestId('clerk-sprite');
    expect(sprite).toBeTruthy();
    expect(sprite.textContent).toContain('CLERK');
  });

  it('10. Backdrop renders with pointer-events: none so gameplay is not blocked', () => {
    setupMocks({ step: 1, active: true, isPlaying: false });

    render(<ClerkTutorial session={null} />);

    const backdrop = screen.getByTestId('tutorial-backdrop');
    expect(backdrop).toBeTruthy();
    expect(backdrop.style.pointerEvents).toBe('none');
  });
});
