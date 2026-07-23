import { createClient } from '@base44/sdk';

// requiresAuth false: the app owns its login screen (public visibility).
// appBaseUrl is REQUIRED for correct auth redirects (the SDK builds
// `${appBaseUrl}/login` and the logout URL from it). Set to the custom
// domain so auth AND the per-user Gmail OAuth callback stay on a
// Google-registerable host (the bare base44.app apex is a public-suffix
// domain Google refuses to register; see FEEDBACK.md 2026-07-23).
export const base44 = createClient({
  appId: '6a6117b2e209abd12bdb7160',
  appBaseUrl: 'https://itrack.inboxfiles.com',
  requiresAuth: false,
});
