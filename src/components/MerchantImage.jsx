import { useState } from 'react';
import { Package } from 'lucide-react';

// Every order card must show something REAL. Three tiers, each demoting to the
// next on a load error so an expired storage URL degrades instead of rendering
// a broken-image glyph:
//   1. the product photo (email thumbnail, or its HQ product-page upgrade),
//      full-bleed with a tonal scrim so glass chips stay legible on it
//   2. the merchant logo as a hero: a white sticker chip floating on a
//      brand-tinted gradient, with a blurred echo of the mark behind it
//   3. a generic parcel tile: the same sticker anatomy with a package glyph.
//      Never letter initials; a giant letter reads as a bug, not a brand.
//
// The tint hue is hashed from the merchant name so a given merchant always
// looks the same, using the same soft-tint HSL shape as the status tokens.

const HUES = [212, 258, 340, 24, 150, 190, 320, 45];

// Some merchants only publish a 16px favicon, and Google's favicon service
// upscales those. Blown up they read as an empty smudge, which is worse than no
// logo, so anything below this is treated as unusable and demoted to the tile.
// Measured from the decoded image rather than trusting Order.logo_width, so
// legacy rows written before that field existed are handled too.
const MIN_USABLE_PX = 48;

function tooSmall(img) {
  return img.naturalWidth > 0 && Math.min(img.naturalWidth, img.naturalHeight) < MIN_USABLE_PX;
}

export function merchantHue(name = '') {
  const sum = [...String(name)].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return HUES[sum % HUES.length];
}

function heroTint(hue) {
  return `linear-gradient(140deg, hsl(${hue} 55% 95%), hsl(${hue} 48% 90%) 60%, hsl(${(hue + 40) % 360} 50% 93%))`;
}

// The always-there fallback: a parcel glyph on the merchant's hue. A span so it
// can sit inside a link.
function ParcelGlyph({ name, size, rounded, className }) {
  const hue = merchantHue(name);
  return (
    <span
      aria-hidden="true"
      className={`${rounded} shrink-0 grid place-items-center select-none ${className}`}
      style={{ width: size, height: size, background: `hsl(${hue} 50% 92%)`, color: `hsl(${hue} 45% 38%)` }}
    >
      <Package style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }} strokeWidth={2.25} />
    </span>
  );
}

// Small square logo used next to the merchant name.
export function MerchantLogo({ order, size = 20, className = '', rounded = 'rounded' }) {
  const [unusable, setUnusable] = useState(false);
  const name = order?.merchant_name ?? '';

  if (order?.logo_url && !unusable) {
    return (
      <img
        src={order.logo_url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setUnusable(true)}
        onLoad={(e) => { if (tooSmall(e.currentTarget)) setUnusable(true); }}
        className={`${rounded} shrink-0 object-contain bg-white ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <ParcelGlyph name={name} size={size} rounded={rounded} className={className} />;
}

// The card hero band: product photo, else the logo enlarged on a brand tint,
// else the parcel sticker at the same size.
export default function MerchantImage({ order, className = '' }) {
  const [imageBroken, setImageBroken] = useState(false);
  const [logoUnusable, setLogoUnusable] = useState(false);

  const name = order?.merchant_name ?? '';
  const productImage = (order?.items ?? []).find((i) => i.image_url)?.image_url;
  const hue = merchantHue(name);

  if (productImage && !imageBroken) {
    return (
      <div className={`relative bg-muted overflow-hidden ${className}`}>
        <img
          src={productImage}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageBroken(true)}
          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <div className="absolute inset-0 hero-scrim" aria-hidden="true" />
      </div>
    );
  }

  const showLogo = order?.logo_url && !logoUnusable;
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: heroTint(hue) }}
    >
      {showLogo ? (
        <>
          {/* Blurred echo gives the flat tint depth. No handlers on purpose:
              when the real logo demotes, both unmount together. */}
          <img
            src={order.logo_url}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="absolute left-1/2 top-1/2 w-44 h-44 -translate-x-1/2 -translate-y-1/2 object-contain blur-2xl opacity-30 saturate-150 scale-110"
          />
          {/* Merchant marks are often white-on-transparent, so the logo sits on
              its own white sticker rather than the tint alone. */}
          <span
            className="relative grid place-items-center rounded-2xl bg-white/90 ring-1 ring-black/5 card-shadow"
            style={{ width: 84, height: 84 }}
          >
            <img
              src={order.logo_url}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setLogoUnusable(true)}
              onLoad={(e) => { if (tooSmall(e.currentTarget)) setLogoUnusable(true); }}
              className="object-contain"
              style={{ width: 60, height: 60 }}
            />
          </span>
        </>
      ) : (
        <span
          className="grid place-items-center rounded-2xl bg-white/90 ring-1 ring-black/5 card-shadow outline outline-1 outline-dashed outline-black/10 outline-offset-4"
          style={{ width: 84, height: 84, color: `hsl(${hue} 40% 38%)` }}
        >
          <Package className="w-9 h-9" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
