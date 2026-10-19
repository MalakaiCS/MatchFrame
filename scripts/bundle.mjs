// Bundle a Node app (workspace TS packages inlined, npm deps external) for production.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const [entry, outfile] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
// Only the app's own npm dependencies stay external (resolvable from apps/<name>/node_modules under pnpm's
// strict layout). Dependencies of workspace packages are inlined; native optionals stay external.
const external = [...Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@bs/')), 'pg-native', 'bufferutil', 'utf-8-validate', 'fsevents', '@aws-sdk/signature-v4-crt'];
await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true, external: [...new Set(external)], banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
console.log(`bundled ${entry} -> ${outfile}`);
