#!/usr/bin/env node
// Prints fresh production secrets as KEY=value lines (paste into a hosting platform's variable editor).
// Nothing is written to disk. Run once per deployment; keep ENCRYPTION_KEY backed up.
import crypto from 'node:crypto';

const s = () => crypto.randomBytes(24).toString('base64url');
console.log(
  [
    `BETTER_AUTH_SECRET=${s()}`,
    `MEDIA_TOKEN_SECRET=${s()}`,
    `ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64')}`,
  ].join('\n'),
);
