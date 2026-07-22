import { assertEquals } from "jsr:@std/assert";
import { extractAliasCandidates, extractAliasCandidatesFromText } from "../../base44/shared/aliasRouter.ts";

Deno.test("extractAliasCandidates: header priority order", () => {
  const c = extractAliasCandidates({
    "To": "iTrack <itrackapp44+tok3@gmail.com>",
    "Delivered-To": "itrackapp44+tok1@gmail.com",
    "X-Forwarded-To": "itrackapp44+tok2@gmail.com",
  });
  assertEquals(c.map((x) => x.token), ["tok1", "tok2", "tok3"]);
  assertEquals(c[0].header, "delivered-to");
});

Deno.test("extractAliasCandidates: base filter drops foreign plus-addresses", () => {
  const c = extractAliasCandidates(
    {
      "Delivered-To": "someoneelse+evil@gmail.com",
      "To": "Order Update <itrackapp44+abc12345@gmail.com>, other+x@other.com",
    },
    "itrackapp44@gmail.com",
  );
  assertEquals(c.length, 1);
  assertEquals(c[0].token, "abc12345");
});

Deno.test("extractAliasCandidates: no plus address -> empty; dedup across headers", () => {
  assertEquals(extractAliasCandidates({ To: "plain@gmail.com" }).length, 0);
  const c = extractAliasCandidates({
    "Delivered-To": "itrackapp44+same@gmail.com",
    "To": "itrackapp44+same@gmail.com",
  });
  assertEquals(c.length, 1);
});

Deno.test("extractAliasCandidatesFromText: finds alias in forwarded body only for our inbox", () => {
  const body = "---------- Forwarded message ---------\nTo: <itrackapp44+xy7k2m9q@gmail.com>\nAlso cc: friend+other@gmail.com";
  const c = extractAliasCandidatesFromText(body, "itrackapp44@gmail.com");
  assertEquals(c.length, 1);
  assertEquals(c[0].token, "xy7k2m9q");
  assertEquals(c[0].header, "body-scan");
});
