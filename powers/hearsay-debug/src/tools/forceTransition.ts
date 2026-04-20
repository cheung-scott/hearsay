// Tool #4 — forceTransition. Design §5.3, invariants I2, I3, I9. Dev-only.
//
// Dispatches through `reduce(session, event)` — the same pure function
// the production API routes call. This preserves all FSM guards (§1.4
// ethical line) and cannot turn invalid events into valid ones.

import {
  InvalidTransitionError,
  reduce,
  storeGet,
  storeSet,
  toClientView,
  type GameEvent,
  type Session,
} from '../appBridge';
import { CATALOG_EVENT_TYPES } from '../fsmEvents';
import {
  ForceTransitionInput,
  err,
  ok,
  type DebugPermissions,
  type ToolResult,
} from '../schemas';

// Sourced from the drift-tested fsmEvents catalog so new variants added to
// the GameEvent union (and mirrored into fsmEvents.ts, enforced by the
// listFSMEvents drift test) automatically flow through here. Keeping this
// as a local Set avoids recomputing it on every call.
const VALID_EVENT_TYPES = new Set<string>(CATALOG_EVENT_TYPES);

export function makeForceTransition(permissions: DebugPermissions) {
  return async function forceTransition(
    rawInput: unknown,
  ): Promise<ToolResult> {
    if (!permissions.allowForceTransition) {
      return err(
        'PERMISSION_DENIED',
        'forceTransition requires HEARSAY_DEBUG=1',
      );
    }

    const parsed = ForceTransitionInput.safeParse(rawInput);
    if (!parsed.success) {
      return err(
        'INVALID_INPUT',
        'Invalid input for forceTransition',
        parsed.error.issues,
      );
    }
    const { sessionId, event, dryRun } = parsed.data;

    const eventType = (event as { type?: unknown }).type;
    if (typeof eventType !== 'string' || !VALID_EVENT_TYPES.has(eventType)) {
      return err(
        'INVALID_INPUT',
        `Unknown event.type. Valid types: ${Array.from(VALID_EVENT_TYPES).join(', ')}`,
        { receivedType: eventType },
      );
    }
    if (typeof (event as { now?: unknown }).now !== 'number') {
      return err('INVALID_INPUT', 'event.now (number) is required');
    }

    let session: Session | null;
    try {
      session = await storeGet(sessionId);
    } catch (e) {
      return err('KV_ERROR', `KV read failed: ${String(e)}`);
    }
    if (session == null) {
      return err('SESSION_NOT_FOUND', `No session '${sessionId}'`);
    }

    const before = toClientView(session, 'player');

    let next: Session;
    try {
      next = reduce(session, event as unknown as GameEvent);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        return err('INVALID_TRANSITION', e.message, {
          currentState: e.currentState,
          eventType: e.eventType,
        });
      }
      return err(
        'INVALID_INPUT',
        `reduce threw non-InvalidTransitionError: ${String(e)}`,
      );
    }

    if (dryRun) {
      return ok({
        before,
        after: toClientView(next, 'player'),
        applied: false,
      });
    }

    try {
      await storeSet(sessionId, next);
    } catch (e) {
      return err('KV_ERROR', `KV write failed (old session persists): ${String(e)}`);
    }

    return ok({
      before,
      after: toClientView(next, 'player'),
      applied: true,
    });
  };
}
