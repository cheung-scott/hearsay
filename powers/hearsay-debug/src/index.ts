#!/usr/bin/env node
// Hearsay Debug — MCP server entry point.
// Design §6.1. Registers 7 tools via server.registerTool (NOT the legacy
// server.tool() form). Default stdio transport; optional HTTP bound to a
// loopback host only.

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  DumpTranscriptInput,
  ForceTransitionInput,
  InspectAIDecisionInput,
  ListFSMEventsInput,
  ListSessionsInput,
  ReadGameStateInput,
  ReplayRoundInput,
  loadPermissions,
  type DebugPermissions,
  type ToolResult,
} from './schemas';
import { makeReadGameState } from './tools/readGameState';
import { listSessions } from './tools/listSessions';
import { makeInspectAIDecision } from './tools/inspectAIDecision';
import { makeForceTransition } from './tools/forceTransition';
import { replayRound } from './tools/replayRound';
import { listFSMEvents } from './tools/listFSMEvents';
import { dumpTranscript } from './tools/dumpTranscript';

export const TOOL_NAMES = [
  'readGameState',
  'listSessions',
  'inspectAIDecision',
  'forceTransition',
  'replayRound',
  'listFSMEvents',
  'dumpTranscript',
] as const;

export const PACKAGE_VERSION = '0.1.0';

const INSTRUCTIONS =
  'Inspect Hearsay game sessions, replay rounds, dump transcripts. forceTransition and inspectAIDecision require HEARSAY_DEBUG=1.';

// Loopback hosts permitted for HTTP transport — design §6.1.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export interface TransportSelection {
  kind: 'stdio' | 'http';
  host?: string;
  port?: number;
}

// Pure helper — exported for unit testing. Refuses non-loopback hosts by
// throwing at startup; never silently falls back to 0.0.0.0.
export function pickTransport(argv: string[], env: NodeJS.ProcessEnv): TransportSelection {
  const argvHttpIdx = argv.indexOf('--http');
  const argvHttpHostPort = argvHttpIdx >= 0 ? argv[argvHttpIdx + 1] : undefined;
  const envHttp = env.HEARSAY_DEBUG_HTTP;
  const raw = argvHttpHostPort ?? envHttp;
  if (!raw) return { kind: 'stdio' };

  const [host, portStr] = raw.split(':');
  if (!host || !portStr) {
    throw new Error(
      `HEARSAY_DEBUG_HTTP must be host:port (got '${raw}')`,
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to bind HTTP transport to non-loopback host '${host}'. Allowed: ${[...LOOPBACK_HOSTS].join(', ')}`,
    );
  }
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port '${portStr}' in HEARSAY_DEBUG_HTTP`);
  }
  return { kind: 'http', host, port };
}

export function buildServer(permissions: DebugPermissions): McpServer {
  const server = new McpServer(
    { name: 'hearsay-debug', version: PACKAGE_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const readGameState = makeReadGameState(permissions);
  const inspectAIDecision = makeInspectAIDecision(permissions);
  const forceTransition = makeForceTransition(permissions);

  const wrap =
    (handler: (input: unknown) => Promise<ToolResult>) =>
    async (input: unknown): Promise<ToolResult> =>
      handler(input ?? {});

  server.registerTool(
    'readGameState',
    {
      title: 'Read game state',
      description:
        "Return the current session state. view='client' (default) matches the wire projection; view='full' requires HEARSAY_DEBUG=1 and includes actualCardIds + llmReasoning.",
      inputSchema: ReadGameStateInput.shape,
    },
    wrap(readGameState),
  );

  server.registerTool(
    'listSessions',
    {
      title: 'List sessions',
      description:
        'Enumerate active Hearsay sessions by scanning Vercel KV keys under hearsay:session:*.',
      inputSchema: ListSessionsInput.shape,
    },
    wrap(listSessions),
  );

  server.registerTool(
    'inspectAIDecision',
    {
      title: 'Inspect AI decision',
      description:
        'Return the full Claim for a given turn including llmReasoning + ttsSettings. Requires HEARSAY_DEBUG=1.',
      inputSchema: InspectAIDecisionInput.shape,
    },
    wrap(inspectAIDecision),
  );

  server.registerTool(
    'forceTransition',
    {
      title: 'Force FSM transition',
      description:
        'Dispatch a raw GameEvent through the real reduce() reducer. Respects all FSM guards — invalid events return INVALID_TRANSITION. Requires HEARSAY_DEBUG=1.',
      inputSchema: ForceTransitionInput.shape,
    },
    wrap(forceTransition),
  );

  server.registerTool(
    'replayRound',
    {
      title: 'Replay round',
      description:
        "Walk through a round's claim history as PublicClaim entries. Read-only; never writes to KV.",
      inputSchema: ReplayRoundInput.shape,
    },
    wrap(replayRound),
  );

  server.registerTool(
    'listFSMEvents',
    {
      title: 'List FSM events',
      description:
        "Return the hand-curated catalog of every GameEvent variant — name, required fields, and description. Use alongside forceTransition to construct valid events.",
      inputSchema: ListFSMEventsInput.shape,
    },
    wrap(listFSMEvents),
  );

  server.registerTool(
    'dumpTranscript',
    {
      title: 'Dump transcript',
      description:
        "Human-readable narrative (default) or structured JSON of all claims + outcomes. Never emits raw card IDs.",
      inputSchema: DumpTranscriptInput.shape,
    },
    wrap(dumpTranscript),
  );

  return server;
}

// Early warning for the six-out-of-seven tools that reach KV. `listFSMEvents`
// still works without creds, so we WARN rather than abort — a judge cloning
// for a quick `listFSMEvents` demo shouldn't be blocked, but a developer who
// forgot to source the env should see the reason up front instead of first
// hitting a cryptic `@vercel/kv` runtime error on tool call.
function warnIfKvEnvMissing(env: NodeJS.ProcessEnv): void {
  const missing = ['KV_URL', 'KV_REST_API_TOKEN'].filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(
      `[hearsay-debug] WARN: ${missing.join(' + ')} not set. All tools except listFSMEvents will return KV_ERROR until env is provided. See README.`,
    );
  }
}

async function main() {
  const permissions = loadPermissions();
  warnIfKvEnvMissing(process.env);
  const selection = pickTransport(process.argv.slice(2), process.env);
  const server = buildServer(permissions);

  if (selection.kind === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
      `[hearsay-debug] connected via stdio; permissions=${JSON.stringify(permissions)}`,
    );
  } else {
    // HTTP transport — bound to loopback only (pickTransport enforces host).
    // Held behind a dynamic import so the stdio code path has zero SDK HTTP cost.
    const [{ StreamableHTTPServerTransport }, { createServer }] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('node:http'),
    ]);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);
    const httpServer = createServer(async (req, res) => {
      try {
        await transport.handleRequest(req, res);
      } catch (e) {
        console.error('[hearsay-debug] http handler error', e);
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
    await new Promise<void>((resolve) =>
      httpServer.listen(selection.port, selection.host, () => resolve()),
    );
    console.error(
      `[hearsay-debug] connected via http://${selection.host}:${selection.port}/mcp; permissions=${JSON.stringify(permissions)}`,
    );
  }

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Auto-run only when this module is the Node entry point. Unit tests that
// import { buildServer, pickTransport, TOOL_NAMES } should NOT boot the
// server. Canonical ESM entry detection handles Windows paths via
// pathToFileURL.
const entryHref =
  typeof process !== 'undefined' && process.argv[1]
    ? pathToFileURL(process.argv[1]).href
    : '';

if (import.meta.url === entryHref) {
  main().catch((e) => {
    console.error('[hearsay-debug] fatal', e);
    process.exit(1);
  });
}
