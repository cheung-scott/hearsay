// Tool #1 — readGameState. Design §5.1, invariant I1.

import {
  storeGet,
  toClientView,
  type Session,
} from '../appBridge';
import {
  ReadGameStateInput,
  err,
  ok,
  type DebugPermissions,
  type ToolResult,
} from '../schemas';

export function makeReadGameState(permissions: DebugPermissions) {
  return async function readGameState(
    rawInput: unknown,
  ): Promise<ToolResult> {
    const parsed = ReadGameStateInput.safeParse(rawInput);
    if (!parsed.success) {
      return err(
        'INVALID_INPUT',
        'Invalid input for readGameState',
        parsed.error.issues,
      );
    }
    const { sessionId, view } = parsed.data;

    if (view === 'full' && !permissions.allowInspectAIDecision) {
      return err(
        'PERMISSION_DENIED',
        "view='full' requires HEARSAY_DEBUG=1",
      );
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

    if (view === 'client') {
      return ok(toClientView(session, 'player'));
    }
    return ok(session);
  };
}
