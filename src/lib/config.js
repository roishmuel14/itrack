// Feature flags.
//
// GMAIL_CONNECT_ENABLED: whether to surface the per-user "Connect Gmail"
// OAuth flow. TRUE since 2026-07-23. The earlier blocker turned out to be
// host-dependent, not a hardcoded callback: Base44's connect-initiate mirrors
// the REQUEST host into the OAuth redirect_uri, and the SDK client defaults
// serverUrl to the base44.app apex, which is on the Public Suffix List and
// unregisterable in Google. connectGmail (src/api/auth.jsx) therefore calls
// the initiate endpoint on the app's own origin, whose callback IS registered
// on the Google client (scope gmail.readonly only). Each user connects their
// OWN Gmail; manual add remains available alongside. See FEEDBACK.md
// 2026-07-23 for the full root cause.
export const GMAIL_CONNECT_ENABLED = true;
