// Tool #2 — listSessions. Design §5 tool 2, invariant I4.
// Bypasses src/lib/session/store.ts on purpose — uses @vercel/kv directly for
// a keys('hearsay:session:*') scan. store.ts does not export a scan surface
// and is intentionally NOT modified (design §7.1).

import { kv } from '@vercel/kv';
import type { Session } from '../appBridge';
import {
  ListSessionsInput,
  err,
  ok,
  type ToolResult,
} from '../schemas';

const PREFIX = 'hearsay:session:';

export interface SessionSummary {
  id: string;
  status: Session['status'];
  currentRoundIdx: number;
  updatedAtHint?: number;
}

export async function listSessions(rawInput: unknown): Promise<ToolResult> {
  const parsed = ListSessionsInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      'INVALID_INPUT',
      'Invalid input for listSessions',
      parsed.error.issues,
    );
  }
  const { limit } = parsed.data;

  let keys: string[];
  try {
    keys = await kv.keys(`${PREFIX}*`);
  } catch (e) {
    return err('KV_ERROR', `KV keys scan failed: ${String(e)}`);
  }

  const sessionKeys = keys
    .filter((k) => k.startsWith(PREFIX))
    .slice(0, limit);

  const summaries: SessionSummary[] = [];
  for (const key of sessionKeys) {
    try {
      const session = await kv.get<Session>(key);
      if (session == null) continue;
      summaries.push({
        id: session.id,
        status: session.status,
        currentRoundIdx: session.currentRoundIdx,
      });
    } catch (e) {
      return err('KV_ERROR', `KV get failed for ${key}: ${String(e)}`);
    }
  }

  return ok(summaries);
}
