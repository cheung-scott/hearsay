// Tool #6 — listFSMEvents. Design §5.5. No session lookup, no permissions.

import { FSM_EVENT_CATALOG } from '../fsmEvents';
import {
  ListFSMEventsInput,
  err,
  ok,
  type ToolResult,
} from '../schemas';

export async function listFSMEvents(rawInput: unknown): Promise<ToolResult> {
  const parsed = ListFSMEventsInput.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return err(
      'INVALID_INPUT',
      'listFSMEvents takes no arguments',
      parsed.error.issues,
    );
  }
  return ok(FSM_EVENT_CATALOG);
}
