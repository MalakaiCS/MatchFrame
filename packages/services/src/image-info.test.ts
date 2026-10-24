import { describe, expect, it } from 'vitest';
import { imageInfo } from './image-info';

// 300 × 156 red images as FFmpeg writes them
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAASwAAACcCAIAAABKogHjAAAACXBIWXMAAAABAAAAAQBPJcTWAAACFUlEQVR4nO3OQQkAMBAEsfPvuVAZ89hABOTeHRDqBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOP6AYzrBzCuH8C4fgDj+gGM6wcwrh/AuH4A4/oBjOsHMK4fwLh+AOM+l+m2HfJFrFAAAAAASUVORK5CYII=';
const JPEG = '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAnAEsAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiwEo38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/9k=';
const WEBP_LOSSY = 'UklGRrgAAABXRUJQVlA4IKwAAACwDQCdASosAZwAPpFIoU0lpCMiICgAsBIJaW7hdqlwAABPeCch77ZOQ99snIe+2TkPfbJyHvtk5D32ygZeLk5D32ycj/nk5D32ych9C+l2vFych78AQD32ych77ZjLT2ych77ZOcRFych77ZOREDych77ZOP4AAP7/X9c//4DdfFtMv//ucD/ucD/ucD+NuATlGUHApjUaFLPi6789b89b89b89b89b89b8AAA';
const WEBP_LOSSLESS = 'UklGRiQAAABXRUJQVlA4TBcAAAAvK8EmAAcQ9Y/+BwQkif//RxH9T/vfSQA=';
const buf = (s: string) => Buffer.from(s, 'base64');

describe('image info', () => {
  it('reads PNG, JPEG and WebP (lossy and lossless) sizes from the bytes', () => {
    expect(imageInfo(buf(PNG))).toEqual({ mime: 'image/png', width: 300, height: 156 });
    expect(imageInfo(buf(JPEG))).toEqual({ mime: 'image/jpeg', width: 300, height: 156 });
    expect(imageInfo(buf(WEBP_LOSSY))).toEqual({ mime: 'image/webp', width: 300, height: 156 });
    expect(imageInfo(buf(WEBP_LOSSLESS))).toEqual({ mime: 'image/webp', width: 300, height: 156 });
  });
  it('refuses markup, scripts, truncated and other files', () => {
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(imageInfo(Buffer.from('<html><body>not an image</body></html>'))).toBeNull();
    expect(imageInfo(buf(PNG).subarray(0, 20))).toBeNull();
    expect(imageInfo(Buffer.from('GIF89a\x01\x00\x01\x00'))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
  });
});
