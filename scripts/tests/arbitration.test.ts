// deno test scripts/tests/  (local only; never deployed)
// The arbitration prompt is behavior: the old "when in doubt, answer false"
// wording turned every sparse candidate into a guaranteed duplicate card.
// These tests pin the load-bearing rules per mode.
import { assertStringIncludes } from "jsr:@std/assert";
import { buildArbitrationPrompt } from "../../base44/shared/extract.ts";

const incoming = "merchant: Salomon\norder number: SALPOP-1";
const existing = "merchant: Salomon\norder number: unknown";

Deno.test("arbitration prompt: shared rules in both modes", () => {
  for (const crossMerchant of [false, true]) {
    const p = buildArbitrationPrompt({ incoming, existing, crossMerchant });
    assertStringIncludes(p, 'Fields marked "unknown" are MISSING data');
    assertStringIncludes(p, "Concrete contradictions mean DIFFERENT orders");
    assertStringIncludes(p, "dated before the other side's order was placed");
    assertStringIncludes(p, incoming);
    assertStringIncludes(p, existing);
  }
});

Deno.test("arbitration prompt: same-merchant mode leans toward merging", () => {
  const p = buildArbitrationPrompt({ incoming, existing, crossMerchant: false });
  assertStringIncludes(p, "If nothing above contradicts, answer true");
  assertStringIncludes(p, "two cards for one purchase is the worse failure");
});

Deno.test("arbitration prompt: cross-merchant mode demands positive evidence", () => {
  const p = buildArbitrationPrompt({ incoming, existing, crossMerchant: true });
  assertStringIncludes(p, "Answer true ONLY on positive linking evidence");
  assertStringIncludes(p, "When in doubt, answer false");
});
