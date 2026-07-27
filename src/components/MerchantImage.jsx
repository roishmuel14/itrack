import { useState } from 'react';

// Every order card must show something. Three tiers, each demoting to the next
// on a load error so an expired storage URL degrades instead of rendering a
// broken-image glyph:
//   1. the product photo mined from the order email
//   2. the merchant logo, contained rather than cropped (logos are square and
//      mostly transparent, so object-cover would slice wordmarks in half)
//   3. a deterministic initials tile, which also covers manually added orders
//      that never had a domain to look a logo up from
//
// The tile hue is hashed from the merchant name so a given merchant always looks
// the same, and uses the same soft-tint HSL shape as the status tokens in
// index.css so it reads as part of the theme rather than a placeholder.

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

export function merchantInitials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '?';
  const second = words[1] ? [...words[1]][0] : '';
  return (first + second).toUpperCase();
}

export function merchantHue(name = '') {
  const sum = [...String(name)].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return HUES[sum % HUES.length];
}

// The always-there fallback. Rendered as a span so it can sit inside a link.
function InitialsTile({ name, size, rounded, className }) {
  const hue = merchantHue(name);
  return (
    <span
      aria-hidden="true"
      className={`${rounded} shrink-0 grid place-items-center font-bold leading-none select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${hue} 62% 88%)`,
        color: `hsl(${hue} 72% 27%)`,
      }}
    >
      {merchantInitials(name)}
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
  return <InitialsTile name={name} size={size} rounded={rounded} className={className} />;
}

// The card hero band: product photo, else the logo enlarged on a tint, else the
// initials tile at the same size.
export default function MerchantImage({ order, className = '' }) {
  const [imageBroken, setImageBroken] = useState(false);
  const [logoUnusable, setLogoUnusable] = useState(false);

  const name = order?.merchant_name ?? '';
  const productImage = (order?.items ?? []).find((i) => i.image_url)?.image_url;
  const hue = merchantHue(name);

  if (productImage && !imageBroken) {
    return (
      <div className={`bg-muted overflow-hidden ${className}`}>
        <img
          src={productImage}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageBroken(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const showLogo = order?.logo_url && !logoUnusable;
  return (
    <div
      className={`grid place-items-center overflow-hidden ${className}`}
      style={{ background: `hsl(${hue} 45% 94%)` }}
    >
      {showLogo ? (
        // On a white card the logo sits on its own white chip: merchant marks are
        // often white-on-transparent and would vanish against the tint alone.
        <span
          className="grid place-items-center rounded-2xl bg-white/90 card-shadow"
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
      ) : (
        <InitialsTile name={name} size={72} rounded="rounded-2xl" className="card-shadow" />
      )}
    </div>
  );
}
