// account/bootstrap: idempotently create the caller's UserSettings row with a
// unique alias_token, and return it. First function; establishes the mutation
// pattern: auth -> asServiceRole write with server-stamped owner_email -> error
// contract. Frontend invokes this on first authenticated load.

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 8;

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const b of bytes) token += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return token;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    const service = base44.asServiceRole.entities;

    // Idempotent: return the existing row if the user already bootstrapped.
    const existing = await service.UserSettings.filter({ owner_email: user.email });
    if (existing.length > 0) {
      return ok({ settings: existing[0], created: false });
    }

    // Generate a unique alias token (uniqueness checked server-side).
    let token = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateToken();
      const clash = await service.UserSettings.filter({ alias_token: candidate });
      if (clash.length === 0) {
        token = candidate;
        break;
      }
    }
    if (!token) throw new Error("Could not generate a unique alias token");

    // owner_email comes from the token (auth.me), NEVER from the request body.
    const created = await service.UserSettings.create({
      owner_email: user.email,
      alias_token: token,
      digest_enabled: true,
      digest_hour_utc: 7,
      forwarding_confirmed: false,
    });

    // Self-heal a bootstrap race: keep only the oldest row for this user.
    const all = await service.UserSettings.filter(
      { owner_email: user.email },
      "created_date",
    );
    if (all.length > 1) {
      for (const extra of all.slice(1)) {
        await service.UserSettings.delete(extra.id);
      }
      return ok({ settings: all[0], created: all[0].id === created.id });
    }

    return ok({ settings: created, created: true });
  } catch (err) {
    return serverError(err);
  }
});
