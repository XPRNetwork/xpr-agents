import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    specifier = pathToFileURL(resolvePath(ROOT, 'src', specifier.slice(2))).href;
  }
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const base = specifier.startsWith('file:')
      ? fileURLToPath(specifier)
      : resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && /\.tsx?$/.test(candidate)) {
        return { url: pathToFileURL(candidate).href, format: 'module', shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (/\.tsx?$/.test(url)) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      fileName: fileURLToPath(url),
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
