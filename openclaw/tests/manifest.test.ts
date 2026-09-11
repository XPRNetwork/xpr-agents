import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import xprAgentsPlugin from '../src/index';

/**
 * OpenClaw 2026.7+ refuses every tool a plugin registers unless the manifest also
 * declares it under `contracts.tools`. It does not fail the plugin — the plugin still
 * reports `loaded` — it just drops the tools, so an undeclared tool is invisible to
 * the agent with nothing in the gateway log to say why.
 *
 * That is how 0.8.0 shipped with all 89 tools silently missing on current harnesses.
 * This test registers the plugin exactly as OpenClaw does and requires the two lists
 * to match, so adding a tool without declaring it fails here instead of in production.
 */
function registeredToolNames(): string[] {
  const names: string[] = [];
  // Shaped like the real runtime API: a pluginConfig property and no getConfig method,
  // which is how the plugin tells the runtime apart from the unit-test mock.
  const api = new Proxy(
    { pluginConfig: {}, registerTool: (tool: { name: string }) => { names.push(tool.name); } },
    { get: (target: any, key) => (key in target ? target[key] : key === 'getConfig' ? undefined : () => {}) },
  );
  xprAgentsPlugin(api);
  return names;
}

function declaredToolNames(): string[] {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'openclaw.plugin.json'), 'utf8'));
  return manifest.contracts?.tools ?? [];
}

describe('plugin manifest', () => {
  it('declares every tool the plugin registers, and nothing else', () => {
    const registered = registeredToolNames();
    const declared = declaredToolNames();

    const undeclared = registered.filter(n => !declared.includes(n));
    const stale = declared.filter(n => !registered.includes(n));

    expect(undeclared, 'registered but missing from contracts.tools — OpenClaw will drop these').toEqual([]);
    expect(stale, 'in contracts.tools but no longer registered').toEqual([]);
  });

  it('registers each tool name once', () => {
    const registered = registeredToolNames();
    expect(new Set(registered).size).toBe(registered.length);
  });
});
