import { createClient } from '@base44/sdk';

// requiresAuth false: the app owns its login screen (public visibility).
// appBaseUrl is REQUIRED for correct auth redirects (the SDK builds
// `${appBaseUrl}/login` and the logout URL from it). Kept on the stable
// built-in URL for the competition (guaranteed up, no custom-domain
// dependency). The custom domain itrack.inboxfiles.com is connected and
// also serves, but per-user Gmail OAuth is blocked by a Base44 platform
// bug (connector callback hardcoded to the unregisterable base44.app apex;
// see FEEDBACK.md 2026-07-23), so the custom domain gives no functional
// benefit today - reverting avoids relying on it during judging.
export const base44 = createClient({
  appId: '6a6117b2e209abd12bdb7160',
  appBaseUrl: 'https://i-track-2bdb7160.base44.app',
  requiresAuth: false,
});
