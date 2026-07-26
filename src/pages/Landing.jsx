import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '@/components/BrandMark';
import {
  ArrowRight,
  BellRing,
  Check,
  MailCheck,
  MapPin,
  MessagesSquare,
  Radar,
  ShieldCheck,
  Sparkles,
  Truck,
  Zap,
} from 'lucide-react';

// Public marketing page: what anonymous visitors see at "/".
// Design language: shipping-label cards, carrier scan timeline, mono type for
// operational data (the way real labels set machine data), Archivo condensed
// display headlines. Every CTA leads to /login.

const STATUS_TONES = {
  soon: 'bg-[hsl(var(--status-soon-bg))] text-[hsl(var(--status-soon))]',
  transit: 'bg-[hsl(var(--status-transit-bg))] text-[hsl(var(--status-transit))]',
  delivered: 'bg-[hsl(var(--status-delivered-bg))] text-[hsl(var(--status-delivered))]',
  overdue: 'bg-[hsl(var(--status-overdue-bg))] text-[hsl(var(--status-overdue))]',
};

function StatusPill({ tone, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] ${STATUS_TONES[tone]}`}>
      {children}
    </span>
  );
}

const BARS = [3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2];

function Barcode({ className = '' }) {
  return (
    <span className={`flex h-5 items-end gap-[2px] ${className}`} aria-hidden="true">
      {BARS.map((w, i) => (
        <span key={i} className="h-full bg-foreground/70" style={{ width: `${w}px` }} />
      ))}
    </span>
  );
}

function CtaButton({ to = '/login', children, variant = 'solid', className = '' }) {
  const styles =
    variant === 'solid'
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : variant === 'light'
        ? 'bg-white text-[#1E1B4B] hover:bg-indigo-50'
        : 'border border-border bg-card text-foreground hover:bg-muted';
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 font-mono text-[13px] font-semibold uppercase tracking-[0.14em] transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- hero visual
function LabelCard({ merchant, item, pill, route, eta, tracking, progress, scanning, className = '', floatDelay }) {
  return (
    <div className={`absolute ${className}`}>
      <div className="label-float w-[290px] rounded-2xl border bg-card p-4 card-shadow" style={{ animationDelay: floatDelay }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{merchant}</span>
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
        </div>
        <p className="mt-1.5 text-[15px] font-semibold leading-snug">{item}</p>
        <div className="mt-3 border-t border-dashed pt-3">
          <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>{route}</span>
            <span className="font-semibold text-foreground">{eta}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="relative h-full rounded-full bg-primary" style={{ width: `${progress}%` }}>
              {scanning && <div className="bar-scan absolute inset-y-0 w-1/3 bg-white/50" />}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <Barcode />
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground">{tracking}</span>
        </div>
      </div>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto h-[520px] w-[440px] max-w-full max-sm:h-[470px] max-sm:scale-[0.8] max-sm:-my-8" aria-hidden="true">
      {/* route the parcels travel, marching toward the pin */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 440 520" fill="none">
        <path
          d="M30 496 C 150 470, 110 330, 220 280 C 330 230, 300 120, 396 72"
          stroke="hsl(var(--primary) / 0.35)"
          strokeWidth="2"
          strokeDasharray="6 8"
          strokeLinecap="round"
          className="route-march"
        />
      </svg>
      {/* destination pin */}
      <div className="absolute right-[24px] top-[38px]">
        <span className="absolute inset-0 rounded-full bg-primary/40 pin-pulse" />
        <span className="relative grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground card-shadow">
          <MapPin className="h-4.5 w-4.5" size={18} />
        </span>
      </div>
      <LabelCard
        className="left-0 top-[64px] -rotate-[5deg]"
        merchant="aliexpress.com"
        item="Mechanical keyboard kit, 75%"
        pill={{ tone: 'transit', text: 'IN TRANSIT' }}
        route="SZX &#10141; TLV"
        eta="ETA AUG 04"
        tracking="LP00 6642 8091"
        progress={54}
        scanning
        floatDelay="0.8s"
      />
      <LabelCard
        className="left-[92px] top-[218px] rotate-[3deg] z-10"
        merchant="amazon.com"
        item="Sony WH-1000XM6 headphones"
        pill={{ tone: 'soon', text: 'OUT FOR DELIVERY' }}
        route="LOCAL COURIER"
        eta="TODAY"
        tracking="TBA 3117 4402 88"
        progress={88}
        floatDelay="0s"
      />
      <LabelCard
        className="left-[30px] top-[372px] -rotate-[2deg] z-20"
        merchant="asos.com"
        item="Runner jacket, olive M"
        pill={{ tone: 'delivered', text: 'DELIVERED' }}
        route="SIGNED: FRONT DOOR"
        eta="JUL 22"
        tracking="RR20 8845 115"
        progress={100}
        floatDelay="1.6s"
      />
    </div>
  );
}

// ------------------------------------------------------------------ sections
const MERCHANTS = ['Amazon', 'AliExpress', 'eBay', 'Shein', 'Temu', 'Asos', 'Etsy', 'Nike', 'Apple', 'Zara', 'Walmart', 'Best Buy'];

function Marquee() {
  const row = MERCHANTS.map((m) => (
    <span key={m} className="mx-5 inline-flex items-center gap-5 font-mono text-sm uppercase tracking-[0.18em] text-muted-foreground/90">
      {m}
      <span className="text-primary/50">&#9656;</span>
    </span>
  ));
  return (
    <section className="border-y bg-card py-5" aria-label="Stores iTrack understands">
      <p className="kicker mb-3 text-center text-muted-foreground">Already tracking orders from</p>
      <div className="overflow-hidden" role="presentation">
        <div className="marquee-track flex w-max">
          <div className="flex shrink-0 items-center">{row}</div>
          <div className="flex shrink-0 items-center" aria-hidden="true">{row}</div>
        </div>
      </div>
    </section>
  );
}

const SCANS = [
  {
    label: 'SCAN 01 / CONNECT',
    title: 'Connect your Gmail',
    copy: 'One click, read-only access. Nothing is sent, moved or deleted, and you can disconnect whenever you like.',
    icon: MailCheck,
  },
  {
    label: 'SCAN 02 / PARSE',
    title: 'AI reads the boring emails',
    copy: 'Order confirmations, shipping updates and delivery notices become clean tracking cards. No forwarding, no tracking numbers, no copy-paste.',
    icon: Sparkles,
  },
  {
    label: 'SCAN 03 / TRACK',
    title: 'Watch them race to your door',
    copy: 'Statuses move on their own, from ordered to delivered. A daily digest tells you what lands today and what is running late.',
    icon: Truck,
  },
];

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <p className="kicker text-primary reveal">How it works</p>
      <h2 className="display-head mt-3 max-w-xl text-4xl md:text-5xl reveal">Three scans between you and calm</h2>
      <div className="mt-12 grid items-center gap-12 md:grid-cols-2">
        <ol className="relative space-y-10 border-l-2 border-dashed border-primary/25 pl-8">
          {SCANS.map(({ label, title, copy, icon: Icon }, i) => (
            <li key={label} className="relative reveal" style={{ transitionDelay: `${i * 120}ms` }}>
              <span className="absolute -left-[45px] grid h-8 w-8 place-items-center rounded-full border-2 border-primary/30 bg-card text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <p className="font-mono text-xs font-semibold tracking-[0.18em] text-primary">{label}</p>
              <h3 className="mt-1.5 text-xl font-bold tracking-tight">{title}</h3>
              <p className="mt-1.5 max-w-md leading-relaxed text-muted-foreground">{copy}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-3xl border bg-card p-8 card-shadow reveal">
          <img
            src="/brand/ill-inbox.webp"
            alt="Illustration: parcels rising out of an envelope along a dashed route that ends at a map pin"
            className="mx-auto w-full max-w-md"
            loading="lazy"
          />
          <p className="mt-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Gmail in &#9656; deliveries out
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Zap,
    title: 'Live tracking cards',
    copy: 'One card per order with status, ETA and full history. Cards update in realtime, while you are looking at them.',
  },
  {
    icon: Radar,
    title: 'Delay radar',
    copy: 'Every promised delivery date is watched. The moment a package runs late it gets flagged, usually before you noticed anything.',
    wide: true,
    image: '/brand/ill-van.webp',
    imageAlt: 'Illustration: delivery van speeding with a location pin above it',
  },
  {
    icon: BellRing,
    title: 'Daily digest',
    copy: 'One short email each morning: what arrives today, what is late, what needs a decision from you.',
  },
  {
    icon: MessagesSquare,
    title: 'Ask the assistant',
    copy: '"Where are my sneakers?" is a valid query. The built-in assistant answers from your own orders.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    copy: 'Read-only Gmail scope, your rows visible to you alone, disconnect in one click. Your orders stay yours.',
  },
];

function Features() {
  return (
    <section id="features" className="border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <p className="kicker text-primary reveal">What you get</p>
        <h2 className="display-head mt-3 max-w-2xl text-4xl md:text-5xl reveal">A command center, not another app to feed</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, copy, wide, image, imageAlt }, i) => (
            <article
              key={title}
              className={`rounded-2xl border bg-background p-6 transition-shadow hover:card-shadow-hover reveal ${wide ? 'md:col-span-2 md:flex md:items-center md:gap-8' : ''}`}
              style={{ transitionDelay: `${(i % 3) * 90}ms` }}
            >
              <div className={wide ? 'md:flex-1' : ''}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight">{title}</h3>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{copy}</p>
              </div>
              {image && <img src={image} alt={imageAlt} className="mt-6 w-52 shrink-0 max-md:mx-auto md:mt-0" loading="lazy" />}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function RefundSection() {
  return (
    <section className="bg-[#1E1B4B] text-indigo-100">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
        <div>
          <p className="kicker text-amber-400 reveal">Refund radar</p>
          <h2 className="display-head mt-3 text-4xl text-white md:text-5xl reveal">Late packages owe you money</h2>
          <p className="mt-5 max-w-md leading-relaxed text-indigo-200 reveal">
            Amazon guarantees dates. AliExpress promises protection windows. Temu pays credits for late arrivals. iTrack
            knows these policies, spots the misses, and preps your claim with the amount, the deadline and the store's
            own claim page.
          </p>
          <ul className="mt-6 space-y-2.5 reveal">
            {['Watches every promised date against reality', 'Matches delays to the store refund policy', 'Drafts the claim so you only press send'].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-indigo-100">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="reveal md:justify-self-end" aria-hidden="true">
          <div className="w-full max-w-sm rotate-1 rounded-2xl border border-white/10 bg-card p-5 text-foreground card-shadow">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">aliexpress.com &#183; #8817243</span>
              <StatusPill tone="overdue">6 DAYS LATE</StatusPill>
            </div>
            <p className="mt-2 text-[15px] font-semibold">Trail camera, 4K night vision</p>
            <div className="mt-3 space-y-1.5 border-t border-dashed pt-3 font-mono text-[11px] text-muted-foreground">
              <div className="flex justify-between"><span>PROMISED</span><span className="text-foreground">JUL 20</span></div>
              <div className="flex justify-between"><span>ARRIVED</span><span className="text-foreground">&#8212;</span></div>
              <div className="flex justify-between"><span>PROTECTION CLOSES</span><span className="font-semibold text-[hsl(var(--status-soon))]">IN 9 DAYS</span></div>
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground">
              Draft claim <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: 'Does iTrack read all my email?',
    a: 'iTrack asks Google for read-only access and looks only for order, shipping and delivery emails. Nothing is ever sent, moved or deleted, and you can disconnect Gmail in one click from Settings.',
  },
  {
    q: 'Which stores does it understand?',
    a: 'Any store that emails you a receipt. Amazon, AliExpress, eBay, Shein, Temu and thousands of smaller shops: if the email contains an order, the parser will find it.',
  },
  {
    q: 'Do I need to paste tracking numbers?',
    a: 'No, and that is the point. Tracking numbers, carriers and delivery windows are pulled out of the emails you already have.',
  },
  {
    q: 'What happens when a package is late?',
    a: 'The delay radar flags it against the promised date, checks the store refund policy, and preps a claim with the amount and deadline. You review it and press send.',
  },
  {
    q: 'How much does it cost?',
    a: 'iTrack is free. Connect your Gmail and start tracking in about two minutes.',
  },
];

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <div className="mx-auto max-w-2xl">
        <p className="kicker text-center text-primary reveal">Questions</p>
        <h2 className="display-head mt-3 text-center text-4xl md:text-5xl reveal">Fair questions, straight answers</h2>
        <div className="mt-10 space-y-3">
          {FAQS.map(({ q, a }, i) => (
            <details key={q} className="group rounded-2xl border bg-card px-5 py-4 reveal" style={{ transitionDelay: `${i * 60}ms` }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary font-mono text-sm text-primary transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-20 text-center md:py-28">
        <img
          src="/brand/ill-doorstep.webp"
          alt="Illustration: a delivered parcel with a check mark waiting on a doormat"
          className="w-44 reveal"
          loading="lazy"
        />
        <h2 className="display-head mt-8 max-w-2xl text-4xl md:text-6xl reveal">Your next order should track itself</h2>
        <div className="mt-8 reveal">
          <CtaButton>
            Start tracking free <ArrowRight className="h-4 w-4" />
          </CtaButton>
        </div>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground reveal">
          Set up once &#183; tracked forever
        </p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------- shell
function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <a href="#top" aria-label="iTrack home" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
          <BrandMark markClass="w-8 h-8" textClass="text-lg" />
        </a>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Landing sections">
          {[
            ['How it works', '#how'],
            ['Features', '#features'],
            ['FAQ', '#faq'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login" className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Sign in
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Start tracking
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <BrandMark markClass="w-9 h-9" textClass="text-xl" />
          <p className="mt-3 max-w-xs leading-relaxed text-muted-foreground">
            Every package you're waiting for, live on one screen.
          </p>
        </div>
        <nav aria-label="Product">
          <p className="kicker text-muted-foreground">Product</p>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ['How it works', '#how'],
              ['Features', '#features'],
              ['FAQ', '#faq'],
            ].map(([label, href]) => (
              <li key={href}>
                <a href={href} className="text-muted-foreground transition-colors hover:text-foreground">{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="kicker text-muted-foreground">Account</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/login" className="text-muted-foreground transition-colors hover:text-foreground">Sign in</Link></li>
            <li><Link to="/login" className="text-muted-foreground transition-colors hover:text-foreground">Create an account</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-dashed">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>&#169; 2026 iTrack</span>
          <span>Gmail in &#9656; deliveries out</span>
        </div>
      </div>
    </footer>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* soft indigo wash behind the label stack */}
      <div className="pointer-events-none absolute -right-40 top-10 h-[560px] w-[560px] rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 md:grid-cols-[1.05fr_0.95fr] md:pb-24 md:pt-20">
        <div>
          <p className="kicker text-primary">Your personal delivery command center</p>
          <h1 className="display-head mt-4 text-5xl sm:text-6xl md:text-7xl">
            Every package you're waiting for,{' '}
            <span className="relative inline-block text-primary">
              live
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M4 9 C 40 3, 82 3, 116 7" stroke="#F59E0B" strokeWidth="6" fill="none" strokeLinecap="round" />
              </svg>
            </span>{' '}
            on one screen
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Connect your Gmail once. iTrack finds every order confirmation, turns it into a live tracking card, and
            watches it to your door. When a store misses its promise, it helps you claim the refund.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CtaButton>
              Start tracking free <ArrowRight className="h-4 w-4" />
            </CtaButton>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border bg-card px-6 py-3.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              See how it works
            </a>
          </div>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Read-only Gmail access &#183; 2-minute setup &#183; free
          </p>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

export default function Landing() {
  const rootRef = useRef(null);

  // Scroll reveal: sections check in like scan events. IO unobserves after the
  // first hit so nothing re-animates while reading.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const targets = root.querySelectorAll('.reveal');
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="min-h-screen bg-background">
      <LandingNav />
      <main>
        <Hero />
        <Marquee />
        <HowItWorks />
        <Features />
        <RefundSection />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
