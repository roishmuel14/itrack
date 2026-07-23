import { createClient } from '@base44/sdk';

// requiresAuth false: the app owns its login screen (public visibility).
// appBaseUrl is REQUIRED for correct auth redirects (the SDK builds
// `${appBaseUrl}/login` and the logout URL from it). Kept on the stable
// built-in URL for the competition (guaranteed up, no custom-domain
// dependency). NOTE: the SDK's serverUrl defaults to the base44.app apex;
// that is fine for entities/auth/functions, but the Gmail connect-initiate
// must NOT go through it (the server mirrors the request host into the OAuth
// redirect_uri and the apex is unregisterable in Google). connectGmail in
// src/api/auth.jsx calls initiate on the app's own origin instead; see
// FEEDBACK.md 2026-07-23.
export const APP_ID = '6a6117b2e209abd12bdb7160';

export const base44 = createClient({
  appId: APP_ID,
  appBaseUrl: 'https://i-track-2bdb7160.base44.app',
  requiresAuth: false,
});
