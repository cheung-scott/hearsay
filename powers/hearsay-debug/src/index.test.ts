// Invariant I5: stdio smoke test. Spawn the compiled (or tsx-run) server,
// complete the MCP handshake, invoke listFSMEvents, verify envelope.
//
// Uses the MCP SDK client + StdioClientTransport so we don't reimplement
// framing by hand. tsx runs the TS source directly; no pre-build needed.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, 'index.ts');

describe('stdio smoke (I5)', () => {
  let client: Client | undefined;

  beforeAll(async () => {
    // Spawn via `node --import tsx <entry>` — matches the mcp.json contract.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', entry],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined),
        ),
        // Ensure dev-only tools stay gated during the smoke test.
        HEARSAY_DEBUG: '',
      } as Record<string, string>,
    });
    client = new Client({ name: 'hearsay-debug-smoke', version: '0.0.0' });
    await client.connect(transport);
  }, 120_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  it('lists exactly 7 tools via tools/list', async () => {
    const { tools } = await client!.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'dumpTranscript',
        'forceTransition',
        'inspectAIDecision',
        'listFSMEvents',
        'listSessions',
        'readGameState',
        'replayRound',
      ].sort(),
    );
  });

  it('listFSMEvents returns the catalog (ToolSuccess envelope)', async () => {
    const result = await client!.callTool({
      name: 'listFSMEvents',
      arguments: {},
    });
    expect(result.content).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const env = JSON.parse(content[0]!.text);
    expect(env.ok).toBe(true);
    expect(Array.isArray(env.data)).toBe(true);
    expect(env.data.length).toBeGreaterThanOrEqual(15);
    for (const entry of env.data) {
      expect(typeof entry.type).toBe('string');
      expect(Array.isArray(entry.required)).toBe(true);
    }
  });
});
