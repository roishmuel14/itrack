// Unit tests for the byte-level dimension reader (base44/shared/imageSize.ts).
// Run: deno test tests/
// This is the acceptance gate for every stored logo: a site can DECLARE
// sizes="192x192" on a 32px file, and Google's favicon service returns a real
// 128px PNG whose content is an upscaled 16px icon. Only the measured header
// tells us which logo is actually sharp, so these headers must be read exactly.

import { imageSize, shortSide } from "../base44/shared/imageSize.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  got:  ${actual}\n  want: ${expected}`);
}

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

function gif(w: number, h: number): Uint8Array {
  const b = new Uint8Array(14);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  const dv = new DataView(b.buffer);
  dv.setUint16(6, w, true);
  dv.setUint16(8, h, true);
  return b;
}

function jpeg(w: number, h: number): Uint8Array {
  // SOI, then an APP0 segment to skip, then SOF0 carrying the real size.
  const b = new Uint8Array(2 + 4 + 2 + 11);
  const dv = new DataView(b.buffer);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  b[2] = 0xff;
  b[3] = 0xe0; // APP0
  dv.setUint16(4, 4); // length 4: covers itself plus 2 payload bytes
  b[8] = 0xff;
  b[9] = 0xc0; // SOF0
  dv.setUint16(10, 11); // segment length
  b[12] = 8; // precision
  dv.setUint16(13, h);
  dv.setUint16(15, w);
  return b;
}

function webpVp8x(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x52494646); // "RIFF"
  dv.setUint32(8, 0x57454250); // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const cw = w - 1;
  const ch = h - 1;
  b[24] = cw & 0xff;
  b[25] = (cw >> 8) & 0xff;
  b[26] = (cw >> 16) & 0xff;
  b[27] = ch & 0xff;
  b[28] = (ch >> 8) & 0xff;
  b[29] = (ch >> 16) & 0xff;
  return b;
}

Deno.test("reads PNG dimensions from IHDR", () => {
  const d = imageSize(png(180, 180));
  eq(d?.w, 180, "png width");
  eq(d?.h, 180, "png height");
  eq(imageSize(png(16, 16))?.w, 16, "small png");
  eq(imageSize(png(512, 512))?.w, 512, "large png");
});

Deno.test("reads GIF dimensions (little endian)", () => {
  const d = imageSize(gif(64, 48));
  eq(d?.w, 64, "gif width");
  eq(d?.h, 48, "gif height");
});

Deno.test("reads JPEG dimensions by walking to SOF0", () => {
  const d = imageSize(jpeg(200, 120));
  eq(d?.w, 200, "jpeg width");
  eq(d?.h, 120, "jpeg height");
});

Deno.test("reads WebP VP8X dimensions", () => {
  const d = imageSize(webpVp8x(256, 256));
  eq(d?.w, 256, "webp width");
  eq(d?.h, 256, "webp height");
});

Deno.test("unreadable or unsupported input returns null, never throws", () => {
  eq(imageSize(new Uint8Array(0)), null, "empty");
  eq(imageSize(new Uint8Array([1, 2, 3])), null, "too short");
  eq(imageSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null, "svg");
  eq(imageSize(new Uint8Array(40)), null, "zeroed bytes");
});

Deno.test("shortSide ranks by the smaller edge so wordmarks do not win", () => {
  eq(shortSide(png(512, 64)), 64, "wide wordmark scores its short side");
  eq(shortSide(png(180, 180)), 180, "square icon");
  eq(shortSide(new Uint8Array([1, 2, 3])), 0, "unreadable scores zero");
});
