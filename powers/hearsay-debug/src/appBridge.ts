// Bridge to the Hearsay Next.js app's src/lib/** — read-only.
//
// The parent app's package.json has no `"type": "module"`, so Node's ESM
// loader (what tsx uses at runtime) treats those TypeScript files as CJS.
// Under that path, named exports surface only via `.default.xxx`. Under
// vitest (vite's transform) the same files load as real ESM and named
// exports are directly accessible.
//
// We normalize by reading both shapes: `ns.named ?? ns.default?.named`.
// Every tool imports from here so the interop quirk lives in exactly one
// file.

import * as gameTypesNS from '../../../src/lib/game/types';
import * as fsmNS from '../../../src/lib/game/fsm';
import * as toClientViewNS from '../../../src/lib/game/toClientView';
import * as storeNS from '../../../src/lib/session/store';
import * as mathNS from '../../../src/lib/ai/math';

import type * as GameTypes from '../../../src/lib/game/types';
import type * as FsmModule from '../../../src/lib/game/fsm';
import type * as ToClientViewModule from '../../../src/lib/game/toClientView';
import type * as StoreModule from '../../../src/lib/session/store';
import type * as MathModule from '../../../src/lib/ai/math';
import type * as AiTypes from '../../../src/lib/ai/types';

function pick<T>(ns: unknown, name: string): T {
  const mod = ns as Record<string, unknown> & { default?: Record<string, unknown> };
  const direct = mod[name];
  if (direct !== undefined) return direct as T;
  const viaDefault = mod.default?.[name];
  if (viaDefault !== undefined) return viaDefault as T;
  throw new Error(`appBridge: export '${name}' not found on parent module`);
}

export const reduce = pick<typeof FsmModule.reduce>(fsmNS, 'reduce');
export const toClientView = pick<typeof ToClientViewModule.toClientView>(
  toClientViewNS,
  'toClientView',
);
export const storeGet = pick<typeof StoreModule.get>(storeNS, 'get');
export const storeSet = pick<typeof StoreModule.set>(storeNS, 'set');
export const claimMathProbability = pick<typeof MathModule.claimMathProbability>(
  mathNS,
  'claimMathProbability',
);
export const InvalidTransitionError = pick<typeof GameTypes.InvalidTransitionError>(
  gameTypesNS,
  'InvalidTransitionError',
);

// Re-export types (erased at runtime; no bridge cost).
export type Session = GameTypes.Session;
export type Round = GameTypes.Round;
export type Claim = GameTypes.Claim;
export type PublicClaim = GameTypes.PublicClaim;
export type GameEvent = GameTypes.GameEvent;
export type ClientSession = GameTypes.ClientSession;
export type DecisionContext = AiTypes.DecisionContext;
