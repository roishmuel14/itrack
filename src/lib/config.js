// Feature flags.
//
// GMAIL_CONNECT_ENABLED: whether to surface the per-user "Connect Gmail"
// OAuth flow. Currently FALSE: Base44's app-user connector hardcodes the
// OAuth callback to the unregisterable public-suffix apex
// `https://base44.app/api/external-auth/callback`, so the flow can never
// complete with a custom Google client (verified 2026-07-23, custom domain
// did not help; reported to Base44, FEEDBACK.md). The Gmail connector,
// GMAIL_CONNECTOR_ID secret, and inbox/syncMyMail backend are all wired and
// tested, so flipping this to true is the only change needed the moment
// Base44 ships the fix. Until then, manual add is the ingest path.
export const GMAIL_CONNECT_ENABLED = false;
