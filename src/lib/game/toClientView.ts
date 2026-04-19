// game-engine spec §3.4 — toClientView projection (pure, no I/O).
//
// Strips server-only fields before the Session is sent to the client.
// Called by the API route for every state update; never mutates the input.

import type {
  Claim,
  ClientOpponent,
  ClientRound,
  ClientSession,
  PublicClaim,
  Round,
  Session,
} from './types';
import { applyColdRead } from '../jokers/effects';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip all server-only fields from a Claim, leaving only PublicClaim fields. */
function toPublicClaim(claim: Claim): PublicClaim {
  const pub: PublicClaim = {
    by: claim.by,
    count: claim.count,
    claimedRank: claim.claimedRank,
    timestamp: claim.timestamp,
  };
  // claimText is optional — include only if present (§2 PublicClaim shape)
  if (claim.claimText !== undefined) {
    pub.claimText = claim.claimText;
  }
  return pub;
}

/** Map a server Round to a ClientRound (drop pile, add pileSize; strip claim internals). */
function toClientRound(round: Round): ClientRound {
  // Strip server-only Round fields before spreading:
  //   pile              → replaced with pileSize
  //   claimHistory      → replaced with PublicClaim[]
  //   activeProbe       → server-only; probe-phase worktree projects
  //                       Round.activeProbe → ClientRound.currentProbe via
  //                       the filter pipeline (pre-land: not projected yet).
  //   jokerTriggeredThisRound → joker-system internal
  //   pendingJokerActivation  → joker-system internal
  const {
    pile,
    claimHistory,
    activeProbe: _activeProbe,
    jokerTriggeredThisRound: _jokerTriggeredThisRound,
    pendingJokerActivation: _pendingJokerActivation,
    ...rest
  } = round;
  const projectedHistory = claimHistory.map(toPublicClaim);

  // Cold Read (§7.4.2): when active, retain lieScore on the LAST AI claim only.
  if (applyColdRead(round)) {
    for (let i = projectedHistory.length - 1; i >= 0; i--) {
      const c = projectedHistory[i];
      if (c.by === 'ai') {
        const srcClaim = claimHistory[i];
        if (srcClaim.voiceMeta?.lieScore !== undefined) {
          projectedHistory[i] = {
            ...c,
            voiceMeta: { lieScore: srcClaim.voiceMeta.lieScore },
          };
        }
        break;
      }
    }
  }

  return {
    ...rest,
    pileSize: pile.length,
    claimHistory: projectedHistory,
  };
}

// ---------------------------------------------------------------------------
// Music bucket mapping (spec §3.4 — "Map current music track URL based on tension level")
// ---------------------------------------------------------------------------

type MusicBucket = 'calm' | 'tense' | 'critical';

function tensionBucket(tensionLevel: number): MusicBucket {
  if (tensionLevel < 0.33) return 'calm';
  if (tensionLevel < 0.66) return 'tense';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Project a server-side Session into a ClientSession for the given viewer.
 *
 * - `self` = viewer's PlayerState (full, including hand).
 * - `opponent` = opponent's PlayerState minus `hand`, plus `handSize` (Invariant 12).
 *   takenCards remain visible — the pile transfer was observed in play.
 * - All Claim objects are projected to PublicClaim (strips actualCardIds, truthState,
 *   voiceMeta, ttsSettings, llmReasoning — uniformly for all claims; §3.4 note).
 * - `currentMusicUrl` derived from current round's tensionLevel + session.musicTracks.
 *
 * Pure function. Returns shallow-spread objects so no mutable reference from
 * this output aliases the input Session's nested arrays/objects.
 */
export function toClientView(session: Session, viewer: 'player' | 'ai'): ClientSession {
  const opponentKey: 'player' | 'ai' = viewer === 'player' ? 'ai' : 'player';

  const selfState = session[viewer];
  const opponentState = session[opponentKey];

  // Build opponent view: drop `hand`, add `handSize`; keep everything else (incl. takenCards).
  const { hand: _droppedHand, ...opponentRest } = opponentState;
  const opponent: ClientOpponent = {
    ...opponentRest,
    handSize: opponentState.hand.length,
    // Shallow-spread takenCards array so client mutation doesn't alias server state
    takenCards: [...opponentState.takenCards],
  };

  // Map rounds
  const clientRounds: ClientRound[] = session.rounds.map(toClientRound);

  // Derive currentMusicUrl from current round's tensionLevel
  let currentMusicUrl: string | undefined;
  if (session.rounds.length > 0) {
    const currentRound = session.rounds[session.currentRoundIdx];
    if (currentRound) {
      const bucket = tensionBucket(currentRound.tensionLevel);
      const track = session.musicTracks.find((t) => t.level === bucket);
      currentMusicUrl = track?.url;
    }
  }

  // -------------------------------------------------------------------------
  // Day-5 pre-land (orchestrator, 2026-04-19) — gated joker + autopsy fields.
  // Worktrees will extend these as the features fill in.
  // -------------------------------------------------------------------------

  // Earful autopsy — self (player) viewer only; opponent never sees it.
  const autopsy = viewer === 'player' && session.autopsy ? { ...session.autopsy } : undefined;

  // discardedJokers — both viewers see post-round only (spec §7.1.9).
  const discardedJokers =
    session.discardedJokers && session.status !== 'round_active'
      ? [...session.discardedJokers]
      : undefined;

  // currentOffer — only the offeredToWinner viewer sees the live offer.
  const currentOffer =
    session.currentOffer && session.currentOffer.offeredToWinner === viewer
      ? {
          ...session.currentOffer,
          offered: [...session.currentOffer.offered],
        }
      : undefined;

  return {
    id: session.id,
    self: {
      ...selfState,
      hand: [...selfState.hand],
      takenCards: [...selfState.takenCards],
      ...(selfState.jokerSlots ? { jokerSlots: [...selfState.jokerSlots] } : {}),
    },
    opponent,
    rounds: clientRounds,
    currentRoundIdx: session.currentRoundIdx,
    status: session.status,
    sessionWinner: session.sessionWinner,
    currentMusicUrl,
    ...(autopsy ? { autopsy } : {}),
    ...(discardedJokers ? { discardedJokers } : {}),
    ...(currentOffer ? { currentOffer } : {}),
  };
}
