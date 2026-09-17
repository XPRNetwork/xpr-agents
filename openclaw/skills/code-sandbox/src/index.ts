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

function createSandboxGlobals(inputJson: string | undefined, logs: string[]): Record<string, unknown> {
  // Capture console methods
  const consoleMock = {
    log: (...args: unknown[]) => {
      logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    },
    error: (...args: unknown[]) => {
      logs.push('[error] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    },
  };

  return {
    // INPUT is injected as a JSON string and parsed with the sandbox's OWN JSON
    // inside the wrapper (see below), so the resulting object belongs to the vm
    // realm — never a host object.
    __INPUT_JSON: inputJson,
    console: consoleMock,
    // atob/btoa need host Buffer; exposed as closures (not intrinsics).
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    // Explicitly undefined — defense in depth (also absent from a bare vm realm).
    require: undefined,
    process: undefined,
    module: undefined,
    // SECURITY: Object/Array/Math/JSON/Date/RegExp/Map/Set/parseInt/... are
    // deliberately NOT injected. A vm context is its own realm with its own
    // intrinsics, so leaving them out means prototype mutations inside the sandbox
    // (e.g. Object.prototype.x = 1) stay in the sandbox and cannot pollute the
    // host process's built-ins. node:vm is not a hard security boundary — with
    // codeGeneration.strings/wasm disabled the usual `constructor.constructor`
    // escape is blocked, but do not run fully untrusted code with secrets in env.
  };
}

function serializeResult(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    const str = JSON.stringify(value, null, 2);
    if (str.length > MAX_OUTPUT_SIZE) {
      return str.slice(0, MAX_OUTPUT_SIZE) + '\n... [truncated at 10MB]';
    }
    return str;
  } catch {
    return String(value);
  }
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
      const logs: string[] = [];
      const startTime = Date.now();

      let inputJson: string | undefined;
      try {
        inputJson = input === undefined ? undefined : JSON.stringify(input);
      } catch {
        return { error: 'input could not be serialized to JSON' };
      }

      try {
        const globals = createSandboxGlobals(inputJson, logs);
        const context = vm.createContext(globals, {
          codeGeneration: { strings: false, wasm: false },
        });

        // Parse INPUT with the sandbox's own JSON so it is a realm-native object,
        // then wrap code so the last expression is returned.
        const wrapped = `(function() {\nconst INPUT = (typeof __INPUT_JSON === 'string') ? JSON.parse(__INPUT_JSON) : undefined;\n${code}\n})()`;
        const script = new vm.Script(wrapped, { filename: 'sandbox.js' });
        const result = script.runInContext(context, { timeout: timeoutMs });
        const durationMs = Date.now() - startTime;

        const serialized = serializeResult(result);
        if (serialized.length > MAX_OUTPUT_SIZE) {
          return {
            result: serialized.slice(0, 1000) + '... [truncated]',
            logs,
            duration_ms: durationMs,
            warning: 'Output exceeded 10MB limit and was truncated',
          };
        }

        // Parse back to preserve types (arrays, objects)
        let parsed: unknown;
        try {
          parsed = JSON.parse(serialized);
        } catch {
          parsed = serialized === 'undefined' ? undefined : serialized;
        }

        return { result: parsed, logs, duration_ms: durationMs };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const message = err.message || String(err);

        // Provide helpful error context
        if (message.includes('Script execution timed out')) {
          return { error: `Execution timed out after ${timeoutMs}ms. Keep code efficient or increase timeout (max ${MAX_TIMEOUT}ms).`, logs, duration_ms: durationMs };
        }
        if (message.includes('Code generation from strings disallowed')) {
          return { error: 'eval() and Function() constructor are blocked in the sandbox. Use direct code instead.', logs, duration_ms: durationMs };
        }

        return { error: message, logs, duration_ms: durationMs };
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
        const globals = createSandboxGlobals(undefined, []);
        const context = vm.createContext(globals, {
          codeGeneration: { strings: false, wasm: false },
        });

        const script = new vm.Script(`(${expression})`, { filename: 'expr.js' });
        const result = script.runInContext(context, { timeout: DEFAULT_TIMEOUT });

        let serialized: unknown;
        try {
          serialized = JSON.parse(JSON.stringify(result));
        } catch {
          serialized = String(result);
        }

        return {
          result: serialized,
          type: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result,
        };
      } catch (err: any) {
        return { error: err.message || String(err) };
      }
    },
  });
}
