// Error contract helpers used by every function (PRD section 6).
// Business failures: { error, reasons: [{ code, message }] } with a 4xx status.
// The frontend maps reasons[] to toasts verbatim.

export interface Reason {
  code: string;
  message: string;
}

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function fail(status: number, error: string, reasons: Reason[]): Response {
  return Response.json({ error, reasons }, { status });
}

export function unauthorized(): Response {
  return fail(401, "Authentication required", [
    { code: "auth_required", message: "Sign in to continue" },
  ]);
}

export function serverError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Unhandled function error:", message);
  return Response.json(
    { error: "Internal error", reasons: [{ code: "internal", message: "Something went wrong. Try again." }] },
    { status: 500 },
  );
}

// auth.me() THROWS on anonymous callers; this wraps it into user-or-null.
export async function getUserOrNull(base44: { auth: { me: () => Promise<unknown> } }): Promise<any | null> {
  try {
    return await base44.auth.me();
  } catch (_) {
    return null;
  }
}
