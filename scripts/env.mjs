// Minimal .env loader with ${VAR} interpolation shared by scripts (apps use the same rules in @bs/config).
import fs from 'node:fs';

export function parseEnv(text, base = {}) {
  const out = { ...base };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (!/^["']/.test(val)) val = val.replace(/\s+#.*$/, '');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => out[k] ?? process.env[k] ?? '');
  }
  return out;
}

export function loadEnv(path = '.env') {
  if (!fs.existsSync(path)) return {};
  return parseEnv(fs.readFileSync(path, 'utf8'));
}

export function render(template, env) {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    if (env[k] === undefined) throw new Error(`Template variable ${k} missing from .env`);
    return env[k];
  });
}
