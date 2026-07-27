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

export interface ExtractionResult {
  is_order_related: boolean;
  classification: (typeof CLASSIFICATIONS)[number];
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
    is_order_related: { type: "boolean", description: "Is this email about a purchase/order/delivery the recipient made?" },
    classification: { type: "string", enum: [...CLASSIFICATIONS] },
    merchant_name: { type: ["string", "null"], description: "Store/brand name, e.g. Amazon" },
    merchant_domain: { type: ["string", "null"], description: "Bare domain, e.g. amazon.com; null if unknown" },
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
    promised_date: { type: ["string", "null"], description: "Merchant-promised delivery date, ISO YYYY-MM-DD" },
    eta_date: { type: ["string", "null"], description: "Latest ETA in the email, ISO YYYY-MM-DD" },
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
  required: ["is_order_related", "classification", "confidence"],
};

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
    "You are the email parser of a package-tracking app. Analyze ONE email and extract structured order/delivery facts.",
    "",
    "Rules:",
    "- Extract ONLY what the email states. Never guess or invent values; use null when absent.",
    "- Dates: resolve to ISO format (YYYY-MM-DD) using the reference date for relative phrases like 'arriving tomorrow'. A date range like 'Jul 25 - Aug 2' means promised_date is the LAST day.",
    "- items[].image_url: pick from the numbered image candidates below ONLY if it clearly shows that product; otherwise null. Never output any other URL.",
    "- items[].product_url: pick the link candidate that opens that exact product's page on the store (usually the link wrapping the product image or name). Tracking-wrapped links (click.*, awstrack, etc.) are fine. Never pick order-status, package-tracking, unsubscribe, account, or help links. Null when unsure.",
    "- classification 'irrelevant' means not about a specific purchase of the recipient (newsletters, promos, receipts for subscriptions count as irrelevant unless they confirm a shippable order).",
    "- status_suggestion maps what happened: confirmation->ordered, 'shipped/on its way'->shipped, carrier scan updates->in_transit, 'out for delivery'->out_for_delivery, 'delivered'->delivered, delay notices->delayed.",
    "- confidence reflects how sure you are of the WHOLE extraction (0-1). Clean merchant emails are typically >0.8; forwarded, truncated, or odd emails lower it.",
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

// "Same order?" arbitration for ambiguous merges (PRD section 8).
export async function arbitrateSameOrder(
  base44: Base44Client,
  incoming: string,
  existing: string,
): Promise<boolean> {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: [
      "Two order summaries from the same merchant follow. Decide if they describe the SAME purchase (one order) or different purchases.",
      "Consider order numbers, items, totals, and dates. When in doubt, answer false (different orders).",
      "",
      "Summary A (incoming email):",
      incoming,
      "",
      "Summary B (existing order):",
      existing,
    ].join("\n"),
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
