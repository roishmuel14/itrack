// Combined classify + extract: ONE InvokeLLM call per email with a strict
// response_json_schema (PRD section 8). Also the "same order?" arbitration
// helper and the claim-drafting prompt used by refunds/scan.

export const CLASSIFICATIONS = [
  "order_confirmation",
  "shipping_update",
  "delivery",
  "delay",
  "seller_message",
  "refund_update",
  "other_order_related",
  "irrelevant",
] as const;

export const PRODUCT_KINDS = [
  "physical_goods",
  "food_or_grocery_delivery",
  "digital_or_saas",
  "service_or_booking",
  "other",
] as const;

export interface ExtractionResult {
  is_order_related: boolean;
  classification: (typeof CLASSIFICATIONS)[number];
  product_kind: (typeof PRODUCT_KINDS)[number] | null;
  merchant_name: string | null;
  merchant_domain: string | null;
  order_number: string | null;
  event_type: string | null;
  items: Array<
    { name: string; qty: number | null; price: number | null; image_url: string | null; product_url?: string | null }
  > | null;
  currency: string | null;
  total: number | null;
  promised_date: string | null;
  eta_date: string | null;
  event_date: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status_suggestion: string | null;
  confidence: number;
  notes: string | null;
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    is_order_related: { type: "boolean", description: "Is this email about a purchase of PHYSICAL goods shipped (or to be shipped) to the recipient? false for SaaS/digital/services/bills/food delivery" },
    classification: { type: "string", enum: [...CLASSIFICATIONS] },
    product_kind: {
      type: "string",
      enum: [...PRODUCT_KINDS],
      description: "What was purchased. physical_goods = tangible items shipped, couriered, or awaiting store/locker pickup (a carrier's parcel notification always counts); food_or_grocery_delivery = restaurant, food-app, or supermarket/grocery orders; digital_or_saas = software, subscriptions, licenses, domains, hosting, digital content; service_or_booking = flights, hotels, events, insurance, utilities, rides; other = none of these or unclear",
    },
    merchant_name: { type: ["string", "null"], description: "Store/brand the goods were bought FROM, e.g. Amazon. For a carrier notification: the shipper (store) if the notice names one, else the carrier's name" },
    merchant_domain: { type: ["string", "null"], description: "Bare domain of the STORE, e.g. amazon.com; null if unknown. Never a carrier or delivery-company domain (fedex.com, ups.com, israelpost.co.il and similar)" },
    order_number: { type: ["string", "null"], description: "Merchant order id exactly as written" },
    event_type: {
      type: ["string", "null"],
      enum: ["order_confirmation", "shipment", "transit_update", "out_for_delivery", "delivered", "delay", "seller_message", "refund_update", "other", null],
      description: "Timeline event this email represents",
    },
    items: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: ["integer", "null"] },
          price: { type: ["number", "null"] },
          image_url: { type: ["string", "null"], description: "MUST be one of the provided image candidate URLs or null" },
          product_url: { type: ["string", "null"], description: "MUST be one of the provided link candidate URLs or null" },
        },
        required: ["name"],
      },
    },
    currency: { type: ["string", "null"], description: "ISO code like USD, ILS, EUR" },
    total: { type: ["number", "null"] },
    promised_date: { type: ["string", "null"], description: "Merchant-promised delivery/arrival date, ISO YYYY-MM-DD. Never a payment due, renewal, or billing date" },
    eta_date: { type: ["string", "null"], description: "Latest delivery ETA in the email, ISO YYYY-MM-DD. Never a payment due, renewal, or billing date" },
    event_date: { type: ["string", "null"], description: "When the described event happened per the email itself (order placed / shipped / delivered date), ISO 8601; null if not stated. For forwarded emails prefer the ORIGINAL message's date over the forward date." },
    carrier: { type: ["string", "null"], description: "Carrier name as written, e.g. UPS" },
    tracking_number: { type: ["string", "null"] },
    status_suggestion: {
      type: ["string", "null"],
      enum: ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered", "delayed", "cancelled", "returned", null],
    },
    confidence: { type: "number", description: "0-1 confidence in the extraction overall" },
    notes: { type: ["string", "null"], description: "Anything ambiguous worth flagging" },
  },
  required: ["is_order_related", "classification", "product_kind", "confidence"],
};

// ------------------------------------------------------------- policy gates
// Kept beside the schema so the enum, the prompt, and the code acting on them
// stay in one file. Tested in scripts/tests/extractGates.test.ts.

// Classifications allowed to OPEN a card. Everything else (seller messages,
// refund notes, misc) may only attach to an existing order (PRD v1.4).
export const CREATE_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "order_confirmation",
  "shipping_update",
  "delivery",
  "delay",
]);

export function canCreateOrder(classification: string): boolean {
  return CREATE_CLASSIFICATIONS.has(classification);
}

// Only physical parcels get cards (PRD v1.4). "other"/missing kinds survive on
// hard logistics evidence alone, because carrier parcel notices name no
// product; a NAMED exclusion kind (food, SaaS, booking) is final and is never
// overridden by evidence.
export function isTrackablePurchase(
  e: Pick<ExtractionResult, "product_kind" | "tracking_number" | "carrier">,
): boolean {
  const kind = e.product_kind ?? null;
  if (kind === "physical_goods") return true;
  if (kind === null || kind === "other") return !!(e.tracking_number || e.carrier);
  return false;
}

export interface EmailForExtraction {
  from: string;
  subject: string;
  text: string;
  imageCandidates: string[];
  linkCandidates?: string[];
  today: string; // ISO date, for resolving relative dates
}

export function buildExtractionPrompt(email: EmailForExtraction): string {
  return [
    "You are the email classifier and parser of a PACKAGE-tracking app. The app tracks physical parcels shipped to the recipient. Analyze ONE email: first decide whether it is about a physical-goods order or shipment, then extract structured facts.",
    "",
    "STEP 1 - DECIDE. The subject line proves nothing: this email was pre-filtered by broad keywords like 'order', 'shipping', 'delivery', so SaaS invoices, subscription renewals, bills, and promos slip through. Judge by the BODY. Real shipment evidence:",
    "- Arrival-date phrases: 'estimated delivery', 'expected delivery date', 'delivery date', 'arriving', 'arrives by', 'expected by', 'get it by', 'estimated arrival', 'ETA', 'ships by', 'out for delivery', 'delivered on'; Hebrew: 'תאריך אספקה', 'מועד אספקה', 'זמן אספקה', 'תאריך משוער', 'תאריך הגעה', 'הגעה משוערת', 'צפוי להגיע', 'יגיע עד', 'אספקה עד', 'בדרך אליך', 'נשלחה', 'נמסרה'.",
    "- Logistics evidence: tracking number, carrier name (UPS, FedEx, DHL, USPS, Israel Post / דואר ישראל, HFD, Cheetah and similar), shipping address, 'your package', 'has shipped', 'on its way', customs, pickup point / נקודת איסוף, parcel locker.",
    "- Physical goods: named products with quantity, size, or color that must physically ship.",
    "- Pickup counts too: 'ready for pickup/collection', 'מוכנה לאיסוף', locker and pickup-point notices are part of the delivery flow (suggest status out_for_delivery).",
    "",
    "ALWAYS set product_kind; it decides whether a card is created, so answer it purely from WHAT WAS BOUGHT, independent of how order-like the email sounds:",
    "- physical_goods: tangible items shipped, couriered, or awaiting store/locker pickup. A carrier's parcel notification (Israel Post, FedEx, UPS...) is always physical_goods even when it names no product.",
    "- food_or_grocery_delivery: restaurant and food-app orders (Wolt, 10bis) AND supermarket/grocery orders (e.g. חצי חינם) - even scheduled next-day slots.",
    "- digital_or_saas: software, subscriptions, licenses, domains, hosting, cloud, digital content.",
    "- service_or_booking: flights, hotels, car rentals, events, insurance, utilities, rides.",
    "- other: none of the above, or genuinely unclear.",
    "",
    "STEP 2 - DISTINGUISH DATE TYPES. 'Due date', 'payment due', 'amount due', 'auto-renews on', 'billing date', 'לתשלום עד', 'תאריך חיוב', 'מועד תשלום' are PAYMENT dates, not delivery dates. An email whose only date is a payment, renewal, or billing date is an invoice or subscription notice, NOT a delivery. Never place such a date in promised_date or eta_date.",
    "",
    "is_order_related = true ONLY for a specific purchase of physical goods that will be, is being, or was shipped to the recipient (including delay notices, seller messages, and refund updates on such orders). An order confirmation for physical goods counts even when no delivery date is stated yet.",
    "",
    "Always classification 'irrelevant' (is_order_related = false):",
    "- SaaS, software, hosting, domains, and any subscription purchase, renewal, invoice, or receipt.",
    "- Digital products: licenses, e-books, online courses, gift cards, in-game credits, app purchases, digital tickets.",
    "- Bills and services: utilities, phone/internet, insurance, bank and payment-app notifications with no shipped goods.",
    "- Same-day food or grocery delivery (Wolt, 10bis, restaurant orders) and ride-hailing.",
    "- Travel and bookings: flights, hotels, car rentals, event reservations.",
    "- Marketing: promotions, deals, coupons, newsletters, cart-abandonment, back-in-stock, price-drop, wishlist, recommendations, review/feedback requests.",
    "- Account emails: registration, password, security, terms or policy updates.",
    "When evidence is ambiguous, choose 'irrelevant': a real shipment email almost always names a merchant plus at least one of order number, tracking number, ordered items, or an arrival-date phrase. A missed email can be added manually; a wrong card pollutes the dashboard.",
    "",
    "STEP 3 - EXTRACT (only when relevant):",
    "- Extract ONLY what the email states. Never guess or invent values; use null when absent.",
    "- Carrier and delivery-company notifications (FedEx, UPS, DHL, Israel Post / דואר ישראל, couriers, pickup-point and locker services): the carrier's name goes in the carrier field, NEVER in merchant_domain. merchant_name is the STORE the parcel was bought from when the email reveals it; if no store is named, use the carrier's name so the card stays readable. merchant_domain is the store's bare domain only when you are confident of it; otherwise null. Never output a carrier's or delivery company's domain as merchant_domain.",
    "- Dates: resolve to ISO format (YYYY-MM-DD) using the reference date for relative phrases like 'arriving tomorrow'. A date range like 'Jul 25 - Aug 2' means promised_date is the LAST day.",
    "- promised_date / eta_date come from arrival-date phrases only, never from payment or billing dates.",
    "- items[].image_url: pick from the numbered image candidates below ONLY if it clearly shows that product; otherwise null. Never output any other URL.",
    "- items[].product_url: pick the link candidate that opens that exact product's page on the store (usually the link wrapping the product image or name). Tracking-wrapped links (click.*, awstrack, etc.) are fine. Never pick order-status, package-tracking, unsubscribe, account, or help links. Null when unsure.",
    "- status_suggestion maps what happened: confirmation->ordered, 'shipped/on its way'->shipped, carrier scan updates->in_transit, 'out for delivery'->out_for_delivery, 'delivered'->delivered, delay notices->delayed.",
    "- confidence reflects how sure you are of the WHOLE extraction (0-1). Clean merchant emails are typically >0.8; forwarded, truncated, or odd emails lower it. If you hesitated between relevant and irrelevant, keep it at or below 0.6.",
    "- event_date: the date the described event actually happened per the email content (e.g. the original message date in a forwarded email), not when it was forwarded.",
    "",
    `Reference date (today): ${email.today}`,
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    "",
    "Image candidates (by index):",
    email.imageCandidates.length
      ? email.imageCandidates.map((u, i) => `${i + 1}. ${u}`).join("\n")
      : "(none)",
    "",
    "Link candidates (by index):",
    (email.linkCandidates ?? []).length
      ? (email.linkCandidates ?? []).map((u, i) => `${i + 1}. ${u}`).join("\n")
      : "(none)",
    "",
    "Email text:",
    "---",
    email.text,
    "---",
  ].join("\n");
}

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export async function analyzeEmail(
  base44: Base44Client,
  email: EmailForExtraction,
): Promise<ExtractionResult> {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: buildExtractionPrompt(email),
    response_json_schema: EXTRACTION_SCHEMA,
  });
  if (!result || typeof result !== "object" || typeof result.is_order_related !== "boolean") {
    throw new Error("InvokeLLM returned an unexpected shape for extraction");
  }
  if (typeof result.confidence !== "number" || Number.isNaN(result.confidence)) {
    result.confidence = 0;
  }
  return result as ExtractionResult;
}

// "Same order?" arbitration for ambiguous merges (PRD section 8). Summary A is
// built from ONE incoming email; summary B from an existing order card. Cards
// born from carrier or delivery notices are legitimately sparse, so missing
// fields must read as missing data, never as evidence of difference (the old
// "when in doubt, answer false" prompt turned every sparse candidate into a
// guaranteed duplicate).
export interface ArbitrationInput {
  incoming: string;
  existing: string;
  // True when the two sides do not share a confirmed store (the candidate
  // reached the list through a carrier/domainless wildcard). Cross-merchant
  // matches need positive linking evidence; same-merchant matches lean toward
  // merging, because a duplicate card is the worse failure.
  crossMerchant: boolean;
}

export function buildArbitrationPrompt(a: ArbitrationInput): string {
  const modeRule = a.crossMerchant
    ? "- The two sides do NOT share a confirmed store: one may be a carrier notice or missing its merchant. Answer true ONLY on positive linking evidence: the email names the order's store or brand, a matching tracking number, matching item names, or a matching total with fitting dates. When in doubt, answer false."
    : "- Both sides are the same merchant. If nothing above contradicts, answer true: two cards for one purchase is the worse failure. Answer false only on a concrete contradiction.";
  return [
    "You are the order-matching arbiter of a package-tracking app. Summary A describes ONE incoming email. Summary B describes an EXISTING order card built from earlier emails. Decide whether A is about the same real-world purchase as B.",
    "",
    "Rules:",
    '- Fields marked "unknown" are MISSING data, never evidence of a different order. Carrier and delivery notices routinely name no order number, no items, and no total, and a card created from such an email is legitimately sparse.',
    "- An order's lifecycle runs order confirmation, then shipping, then delivery, usually within a few weeks. Dates that fit one lifecycle support a match.",
    "- Concrete contradictions mean DIFFERENT orders (answer false): two different explicit order numbers; two different explicit tracking numbers when items or totals also disagree (one order can ship as several parcels); clearly different item sets bought around the same time; materially different totals when both are stated; a shipping or delivery event dated before the other side's order was placed (allow one day of slack).",
    modeRule,
    "",
    "Summary A (incoming email):",
    a.incoming,
    "",
    "Summary B (existing order):",
    a.existing,
  ].join("\n");
}

export async function arbitrateSameOrder(
  base44: Base44Client,
  input: ArbitrationInput,
): Promise<boolean> {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: buildArbitrationPrompt(input),
    response_json_schema: {
      type: "object",
      properties: { same_order: { type: "boolean" } },
      required: ["same_order"],
    },
  });
  return result?.same_order === true;
}

// Claim drafting for refunds/scan (PRD section 8): 3-5 polite sentences,
// cites order number, promised date, actual status, and the policy.
export function buildClaimPrompt(orderSummary: string, policyDescription: string): string {
  return [
    "Draft a short, polite refund/compensation claim message a customer can send to a merchant's support.",
    "Rules: 3-5 sentences. Cite the order number, the promised delivery date, and that it has not arrived (or arrived late). Reference the policy below. Never invent amounts, dates, or promises not present in the input. Plain text, no placeholders, no subject line.",
    "",
    "Order:",
    orderSummary,
    "",
    "Applicable policy:",
    policyDescription,
  ].join("\n");
}
