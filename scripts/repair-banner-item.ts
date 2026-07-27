// One-time repair (2026-07-27): a product page whose only qualifying og:image
// was the STORE's 1200x589 brand banner filled LaPelota's blank item slot
// before the banner ban landed. Wipe those item images (keep product_url) so
// enrichment v2 refills them from the original email's real product photo.
// Run: cat scripts/repair-banner-item.ts | base44 exec

const orders = await base44.entities.Order.list("-created_date", 200);
let wiped = 0;
for (const o of orders) {
  if (!/la\s?pelota/i.test(o.merchant_name ?? "")) continue;
  // deno-lint-ignore no-explicit-any
  let changed = false;
  // deno-lint-ignore no-explicit-any
  const items = (o.items ?? []).map((it: any) => {
    if (it.image_source !== "product_page") return it;
    const { image_url: _u, image_width: _w, image_source: _s, ...rest } = it;
    changed = true;
    return rest;
  });
  if (!changed) continue;
  await base44.entities.Order.update(o.id, { items });
  wiped++;
  console.log(JSON.stringify({ wiped: o.id, merchant: o.merchant_name }));
}
console.log(JSON.stringify({ total_wiped: wiped }));
