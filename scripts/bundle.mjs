// Bundle a Node app (workspace TS packages inlined, npm deps external) for production.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const [entry, outfile] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@bs/'));
// transitive npm deps of workspace packages
for (const dir of fs.readdirSync(path.resolve('../../packages'))) {
  const p = path.resolve('../../packages', dir, 'package.json');
  if (fs.existsSync(p)) for (const d of Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).dependencies ?? {})) if (!d.startsWith('@bs/')) external.push(d);
}
await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true, external: [...new Set(external)], banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
console.log(`bundled ${entry} -> ${outfile}`);
