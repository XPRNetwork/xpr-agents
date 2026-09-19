/**
 * Code Sandbox Skill — execute JavaScript in a sandboxed V8 context
 *
 * Zero external dependencies — uses Node.js built-in `vm` module.
 */

import vm from 'vm';

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<unknown>;
}

interface SkillApi {
  registerTool(tool: ToolDef): void;
  getConfig(): Record<string, unknown>;
}

// ── Constants ───────────────────────────────────

const DEFAULT_TIMEOUT = 5000;
const MAX_TIMEOUT = 30000;
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

// ── Sandbox helpers ─────────────────────────────
//
// SECURITY: the context is given ONLY primitive strings — never a host function or
// object. That is the whole game with node:vm. `codeGeneration.strings:false` only
// disables eval/Function *for this context's own realm*; a host closure handed in
// (a console mock, atob/btoa via Buffer, anything) exposes `fn.constructor` — the
// HOST realm's Function, where code generation is still allowed — so
// `console.log.constructor("return process.env")()` would read the runner's secrets
// and `Object.getPrototypeOf(hostFn).constructor.prototype` would pollute the host.
// So: console, atob/btoa, INPUT parsing and the *result serialization* all run as
// sandbox-realm code (below). Serializing inside the sandbox also keeps it under the
// execution timeout — a malicious getter can no longer stall the host via a
// host-side JSON.stringify. The only value read back out is a JSON string (a
// primitive), which the host then parses safely.

/** Sandbox-realm preamble: pure-JS console/atob/btoa/INPUT, no host references. */
const SANDBOX_PREAMBLE = `
var __logs = [];
var console = {
  log: function(){ __logs.push(Array.prototype.map.call(arguments, function(a){ return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
  warn: function(){ __logs.push('[warn] ' + Array.prototype.map.call(arguments, function(a){ return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
  error: function(){ __logs.push('[error] ' + Array.prototype.map.call(arguments, function(a){ return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); }
};
var __B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function btoa(s){ s = String(s); var o = ''; for (var i = 0; i < s.length; ) {
  var c1 = s.charCodeAt(i++), c2 = s.charCodeAt(i++), c3 = s.charCodeAt(i++);
  var e1 = c1 >> 2, e2 = ((c1 & 3) << 4) | (c2 >> 4), e3 = ((c2 & 15) << 2) | (c3 >> 6), e4 = c3 & 63;
  if (isNaN(c2)) { e3 = e4 = 64; } else if (isNaN(c3)) { e4 = 64; }
  o += __B64.charAt(e1) + __B64.charAt(e2) + (e3 === 64 ? '=' : __B64.charAt(e3)) + (e4 === 64 ? '=' : __B64.charAt(e4));
} return o; }
function atob(s){ s = String(s).replace(/[^A-Za-z0-9+/=]/g, ''); var o = ''; for (var i = 0; i < s.length; ) {
  var d1 = __B64.indexOf(s.charAt(i++)), d2 = __B64.indexOf(s.charAt(i++)), d3 = __B64.indexOf(s.charAt(i++)), d4 = __B64.indexOf(s.charAt(i++));
  var c1 = (d1 << 2) | (d2 >> 4), c2 = ((d2 & 15) << 4) | (d3 >> 2), c3 = ((d3 & 3) << 6) | d4;
  o += String.fromCharCode(c1); if (d3 !== 64 && d3 >= 0) o += String.fromCharCode(c2); if (d4 !== 64 && d4 >= 0) o += String.fromCharCode(c3);
} return o; }
`.trim();

/**
 * Run a self-contained expression/body in a fresh vm realm and return the parsed
 * outcome. `body` must be a statement list whose LAST expression is the user value
 * to capture. Everything is serialized to a JSON string inside the sandbox.
 */
function runInSandbox(
  body: string,
  timeoutMs: number,
  inputJson: string | undefined,
): { ok: boolean; result?: unknown; logs: string[]; error?: string; oversized?: boolean } {
  // Only a primitive string crosses into the realm — AND the context global is
  // given a NULL prototype. If we hand vm.createContext an ordinary host object,
  // the sandbox global inherits the HOST realm's Object.prototype, so
  // `this.constructor.constructor("return process.env")()` walks to the host
  // Function (where codeGeneration is allowed) and reads the runner's secrets —
  // codeGeneration:false only covers THIS context's realm. A null-proto global
  // makes `this.constructor` resolve to the sandbox realm's own Function, which
  // the flag then blocks. (Confirmed escape via the global-object path, 2026-09-19.)
  const sandboxGlobal: Record<string, unknown> = Object.create(null);
  sandboxGlobal.__INPUT_JSON = inputJson;
  const context = vm.createContext(sandboxGlobal, {
    codeGeneration: { strings: false, wasm: false },
  });
  const wrapped = `${SANDBOX_PREAMBLE}
var INPUT = (typeof __INPUT_JSON === 'string') ? JSON.parse(__INPUT_JSON) : undefined;
var __result, __error = null;
try { __result = (function(){ ${body} \n})(); } catch (e) { __error = (e && e.message) ? String(e.message) : String(e); }
(function(){
  try { return JSON.stringify({ ok: __error === null, result: __result === undefined ? null : __result, logs: __logs, error: __error }); }
  catch (e) { return JSON.stringify({ ok: __error === null, result: String(__result), logs: __logs, error: __error }); }
})();`;
  const script = new vm.Script(wrapped, { filename: 'sandbox.js' });
  const out = script.runInContext(context, { timeout: timeoutMs }) as string;
  if (typeof out !== 'string') return { ok: false, logs: [], error: 'sandbox produced no serializable output' };
  if (out.length > MAX_OUTPUT_SIZE) return { ok: false, logs: [], error: 'Output exceeded 10MB limit', oversized: true };
  const parsed = JSON.parse(out) as { ok: boolean; result?: unknown; logs: string[]; error?: string };
  return parsed;
}

// ── Skill entry point ───────────────────────────

export default function codeSandboxSkill(api: SkillApi): void {
  // ── execute_js ──
  api.registerTool({
    name: 'execute_js',
    description: [
      'Run JavaScript code in a sandboxed V8 context.',
      'Pass data via "input" (JSON), access it as INPUT in code.',
      'console.log/warn/error are captured in the "logs" array.',
      'Available: JSON, Math, Date, Array, Object, String, Number, RegExp, Map, Set,',
      'parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, atob, btoa.',
      'No network, filesystem, require, or import access. Max 30s timeout, 10MB output.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute. The last expression value is returned as the result.' },
        input: { description: 'Optional JSON data available as INPUT in the code.' },
        timeout: { type: 'number', description: 'Execution timeout in milliseconds (default 5000, max 30000).' },
      },
    },
    handler: async ({ code, input, timeout }: {
      code: string; input?: unknown; timeout?: number;
    }) => {
      if (!code || typeof code !== 'string') {
        return { error: 'code parameter is required and must be a string' };
      }

      const timeoutMs = Math.min(Math.max(timeout || DEFAULT_TIMEOUT, 100), MAX_TIMEOUT);
      const startTime = Date.now();

      let inputJson: string | undefined;
      try {
        inputJson = input === undefined ? undefined : JSON.stringify(input);
      } catch {
        return { error: 'input could not be serialized to JSON' };
      }

      try {
        const out = runInSandbox(code, timeoutMs, inputJson);
        const durationMs = Date.now() - startTime;
        if (out.oversized) {
          return { error: 'Output exceeded 10MB limit', logs: out.logs, duration_ms: durationMs, warning: 'Output exceeded 10MB limit and was truncated' };
        }
        if (!out.ok) {
          const message = out.error || 'unknown error';
          if (message.includes('Code generation from strings disallowed')) {
            return { error: 'eval() and Function() constructor are blocked in the sandbox. Use direct code instead.', logs: out.logs, duration_ms: durationMs };
          }
          return { error: message, logs: out.logs, duration_ms: durationMs };
        }
        return { result: out.result, logs: out.logs, duration_ms: durationMs };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const message = err.message || String(err);

        // Timeout is a hard interrupt thrown to the host, so it lands here.
        if (message.includes('Script execution timed out') || message.includes('timed out')) {
          return { error: `Execution timed out after ${timeoutMs}ms. Keep code efficient or increase timeout (max ${MAX_TIMEOUT}ms).`, logs: [], duration_ms: durationMs };
        }
        if (message.includes('Code generation from strings disallowed')) {
          return { error: 'eval() and Function() constructor are blocked in the sandbox. Use direct code instead.', logs: [], duration_ms: durationMs };
        }
        return { error: message, logs: [], duration_ms: durationMs };
      }
    },
  });

  // ── eval_expression ──
  api.registerTool({
    name: 'eval_expression',
    description: [
      'Evaluate a single JavaScript expression and return the result.',
      'Lightweight alternative to execute_js for quick calculations.',
      'Examples: "15 * 4500 * 0.01", "new Date().toISOString()", "[1,2,3].map(x => x*x)".',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['expression'],
      properties: {
        expression: { type: 'string', description: 'A JavaScript expression to evaluate.' },
      },
    },
    handler: async ({ expression }: { expression: string }) => {
      if (!expression || typeof expression !== 'string') {
        return { error: 'expression parameter is required and must be a string' };
      }

      try {
        // Evaluate as the returned value of the sandbox body (same isolated realm,
        // in-sandbox serialization). The value comes back as parsed JSON.
        const out = runInSandbox(`return (${expression});`, DEFAULT_TIMEOUT, undefined);
        if (!out.ok) return { error: out.error || 'evaluation failed' };
        const r = out.result;
        const type = r === null ? 'null' : Array.isArray(r) ? 'array' : typeof r;
        return { result: r, type };
      } catch (err: any) {
        const message = err.message || String(err);
        if (message.includes('timed out')) return { error: `Execution timed out after ${DEFAULT_TIMEOUT}ms.` };
        return { error: message };
      }
    },
  });
}
