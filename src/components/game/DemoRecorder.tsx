'use client';

/**
 * DemoRecorder — deterministic shot-state environment for OBS recording.
 *
 * NOT reachable from /game. Mounted at /demo-record. Uses the real Scene /
 * TopBar / PlayerControls components with synthetic ClientSession props,
 * bypassing useGameSession / API / AI / TTS entirely.
 *
 * Shot presets are loaded via number keys or the overlay. The opponent is
 * visually present (breathing silhouette) but silent — narration + music
 * are added in post-production.
 */

import '@/styles/game-theme.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scene } from './Scene/Scene';
import { TopBar } from './Hud/TopBar';
import { PlayerControls } from './PlayerControls/PlayerControls';
import { OverlayEffects } from './Scene/OverlayEffects';
import { useHoldToSpeak } from '@/hooks/useHoldToSpeak';
import type { ClientSession, Card, Persona, Rank } from '@/lib/game/types';
import type { GamePhase } from '@/hooks/useGameSession';

// ---------------------------------------------------------------------------
// Card + session builders
// ---------------------------------------------------------------------------

const card = (rank: Rank, idx: number): Card => ({ id: `${rank}-${idx}`, rank });

interface ShotConfig {
  id: string;
  label: string;
  hand: Card[];
  pileSize: number;
  selfStrikes: number;
  opponentStrikes: number;
  targetRank: Rank;
  roundNumber: 1 | 2 | 3;
  persona: Persona;
  phase: GamePhase;
  status: ClientSession['status'];
  sessionWinner?: 'player' | 'ai';
  /** Short note shown in the overlay for Scott. */
  direction: string;
}

const SHOTS: ShotConfig[] = [
  {
    id: 'act2-establish',
    label: '2 · Establish',
    hand: [card('Queen', 0), card('Queen', 1), card('Queen', 2), card('King', 0), card('Ace', 0)],
    pileSize: 0,
    selfStrikes: 0,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 1,
    persona: 'Reader',
    phase: 'idle',
    status: 'round_active',
    direction: 'Wide shot — Prosecutor breathing, 5-card hand dealt. Hold 5s silent.',
  },
  {
    id: 'act3a-honest',
    label: '3a · Honest claim',
    hand: [card('Queen', 0), card('Queen', 1), card('Queen', 2), card('King', 0), card('Ace', 0)],
    pileSize: 0,
    selfStrikes: 0,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 1,
    persona: 'Reader',
    phase: 'recording',
    status: 'round_active',
    direction: 'Click 2 Queens → HOLD TO SPEAK → say "Two queens" → release → [P] cards to pile.',
  },
  {
    id: 'act3b-lying',
    label: '3b · Lying claim',
    hand: [card('King', 1), card('Ace', 1), card('Jack', 0)],
    pileSize: 2,
    selfStrikes: 0,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 2,
    persona: 'Reader',
    phase: 'recording',
    status: 'round_active',
    direction: 'Click King (hesitate) → HOLD → say "...One queen" → release → [P] to pile → [S] +1 strike.',
  },
  {
    id: 'act3b-caught',
    label: '3b · Strike +1',
    hand: [card('Ace', 1), card('Jack', 0)],
    pileSize: 3,
    selfStrikes: 1,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 2,
    persona: 'Reader',
    phase: 'idle',
    status: 'round_active',
    direction: 'Frozen beat — strike 1 is lit, 2 cards left. Hold 3s silent for the Misdirector cutaway.',
  },
  {
    id: 'act4-montage',
    label: '4 · Strike +2',
    hand: [card('Jack', 1)],
    pileSize: 7,
    selfStrikes: 2,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 3,
    persona: 'Reader',
    phase: 'idle',
    status: 'round_active',
    direction: 'Montage beat — 2/3 strikes lit. Short static hold before Act 4 final.',
  },
  {
    id: 'act4-final',
    label: '4 · Final Jack',
    hand: [card('Jack', 1)],
    pileSize: 7,
    selfStrikes: 2,
    opponentStrikes: 0,
    targetRank: 'Queen',
    roundNumber: 3,
    persona: 'Reader',
    phase: 'recording',
    status: 'round_active',
    direction: 'Click Jack → HOLD → slow "...one queen" → release → [P] to pile → [V] verdict.',
  },
];

function buildSession(shot: ShotConfig, runtime: {
  hand: Card[];
  pileSize: number;
  selfStrikes: number;
  status: ClientSession['status'];
  sessionWinner?: 'player' | 'ai';
}): ClientSession {
  return {
    id: `demo-${shot.id}`,
    self: {
      hand: runtime.hand,
      takenCards: [],
      roundsWon: 0,
      strikes: runtime.selfStrikes,
      jokers: [],
    },
    opponent: {
      handSize: 5,
      takenCards: [],
      roundsWon: 0,
      strikes: shot.opponentStrikes,
      jokers: [],
      personaIfAi: shot.persona,
    },
    rounds: [
      {
        roundNumber: shot.roundNumber,
        targetRank: shot.targetRank,
        activePlayer: 'player',
        status: 'claim_phase',
        activeJokerEffects: [],
        tensionLevel: Math.min(runtime.selfStrikes / 3, 1),
        claimHistory: [],
        pileSize: runtime.pileSize,
      },
    ],
    currentRoundIdx: 0,
    status: runtime.status,
    sessionWinner: runtime.sessionWinner,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DemoRecorder() {
  const [shotIdx, setShotIdx] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Runtime mutations (P = commit pile, S = strike+1, V = verdict).
  const [runtime, setRuntime] = useState(() => initialRuntime(SHOTS[0]));
  // Allow manually forcing phase overrides (e.g. toggle recording UI off).
  const [phaseOverride, setPhaseOverride] = useState<GamePhase | null>(null);

  const shot = SHOTS[shotIdx];
  const hold = useHoldToSpeak();

  function initialRuntime(s: ShotConfig) {
    return {
      hand: s.hand,
      pileSize: s.pileSize,
      selfStrikes: s.selfStrikes,
      status: s.status,
      sessionWinner: s.sessionWinner,
    };
  }

  const loadShot = useCallback((i: number) => {
    const s = SHOTS[i];
    if (!s) return;
    setShotIdx(i);
    setSelectedIds(new Set());
    setRuntime(initialRuntime(s));
    setPhaseOverride(null);
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const commitToPile = useCallback(() => {
    if (selectedIds.size === 0) return;
    setRuntime((r) => ({
      ...r,
      hand: r.hand.filter((c) => !selectedIds.has(c.id)),
      pileSize: r.pileSize + selectedIds.size,
    }));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const bumpStrike = useCallback(() => {
    setRuntime((r) => ({ ...r, selfStrikes: Math.min(r.selfStrikes + 1, 3) }));
  }, []);

  const triggerVerdict = useCallback(() => {
    setRuntime((r) => ({
      ...r,
      selfStrikes: 3,
      status: 'session_over',
      sessionWinner: 'ai',
    }));
  }, []);

  const resetShot = useCallback(() => {
    setRuntime(initialRuntime(shot));
    setSelectedIds(new Set());
    setPhaseOverride(null);
  }, [shot]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '6') { loadShot(Number(k) - 1); return; }
      if (k === 'p') { commitToPile(); return; }
      if (k === 's') { bumpStrike(); return; }
      if (k === 'v') { triggerVerdict(); return; }
      if (k === 'h') { setOverlayVisible((v) => !v); return; }
      if (k === 'escape') { resetShot(); return; }
      if (k === 'a') { setPhaseOverride('awaiting-player-response'); return; }
      if (k === 'r') { setPhaseOverride('recording'); return; }
      if (k === 'i') { setPhaseOverride('idle'); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadShot, commitToPile, bumpStrike, triggerVerdict, resetShot]);

  // ---- Derived phase ----
  const effectivePhase: GamePhase =
    runtime.status === 'session_over'
      ? 'session-over'
      : phaseOverride ?? shot.phase;

  const session = useMemo(() => buildSession(shot, runtime), [shot, runtime]);

  // ---- Session-over GUILTY screen (silent — no gavel/stinger, editor adds it) ----
  if (effectivePhase === 'session-over') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--wall)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          fontFamily: '"Press Start 2P", monospace',
          color: 'var(--bone)',
        }}
      >
        <OverlayEffects />
        <div
          style={{
            padding: '24px 44px',
            border: '3px solid var(--coral)',
            background: 'rgba(10,16,8,0.75)',
            boxShadow: '6px 6px 0 0 var(--shadow), 0 0 32px rgba(0,0,0,0.55)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '8px',
              letterSpacing: '3px',
              color: 'var(--bone-dim)',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}
          >
            VERDICT
          </div>
          <h1 style={{ fontSize: '26px', margin: 0, letterSpacing: '4px', color: 'var(--coral)' }}>
            GUILTY
          </h1>
          <p
            style={{
              fontSize: '9px',
              letterSpacing: '2px',
              color: 'var(--bone-dim)',
              marginTop: '14px',
              marginBottom: 0,
              textTransform: 'uppercase',
            }}
          >
            THE JURY HAS SPOKEN.
          </p>
        </div>
        {overlayVisible && <ControlOverlay shotIdx={shotIdx} onLoad={loadShot} />}
      </div>
    );
  }

  // ---- Main recording surface ----
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--wall)' }}>
      <OverlayEffects />
      <Scene session={session} phase={effectivePhase} claimBubbleText="" claimBubbleIsDone={false} />
      <TopBar session={session} />
      <PlayerControls
        session={session}
        phase={effectivePhase}
        selectedIds={selectedIds}
        toggleSelection={toggleSelection}
        holdSpeakState={hold.state}
        waveformData={hold.waveformData}
        onStartSpeak={() => { hold.start().catch(() => {}); }}
        onStopSpeak={() => { hold.stop(); }}
        onAccept={() => {}}
        onLiar={() => {}}
      />
      {overlayVisible && <ControlOverlay shotIdx={shotIdx} onLoad={loadShot} shot={shot} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay (hidden during OBS recording via H)
// ---------------------------------------------------------------------------

function ControlOverlay({
  shotIdx,
  onLoad,
  shot,
}: {
  shotIdx: number;
  onLoad: (i: number) => void;
  shot?: ShotConfig;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'rgba(10, 16, 8, 0.92)',
        border: '2px solid var(--amber-dim)',
        padding: '10px 14px',
        fontFamily: '"VT323", monospace',
        color: 'var(--bone)',
        fontSize: '14px',
        maxWidth: '760px',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {SHOTS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => onLoad(i)}
            style={{
              fontFamily: '"VT323", monospace',
              fontSize: '13px',
              padding: '4px 8px',
              background: i === shotIdx ? 'var(--amber)' : 'transparent',
              color: i === shotIdx ? 'var(--wall)' : 'var(--bone)',
              border: '1px solid var(--amber-dim)',
              cursor: 'pointer',
            }}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </div>
      {shot && (
        <div style={{ color: 'var(--amber-hi)', marginBottom: 4 }}>
          → {shot.direction}
        </div>
      )}
      <div style={{ color: 'var(--bone-dim)', fontSize: '12px' }}>
        <b>Keys:</b> <kbd>1-6</kbd> shot · <kbd>P</kbd> play-to-pile · <kbd>S</kbd> strike+1 ·
        <kbd> V</kbd> verdict · <kbd>R</kbd>/<kbd>I</kbd>/<kbd>A</kbd> phase · <kbd>Esc</kbd> reset ·
        <kbd> H</kbd> hide overlay (USE BEFORE OBS RECORD)
      </div>
    </div>
  );
}
