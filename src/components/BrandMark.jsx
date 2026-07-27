// The one brand lockup: isometric parcel mark + Archivo wordmark.
// Used by the landing nav, the app shell header and the login screen so the
// logo renders identically everywhere.
export default function BrandMark({ markClass = 'w-8 h-8', textClass = 'text-lg', wordmark = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      <img src="/brand/logo-mark.png" alt={wordmark ? '' : 'iTrack'} aria-hidden={wordmark || undefined} className={`${markClass} shrink-0`} />
      {wordmark && <span className={`font-display font-extrabold tracking-tight leading-none ${textClass}`}>iTrack</span>}
    </span>
  );
}
