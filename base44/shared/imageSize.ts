// Byte-level image dimensions, no decoder and no dependency.
//
// Why this exists: a site's declared icon size (`<link sizes="192x192">`) is a
// claim, not a fact, and Google's favicon service happily returns a 16px icon
// UPSCALED to whatever sz= you asked for. Both look "large" until they render.
// Measuring the actual pixel header is the only way to tell a sharp logo from a
// blurry upscale, so it is the acceptance gate for every logo we store.

export interface ImageDims {
  w: number;
  h: number;
}

// Returns null when the header is unreadable or the format is unsupported
// (notably SVG and ICO, which we never accept as logos anyway).
export function imageSize(b: Uint8Array): ImageDims | null {
  // 10 bytes is the smallest header we can read (GIF); per-format checks follow.
  if (b.byteLength < 10) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // PNG: 8-byte signature, then IHDR with width/height at 16 and 20 (big endian).
  if (dv.getUint32(0) === 0x89504e47 && b.byteLength > 24) {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }

  // GIF87a / GIF89a: logical screen size at 6 and 8 (little endian).
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b.byteLength >= 10) {
    return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }

  // WebP: "RIFF" .... "WEBP" then a VP8 / VP8L / VP8X chunk.
  if (b.byteLength >= 16 && dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fmt === "VP8X" && b.byteLength >= 30) {
      return {
        w: ((b[24] | (b[25] << 8) | (b[26] << 16)) >>> 0) + 1,
        h: ((b[27] | (b[28] << 8) | (b[29] << 16)) >>> 0) + 1,
      };
    }
    if (fmt === "VP8 " && b.byteLength >= 30) {
      // Lossy: 3-byte frame tag, 3-byte start code, then 14-bit w/h.
      return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    }
    if (fmt === "VP8L" && b.byteLength >= 25) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the segment chain to the first SOFn (skipping DHT/DAC/RSTn).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.byteLength) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // Padding bytes and standalone markers carry no length field.
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      }
      const len = dv.getUint16(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  }

  return null;
}

// The number we actually rank logos by: a 512x64 wordmark is not a 512px icon.
export function shortSide(b: Uint8Array): number {
  const dims = imageSize(b);
  return dims ? Math.min(dims.w, dims.h) : 0;
}
