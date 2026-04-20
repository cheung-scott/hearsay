// Hand-curated JSON description of the GameEvent discriminated union
// defined in src/lib/game/types.ts.
//
// Hand-curated by design (design.md §5.5) — zero runtime TS-to-JSON-schema
// dependency. Drift risk is covered by the I6 test (src/powerMd.test.ts and
// a dedicated catalog test) which fails if a variant is added to types.ts
// without being added here.

export interface FSMEventCatalogEntry {
  /** event.type literal */
  type: string;
  /** Required fields beyond `type`. `now` is universal. */
  required: string[];
  description: string;
  /** Optional fields — explains discriminated variants (Timeout kind). */
  variants?: Array<{ when: string; required: string[] }>;
}

export const FSM_EVENT_CATALOG: readonly FSMEventCatalogEntry[] = [
  {
    type: 'SetupComplete',
    required: ['now', 'initialDeal', 'musicTracks'],
    description:
      'Seed the session: deal round 1, wire music tracks, optionally seed the joker draw pile. Transitions status setup → round_active.',
  },
  {
    type: 'ClaimMade',
    required: ['now', 'claim'],
    description:
      'Active player plays 1-2 cards and voices a claim. Transitions round status claim_phase → response_phase.',
  },
  {
    type: 'ClaimAccepted',
    required: ['now'],
    description:
      'Responder accepts the latest claim without challenging. Swaps active player or ends the round if the active hand is empty. Valid only in response_phase.',
  },
  {
    type: 'ChallengeCalled',
    required: ['now'],
    description:
      'Responder calls "Liar!" on the latest claim. Round enters resolving. Valid only in response_phase.',
  },
  {
    type: 'RevealComplete',
    required: ['now', 'challengeWasCorrect'],
    description:
      'Cards shown after a challenge; caller supplies challengeWasCorrect. Applies strike, transfers pile, advances round or session. Valid only in resolving.',
  },
  {
    type: 'RoundSettled',
    required: ['now'],
    description:
      'End-of-round cleanup after RevealComplete. Transitions to joker_offer (or next round setup).',
  },
  {
    type: 'JokerPicked',
    required: ['now', 'joker', 'nextRoundDeal'],
    description:
      'Round winner selects one of the offered jokers; caller provides the next round deal. Transitions joker_offer → round_active.',
  },
  {
    type: 'JokerOfferSkippedSessionOver',
    required: ['now'],
    description:
      'Joker offer is skipped because the session has ended. Transition to session_over.',
  },
  {
    type: 'Timeout',
    required: ['now', 'kind'],
    description:
      'Clock expired. Two kinds: "active_player" (auto-plays the card by cardIdToPlay) and "responder" (treated as ClaimAccepted).',
    variants: [
      { when: 'kind === "active_player"', required: ['kind', 'cardIdToPlay', 'now'] },
      { when: 'kind === "responder"', required: ['kind', 'now'] },
    ],
  },
  {
    type: 'JokerOffered',
    required: ['now', 'offered', 'newDrawPile'],
    description:
      'joker-system: present a 1-of-3 joker selection to the round winner. `offered` length 1..3 shrinks on pile tail. Pending joker-system worktree.',
  },
  {
    type: 'JokerOfferEmpty',
    required: ['now', 'nextRoundDeal'],
    description:
      'joker-system: draw pile empty at offer time. Skip the offer and advance directly to the next round via nextRoundDeal. Pending joker-system worktree.',
  },
  {
    type: 'UseJoker',
    required: ['now', 'joker', 'by'],
    description:
      'joker-system: activate a held joker. second_wind auto-consumes on strike events and is never used here. Pending joker-system worktree.',
  },
  {
    type: 'ProbeStart',
    required: ['now', 'probe'],
    description:
      'probe-phase: begin a Stage Whisper probe. Sets Round.activeProbe. Pending probe-phase worktree.',
  },
  {
    type: 'ProbeComplete',
    required: ['now', 'whisperId'],
    description:
      'probe-phase: probe reveal acknowledged by the player. Clears Round.activeProbe. Pending probe-phase worktree.',
  },
  {
    type: 'ProbeExpired',
    required: ['now', 'whisperId'],
    description:
      'probe-phase: probe timeout elapsed. Clears Round.activeProbe. Pending probe-phase worktree.',
  },
];

// Exported literal for the drift test. Update both lists together if a new
// GameEvent variant is added to src/lib/game/types.ts.
export const CATALOG_EVENT_TYPES: readonly string[] = FSM_EVENT_CATALOG.map(
  (e) => e.type,
);
