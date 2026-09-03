// Minimal Node module hooks so plain `node` can run the TypeScript in src/lib/
// (resolves extensionless "./registry" imports and strips types via the
// typescript devDependency). Used by scripts/test-og-image.mjs only.
import { register } from 'node:module';
register(new URL('./ts-hooks.mjs', import.meta.url));
