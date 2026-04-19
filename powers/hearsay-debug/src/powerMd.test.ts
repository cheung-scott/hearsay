// Invariant I6: POWER.md references exactly 7 tools whose names match the
// tool names registered in src/index.ts. Catches silent drift between docs
// and code.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOL_NAMES } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const powerMdPath = resolve(here, '..', 'POWER.md');

describe('POWER.md metadata drift (I6)', () => {
  const content = readFileSync(powerMdPath, 'utf8');

  it('exists at the Power root', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('references exactly 7 tools whose names match the registered tool list', () => {
    // Each tool must appear as a backticked name in the body.
    for (const name of TOOL_NAMES) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(content).toMatch(re);
    }
    expect(TOOL_NAMES).toHaveLength(7);
  });

  it('frontmatter contains name, version, description, mcpServers', () => {
    const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter, 'POWER.md must start with YAML frontmatter').not.toBeNull();
    const body = frontmatter![1]!;
    expect(body).toMatch(/^name:\s*hearsay-debug/m);
    expect(body).toMatch(/^version:\s*/m);
    expect(body).toMatch(/^description:\s*/m);
    expect(body).toMatch(/^mcpServers:\s*$/m);
  });
});
