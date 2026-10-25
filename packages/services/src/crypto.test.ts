import { describe, expect, it } from 'vitest';
import { redact } from './crypto';

describe('log redaction (A53)', () => {
  it('removes capability tokens and stream keys from URLs', () => {
    expect(redact('/api/v1/public/share/sh_x/media?t=vmByFWEMy06oWcPNSq2Azc&x=1')).toBe('/api/v1/public/share/sh_x/media?t=[redacted]&x=1');
    expect(redact('/render/programme?mode=programme&bt=eyJrIjoi.sig&url=ws://x&token=eyJhbGci')).toBe('/render/programme?mode=programme&bt=[redacted]&url=ws://x&token=[redacted]');
    expect(redact('/api/v1/public/assets/a?o=org&e=1&s=abcdef')).toBe('/api/v1/public/assets/a?o=org&e=1&s=[redacted]');
    expect(redact('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl')).toBe('rtmp://a.rtmp.youtube.com/live2/[redacted]');
  });
});
