// Zod input schemas + ToolSuccess/ToolError envelopes + DebugPermissions.
// Design.md §4.1-§4.4.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input schemas (one per tool)
// ---------------------------------------------------------------------------

export const ReadGameStateInput = z.object({
  sessionId: z.string().min(1),
  view: z.enum(['client', 'full']).default('client'),
});

export const ListSessionsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const InspectAIDecisionInput = z.object({
  sessionId: z.string().min(1),
  turnIndex: z
    .number()
    .int()
    .min(0)
    .describe('0-based claim index across all rounds'),
});

export const ForceTransitionInput = z.object({
  sessionId: z.string().min(1),
  event: z
    .record(z.unknown())
    .describe('A GameEvent object — see listFSMEvents for schema'),
  dryRun: z.boolean().default(false),
});

export const ReplayRoundInput = z.object({
  sessionId: z.string().min(1),
  roundIndex: z.number().int().min(0).max(2),
});

export const ListFSMEventsInput = z.object({});

export const DumpTranscriptInput = z.object({
  sessionId: z.string().min(1),
  format: z.enum(['narrative', 'json']).default('narrative'),
});

// ---------------------------------------------------------------------------
// Tool envelopes — design.md §4.2
// ---------------------------------------------------------------------------

export type ToolErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'ROUND_NOT_FOUND'
  | 'TURN_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'PERMISSION_DENIED'
  | 'KV_ERROR'
  | 'INVALID_INPUT';

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolError {
  ok: false;
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export type ToolEnvelope<T> = ToolSuccess<T> | ToolError;

// MCP SDK handler return shape. The index signature mirrors the SDK's
// CallToolResult type so our handlers satisfy registerTool's generic.
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function ok<T>(data: T): ToolResult {
  const envelope: ToolSuccess<T> = { ok: true, data };
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}

export function err(
  code: ToolErrorCode,
  message: string,
  details?: unknown,
): ToolResult {
  const envelope: ToolError = { ok: false, code, message, details };
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Debug permissions — design.md §4.3
// ---------------------------------------------------------------------------

export interface DebugPermissions {
  allowForceTransition: boolean;
  allowInspectAIDecision: boolean;
}

// Read env at call time and cache; a running server cannot be unlocked by
// mutating process.env after startup. Call once from index.ts.
export function loadPermissions(): DebugPermissions {
  const allowed = process.env.HEARSAY_DEBUG === '1';
  return {
    allowForceTransition: allowed,
    allowInspectAIDecision: allowed,
  };
}

// ---------------------------------------------------------------------------
// Server config — design.md §4.4
// ---------------------------------------------------------------------------

export interface MCPServerConfig {
  name: 'hearsay-debug';
  version: string;
  transport: 'stdio' | 'http';
  httpPort?: number;
  instructions: string;
}
