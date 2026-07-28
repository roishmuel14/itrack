// Feature flags.
//
// (GMAIL_CONNECT_ENABLED was removed 2026-07-28: per-user Gmail connect has
// been live since 2026-07-23 and every consumer now keys on the bootstrap's
// real gmail.connected state; the flag only guarded stale "coming soon" copy.
// The connector root-cause story lives in FEEDBACK.md 2026-07-23.)

// WHATSAPP_ENABLED: whether to surface the "chat with the assistant on
// WhatsApp" affordances (the chat-header icon and the Settings card).
// getWhatsAppConnectURL is a plain synchronous string builder: it happily
// returns a URL even when the agent has no WhatsApp channel, so without this
// flag the UI shows a link that dead-ends. The channel itself can only be
// enabled from the Base44 dashboard (no CLI path), and there is a cap on how
// many agents across the workspace may claim one.
// Flip to true ONLY after the channel is enabled AND a real round trip on a
// phone passes. The connect URL embeds the user's access token, so it must
// never be logged or pasted anywhere.
export const WHATSAPP_ENABLED = true;
