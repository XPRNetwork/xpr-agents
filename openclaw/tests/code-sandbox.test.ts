import { describe, it, expect, beforeAll } from 'vitest';
import codeSandboxSkill from '../skills/code-sandbox/src/index';

/**
 * node:vm is not a hard boundary: handing a HOST closure into the context exposes
 * `fn.constructor` (the host realm's Function, where code generation is still
 * allowed) even with codeGeneration disabled for the context. The skill therefore
 * hands the sandbox only primitive strings and runs console/atob/btoa/serialization
 * as sandbox-realm code. These lock that in.
 */
const tools: Record<string, { handler: (p: any) => Promise<any> }> = {};
beforeAll(() => {
  codeSandboxSkill({ registerTool: (t: any) => { tools[t.name] = t; }, getConfig: () => ({}) } as any);
});

describe('code-sandbox isolation', () => {
  it('cannot read host process.env via a constructor walk', async () => {
    // Two distinct escape paths: a host closure's constructor, and the global
    // object's own constructor (`this`). Both must resolve to the sandbox realm's
    // Function, which codeGeneration:false blocks.
    for (const code of [
      'return console.log.constructor("return process.env.HOME")()',
      'return this.constructor.constructor("return process.env.HOME")()',
      'return (function(){return this})().constructor.constructor("return process.env.HOME")()',
    ]) {
      const r = await tools.execute_js.handler({ code });
      expect(r.result, code).toBeUndefined();
      expect(String(r.error), code).toMatch(/blocked|Code generation|not a function|undefined/i);
    }
  });

  it('cannot pollute the host Object.prototype', async () => {
    await tools.execute_js.handler({ code: 'Object.prototype.__pwned = 1; return 1;' });
    expect(({} as any).__pwned).toBeUndefined();
  });

  it('runs ordinary code with console + INPUT', async () => {
    const r = await tools.execute_js.handler({ code: 'console.log("hi", INPUT.x); return INPUT.x * 2;', input: { x: 21 } });
    expect(r.result).toBe(42);
    expect(r.logs).toContain('hi 21');
  });

  it('lets user code redeclare INPUT without a syntax error', async () => {
    const r = await tools.execute_js.handler({ code: 'var INPUT = 5; return INPUT + 1;' });
    expect(r.result).toBe(6);
  });

  it('provides working atob/btoa', async () => {
    const r = await tools.execute_js.handler({ code: 'return btoa("hello") + "|" + atob(btoa("world"));' });
    expect(r.result).toBe('aGVsbG8=|world');
  });

  it('eval_expression returns value and type', async () => {
    const r = await tools.eval_expression.handler({ expression: '[1,2,3].map(x=>x*x)' });
    expect(r.result).toEqual([1, 4, 9]);
    expect(r.type).toBe('array');
  });

  it('serializes results inside the sandbox so a malicious getter cannot stall the host', async () => {
    const start = Date.now();
    const r = await tools.execute_js.handler({ code: 'return { get boom(){ while(Date.now()-0<0){} return 1; }, v: 2 };', timeout: 500 });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(r.result).toEqual({ boom: 1, v: 2 });
  });
});
