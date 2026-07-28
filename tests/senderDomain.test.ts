// Unit tests for sender-derived logo domains (base44/shared/senderDomain.ts).
// Run: deno test tests/
// The load-bearing invariant: this value feeds Order.logo_domain and nothing
// else. A false positive shows the wrong brand on a card; the blocklist and the
// eTLD+1 rule exist so an ESP's logo is never mistaken for the merchant's.

import { domainFromSender, isCarrierDomain, isNonMerchantDomain, registrableDomain } from "../base44/shared/senderDomain.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  got:  ${actual}\n  want: ${expected}`);
}

function domain(from: string, ownerEmail?: string) {
  return domainFromSender(from, ownerEmail ? { ownerEmail } : {}).domain;
}

function reason(from: string, ownerEmail?: string) {
  return domainFromSender(from, ownerEmail ? { ownerEmail } : {}).reason;
}

Deno.test("registrableDomain collapses to eTLD+1, including multi-part suffixes", () => {
  eq(registrableDomain("amazon.com"), "amazon.com", "already bare");
  eq(registrableDomain("email.amazon.com"), "amazon.com", "one sending subdomain");
  eq(registrableDomain("shipment.email.aliexpress.com"), "aliexpress.com", "deep chain");
  eq(registrableDomain("mailer.ksp.co.il"), "ksp.co.il", "co.il needs three labels");
  eq(registrableDomain("terminalx.co.il"), "terminalx.co.il", "bare co.il untouched");
  eq(registrableDomain("shop.co.uk"), "shop.co.uk", "bare co.uk untouched");
});

Deno.test("isCarrierDomain: carrier domains are merge-key wildcards", () => {
  eq(isCarrierDomain("fedex.com"), true, "carrier eTLD+1");
  eq(isCarrierDomain("track.fedex.com"), true, "carrier subdomain via eTLD+1");
  eq(isCarrierDomain("israelpost.co.il"), true, "Israel Post official domain");
  eq(isCarrierDomain("postil.co.il"), true, "Israel Post sending domain");
  eq(isCarrierDomain("salomon.com"), false, "merchant untouched");
  eq(isCarrierDomain(""), false, "empty");
  eq(isCarrierDomain(null), false, "null");
});

Deno.test("isNonMerchantDomain: validates LLM domain guesses", () => {
  eq(isNonMerchantDomain("ksp.co.il"), false, "real Israeli merchant passes");
  eq(isNonMerchantDomain("fedex.com"), false, "carriers allowed on purpose (FedEx-as-merchant)");
  eq(isNonMerchantDomain("acme.myshopify.com"), false, "platform SUBDOMAIN is a merchant");
  eq(isNonMerchantDomain("mailchimp.com"), true, "ESP rejected");
  eq(isNonMerchantDomain("mail.mailchimp.com"), true, "ESP subdomain rejected via eTLD+1");
  eq(isNonMerchantDomain("gmail.com"), true, "mailbox provider rejected");
  eq(isNonMerchantDomain("myshopify.com"), true, "bare platform rejected");
  eq(isNonMerchantDomain(""), true, "empty rejected");
});

Deno.test("real merchant senders resolve to the merchant domain", () => {
  eq(domain('"Amazon.com" <ship-confirm@amazon.com>'), "amazon.com", "display-name form");
  eq(domain("orders@zara.com"), "zara.com", "bare address");
  eq(domain("no-reply@email.amazon.com"), "amazon.com", "strips sending subdomain");
  eq(domain("noreply@mailer.ksp.co.il"), "ksp.co.il", "multi-part TLD");
  eq(domain("x@terminalx.co.il"), "terminalx.co.il", "multi-part TLD, no subdomain");
  eq(domain("a@shipment.email.aliexpress.com"), "aliexpress.com", "deep subdomain chain");
  eq(domain("Orders@AMAZON.COM."), "amazon.com", "uppercase and trailing dot");
  eq(domain("Lazuz <noreply@news.lazuz.co.il>"), "lazuz.co.il", "news. prefix on co.il");
});

Deno.test("ESP and relay senders are rejected, never used as a logo", () => {
  for (
    const from of [
      "bounce@em1234.sendgrid.net",
      "x@mail32.rsgsv.net",
      "x@mandrillapp.com",
      "x@mcsv.net",
      "x@send.klaviyomail.com",
      "x@sparkpostmail.com",
      "x@us-east-2.amazonses.com",
      "x@mailgun.org",
      "x@t.activetrail.com",
      "x@smoove.io",
    ]
  ) {
    eq(domain(from), null, `should reject ESP ${from}`);
    eq(reason(from), "esp", `reason for ${from}`);
  }
});

Deno.test("carriers are rejected: a shipping notice must not brand the order", () => {
  // Regression: an "LV" order picked up the FedEx logo because the shipping
  // notification came from FedEx. Carriers ship for every merchant.
  for (
    const from of [
      "tracking@fedex.com",
      "auto-notify@ups.com",
      "no-reply@usps.com",
      "noreply@dhl.com",
      "x@israelpost.co.il",
      "x@notifications.aftership.com",
      "x@shipstation.com",
      "x@hfd.co.il",
    ]
  ) {
    eq(domain(from), null, `should reject carrier ${from}`);
    eq(reason(from), "carrier", `reason for ${from}`);
  }
});

Deno.test("consumer mailbox providers are rejected", () => {
  eq(domain("someone@gmail.com"), null, "gmail");
  eq(reason("someone@gmail.com"), "mailbox_provider", "gmail reason");
  eq(domain("someone@walla.co.il"), null, "walla");
  eq(domain("someone@outlook.com"), null, "outlook");
});

Deno.test("the owner's own domain is rejected (self-forwarded mail)", () => {
  eq(domain("roi@example.com", "roi@example.com"), null, "exact self");
  eq(reason("roi@example.com", "roi@example.com"), "self", "self reason");
  eq(domain("orders@shop.com", "roi@example.com"), "shop.com", "unrelated sender still fine");
});

Deno.test("hosted-store platforms keep the merchant subdomain", () => {
  eq(domain("orders@acme.myshopify.com"), "acme.myshopify.com", "merchant is the subdomain");
  eq(reason("orders@acme.myshopify.com"), "platform_subdomain", "platform reason");
  eq(domain("noreply@myshopify.com"), null, "bare platform is not a merchant");
  eq(reason("noreply@myshopify.com"), "platform_bare", "bare platform reason");
});

Deno.test("garbage input never throws and never yields a domain", () => {
  for (const from of ["", "not an email", "a@localhost", "a@1.2.3.4", "@", "a@", "a@b", "<>"]) {
    eq(domain(from), null, `should reject ${JSON.stringify(from)}`);
  }
});

Deno.test("angle-addr wins over a display name containing an @", () => {
  eq(domain('"deals@spam.com" <orders@realstore.com>'), "realstore.com", "last angle group wins");
});
