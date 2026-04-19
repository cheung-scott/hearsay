import { useState, useEffect, useCallback, useRef } from 'react';
import type { ClientSession, Card } from '../lib/game/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'CreateSession' }
  | { type: 'PlayerClaim'; cards: Card[]; audio: Blob; claimText: string }
  | { type: 'PlayerRespond'; action: 'accept' | 'challenge' }
  | { type: 'AiAct' }
  | { type: 'PickJoker'; joker: string }
  | { type: 'TimeoutActive' }
  | { type: 'TimeoutResponder' };

export type GamePhase =
  | 'idle'
  | 'recording'
  | 'awaiting-ai'
  | 'playing-ai-audio'
  | 'awaiting-player-response'
  | 'round-over'
  | 'session-over';

export interface GameSessionState {
  session: ClientSession | null;
  phase: GamePhase;
  lastClaimAudioUrl?: string;
  lastClaimText?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Phase derivation helper (pure — exported for tests)
// ---------------------------------------------------------------------------

/** Derives the base phase from a ClientSession snapshot.
 *
 * NOTE: `playing-ai-audio` and `awaiting-player-response` require local
 * async context (audio-ended signal). The hook exposes `markAudioEnded()` to
 * advance from `playing-ai-audio` → `awaiting-player-response`. This helper
 * only distinguishes between the two as `playing-ai-audio` when lastClaimAudioUrl
 * is populated — the caller overrides to `awaiting-player-response` after audio ends.
 */
export function derivePhase(
  session: ClientSession | null,
  lastClaimAudioUrl?: string,
): GamePhase {
  if (session === null) return 'idle';

  if (session.status === 'session_over') return 'session-over';
  if (session.status === 'joker_offer') return 'round-over';

  if (session.status === 'round_active') {
    const round = session.rounds[session.currentRoundIdx];
    if (!round) return 'idle';

    if (round.status === 'claim_phase') {
      if (round.activePlayer === 'player') {
        // Player's turn to record a claim.
        return 'recording';
      }
      // AI's turn to claim.
      return 'awaiting-ai';
    }

    if (round.status === 'response_phase') {
      // After the AI has made its claim, we transition through playing-ai-audio
      // then awaiting-player-response. We use the lastClaimAudioUrl to
      // distinguish: if one is set, we're in playing-ai-audio (the caller will
      // call markAudioEnded() when playback ends).
      if (lastClaimAudioUrl) return 'playing-ai-audio';
      return 'awaiting-player-response';
    }
  }

  // Fallback for setup / resolving / round_over sub-states.
  return 'idle';
}

// ---------------------------------------------------------------------------
// Blob → base64 helper
// ---------------------------------------------------------------------------

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGameSession(): {
  state: GameSessionState;
  dispatch: (event: GameEvent) => Promise<void>;
  selectedCardIds: Set<string>;
  toggleCardSelection: (id: string) => void;
  markAudioEnded: () => void;
} {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [lastClaimAudioUrl, setLastClaimAudioUrl] = useState<
    string | undefined
  >(undefined);
  const [lastClaimText, setLastClaimText] = useState<string | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  // Card selection — local Set<CardId>.
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set(),
  );

  // Keep latest phase in a ref so callbacks can read it without stale closure.
  const phaseRef = useRef<GamePhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Clear card selection whenever phase transitions out of 'recording'.
  useEffect(() => {
    if (phase !== 'recording') {
      setSelectedCardIds(new Set());
    }
  }, [phase]);

  const toggleCardSelection = useCallback((id: string) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Called by the audio player when TTS playback ends.
  const markAudioEnded = useCallback(() => {
    setLastClaimAudioUrl(undefined);
    setPhase('awaiting-player-response');
  }, []);

  const dispatch = useCallback(
    async (event: GameEvent) => {
      try {
        let url = '/api/turn';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: Record<string, any> = { type: event.type };

        if (event.type === 'CreateSession') {
          url = '/api/session';
          body = {};
        } else if (event.type === 'PlayerClaim') {
          const audioBase64 = await blobToBase64(event.audio);
          body = {
            type: 'PlayerClaim',
            cards: event.cards.map(c => ({ id: c.id })),
            audioBase64,
            claimText: event.claimText,
          };
        } else if (event.type === 'PlayerRespond') {
          body = { type: 'PlayerRespond', action: event.action };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          setError(text || `HTTP ${response.status}`);
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await response.json()) as {
          session: ClientSession;
          aiClaim?: { claimText: string; ttsAudioUrl: string };
        };

        const newSession = data.session;
        const aiClaim = data.aiClaim;

        // If an aiClaim with TTS audio was returned, store it before deriving
        // phase so derivePhase sees lastClaimAudioUrl and returns 'playing-ai-audio'.
        const newAudioUrl = aiClaim?.ttsAudioUrl;
        const newClaimText = aiClaim?.claimText;

        setSession(newSession);
        setLastClaimAudioUrl(newAudioUrl);
        setLastClaimText(newClaimText);
        setError(undefined);

        const derived = derivePhase(newSession, newAudioUrl);
        setPhase(derived);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        setError(message);
        // Phase and session unchanged — invariant 3.
      }
    },
    [],
  );

  const state: GameSessionState = {
    session,
    phase,
    lastClaimAudioUrl,
    lastClaimText,
    error,
  };

  return { state, dispatch, selectedCardIds, toggleCardSelection, markAudioEnded };
}
