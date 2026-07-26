// Merchant domain inferred from an email's From: header, for LOGO LOOKUP ONLY.
//
// Deliberately kept out of mergeEngine.ts and never written to Order.merchant_domain:
// that field is half of the merge key (decideMerge) and drives fuzzyCandidates, so
// feeding guessed domains into it would change matching for every future email and
// could merge two merchants that share a sending host. This value lands in
// Order.logo_domain instead, which nothing in the merge engine reads.
//
// The hard part is that merchants almost never send from their own bare domain.
// eTLD+1 handles the ordinary noise (email.amazon.com -> amazon.com), a blocklist
// handles the case where eTLD+1 is a mail vendor rather than the merchant, and a
// platform list handles the inverse case where the merchant IS the subdomain.

export interface SenderDomainResult {
  domain: string | null;
  reason: string;
}

// Public-suffix entries that need three labels, not two. A full PSL is overkill
// here; this covers the markets iTrack actually sees mail from.
const MULTI_PART_SUFFIXES = new Set([
  "co.il", "org.il", "net.il", "ac.il", "gov.il", "muni.il",
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz",
  "com.br", "com.mx", "com.ar", "com.tr", "com.pl",
  "co.jp", "co.kr", "com.sg", "com.hk", "com.cn", "co.in", "co.th", "co.za",
]);

// Hosted-store platforms: the merchant identity lives in the SUBDOMAIN, so
// collapsing to eTLD+1 would give every store the same logo.
const PLATFORM_SUFFIXES = new Set([
  "myshopify.com", "mybigcommerce.com", "squarespace.com", "wixsite.com",
  "bigcartel.com", "ecwid.com", "shoplineapp.com", "mysapo.net",
]);

// Mail vendors and marketing clouds. Attaching one of these logos to an order
// is the failure mode this whole module exists to prevent.
const ESP_BLOCKLIST = new Set([
  "sendgrid.net", "sendgrid.com", "mailgun.org", "mailgun.net", "amazonses.com",
  "mandrillapp.com", "mailchimp.com", "mailchimpapp.net", "mcsv.net", "mcdlv.net", "rsgsv.net",
  "klaviyomail.com", "klaviyo.com", "sparkpostmail.com", "sparkpostmail1.com", "sparkpost.com",
  "postmarkapp.com", "mtasv.net", "mailjet.com", "mjt.lu", "mailersend.net", "elasticemail.com",
  "smtp2go.com", "sendinblue.com", "brevo.com", "sendpulse.com", "zeptomail.com",
  "hubspot.com", "hubspotemail.net", "exacttarget.com", "exct.net", "mktomail.com", "marketo.com",
  "responsys.net", "rsys1.com", "rsys2.com", "cheetahmail.com", "bfi0.com", "sailthru.com",
  "createsend.com", "cmail19.com", "cmail20.com", "icptrack.com", "constantcontact.com", "ccsend.com",
  "activehosted.com", "aweber.com", "omnisend.com", "drip.com", "iterable.com", "iterable-mail.net",
  "braze.com", "appboy.com", "customeriomail.com", "customer.io", "dotdigital.com", "dmtrk.net",
  "attentivemobile.com", "emarsys.net", "zendesk.com", "freshdesk.com",
  "intercom-mail.com", "intercom.io",
  // Israeli ESPs
  "activetrail.com", "activetrail.net", "smoove.io", "inwise.net", "inwise.com", "rav-messer.co.il",
]);

// Carriers and logistics platforms. A shipping notification usually arrives FROM
// the carrier, so without this a Louis Vuitton order picks up the FedEx logo.
// Carriers ship for everyone, so their domain never identifies the merchant.
const CARRIER_DOMAINS = new Set([
  "fedex.com", "ups.com", "usps.com", "usps.gov", "dhl.com", "dhl.de", "dhlparcel.com",
  "israelpost.co.il", "aramex.com", "tnt.com", "gls-group.com", "dpd.com", "dpdgroup.com",
  "royalmail.com", "canadapost.ca", "purolator.com", "ontrac.com", "lasership.com",
  "evri.com", "hermesworld.com", "yodel.co.uk", "correos.es", "poste.it", "chronopost.fr",
  "colissimo.fr", "postnord.com", "bring.com", "posti.fi", "ptt.gov.tr",
  "sf-express.com", "cainiao.com", "yunexpress.com", "4px.com", "ecms-global.com",
  "jtexpress.com", "flytexpress.com", "sunyou-post.com", "winit.com.cn",
  // tracking aggregators and shipping platforms
  "aftership.com", "17track.net", "shipstation.com", "narvar.com", "route.com",
  "shippo.com", "goshippo.com", "easypost.com", "parcelperform.com", "shipup.co",
  "shipbob.com", "sendcloud.com", "packlink.com", "parcelapp.net",
  // Israeli last-mile
  "hfd.co.il", "boxit.co.il", "cheetah-delivery.com", "baldarhub.com", "yuvalim-express.co.il",
]);

// Consumer mailbox providers: a forwarded order confirmation, not the merchant.
const MAILBOX_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "google.com", "yahoo.com", "ymail.com",
  "hotmail.com", "live.com", "outlook.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com",
  "walla.co.il", "walla.com", "nana10.co.il",
]);

export function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

// Returns { domain: null } whenever the sender cannot be trusted to represent the
// merchant. The reason is for tests and logs, never for the UI.
export function domainFromSender(
  from: string,
  opts: { ownerEmail?: string } = {},
): SenderDomainResult {
  if (!from || typeof from !== "string") return { domain: null, reason: "empty" };

  // Prefer the angle-addr, which wins over any display name that contains an @.
  const angle = from.match(/<([^>]*)>\s*$/);
  const addr = (angle ? angle[1] : from).trim().replace(/^mailto:/i, "");
  const at = addr.lastIndexOf("@");
  if (at < 0) return { domain: null, reason: "no_at" };

  const host = addr
    .slice(at + 1)
    .toLowerCase()
    .trim()
    .replace(/[>\s.]+$/g, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { domain: null, reason: "not_a_host" };

  const reg = registrableDomain(host);

  if (PLATFORM_SUFFIXES.has(reg)) {
    // acme.myshopify.com is a real merchant; bare myshopify.com is not.
    return host === reg
      ? { domain: null, reason: "platform_bare" }
      : { domain: host, reason: "platform_subdomain" };
  }
  if (ESP_BLOCKLIST.has(reg)) return { domain: null, reason: "esp" };
  if (CARRIER_DOMAINS.has(reg)) return { domain: null, reason: "carrier" };
  if (MAILBOX_PROVIDERS.has(reg)) return { domain: null, reason: "mailbox_provider" };

  if (opts.ownerEmail) {
    const ownerHost = opts.ownerEmail.split("@").pop() ?? "";
    if (ownerHost && reg === registrableDomain(ownerHost.toLowerCase())) {
      return { domain: null, reason: "self" };
    }
  }

  return { domain: reg, reason: "ok" };
}
