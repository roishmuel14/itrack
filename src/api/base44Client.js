import { createClient } from '@base44/sdk';

// requiresAuth false: the app owns its login screen (public visibility).
// appBaseUrl is REQUIRED for correct auth redirects (the SDK builds
// `${appBaseUrl}/login` and the logout URL from it).
export const base44 = createClient({
  appId: '6a6117b2e209abd12bdb7160',
  appBaseUrl: 'https://i-track-2bdb7160.base44.app',
  requiresAuth: false,
});
