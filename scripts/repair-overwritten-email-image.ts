// One-time repair (2026-07-27): before email images were made authoritative,
// a web-searched picture could overwrite the photo the merchant actually sent
// when the email thumbnail measured under HQ_MIN_PX. That is how LaPelota's
// red-and-white Mikasa ball became a black-and-white shot off the FT5A series
// page. Clearing the web image (keeping product_url) makes the item blank, so
// orders/enrichProductImages restores it from the original email again.
// Run: cat scripts/repair-overwritten-email-image.ts | base44 exec

// Merchants whose order email is known to embed a real product photo.
const MERCHANTS = /la\s?pelota/i;

const orders = await base44.entities.Order.list("-created_date", 200);
let repaired = 0;
for (const o of orders) {
  if (!MERCHANTS.test(o.merchant_name ?? "")) continue;
  let changed = false;
  // deno-lint-ignore no-explicit-any
  const items = (o.items ?? []).map((it: any) => {
    if (it.image_source !== "search" && it.image_source !== "product_page") return it;
    const { image_url: _u, image_width: _w, image_source: _s, ...rest } = it;
    changed = true;
    return rest;
  });
  if (!changed) continue;
  await base44.entities.Order.update(o.id, {
    items,
    image_attempts: 0,
    image_checked_at: null,
  });
  repaired++;
  console.log(JSON.stringify({ repaired: o.merchant_name, items: items.map((i: { name: string }) => i.name) }));
}
console.log(JSON.stringify({ total_repaired: repaired }));
