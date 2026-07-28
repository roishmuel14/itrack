import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { APP_ID, base44 } from '@/api/base44Client';
import { invokeFunction } from '@/api/functions';

// Auth + first-load bootstrap. bootstrap returns the user's settings AND the
// Gmail connection state ({configured, connected, connector_id}), which is
// the single source of truth for the connect flow.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState(false);
  const [gmail, setGmail] = useState({ configured: false, connected: false, connector_id: null });
  const [status, setStatus] = useState('loading'); // loading | anonymous | authenticated

  // bootstrap always returns a settings row on success (it creates one
  // idempotently), so while authenticated: settings === null && !settingsError
  // means "in flight", and settingsError means "failed, retry available".
  const loadBootstrap = useCallback(async () => {
    setSettingsError(false);
    try {
      const boot = await invokeFunction('account/bootstrap', {});
      setSettings(boot.settings);
      setGmail(boot.gmail ?? { configured: false, connected: false, connector_id: null });
    } catch (err) {
      console.error('bootstrap failed', err);
      setSettings(null);
      setSettingsError(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    let me = null;
    try {
      me = await base44.auth.me();
    } catch {
      // Stale cached token must not lock users out of a public app.
      try {
        localStorage.removeItem('base44_access_token');
      } catch {
        // storage unavailable
      }
    }
    if (!me) {
      setUser(null);
      setSettings(null);
      setSettingsError(false);
      setStatus('anonymous');
      return;
    }
    setUser(me);
    setStatus('authenticated');
    await loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const api = useMemo(
    () => ({
      user,
      settings,
      settingsError,
      gmail,
      status,
      isAdmin: user?.role === 'admin',
      refresh,
      retryBootstrap: loadBootstrap,
      setSettings,
      connectGmail: async () => {
        if (!gmail.connector_id) throw new Error('Gmail connection is not configured yet');
        // Initiate on the app's own origin, not through the SDK client: the SDK
        // defaults serverUrl to the base44.app apex and the server mirrors the
        // request host into the OAuth redirect_uri, which Google rejects (the
        // apex is on the Public Suffix List and unregisterable). The app
        // origin's callback (live/preview/custom) IS registered on the Google
        // client. Verified 2026-07-23; see FEEDBACK.md.
        const token = localStorage.getItem('base44_access_token');
        const res = await fetch(
          `${window.location.origin}/api/apps/${APP_ID}/app-user-auth/connectors/${gmail.connector_id}/initiate`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
        );
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!data?.redirect_url) {
          throw new Error('Could not start the Google consent flow. Sign in again and retry.');
        }
        window.location.href = data.redirect_url;
      },
      disconnectGmail: async () => {
        if (!gmail.connector_id) return;
        await base44.connectors.disconnectAppUser(gmail.connector_id);
        setGmail((g) => ({ ...g, connected: false }));
      },
      loginWithGoogle: () => base44.auth.loginWithProvider('google', window.location.origin),
      loginWithPassword: (email, password) => base44.auth.loginViaEmailPassword(email, password),
      register: (params) => base44.auth.register(params),
      // SDK contract (auth.js v0.8.3): verifyOtp({ email, otpCode }) posts otp_code.
      verifyOtp: (params) => base44.auth.verifyOtp(params),
      resendOtp: (email) => base44.auth.resendOtp(email),
      resetPasswordRequest: (email) => base44.auth.resetPasswordRequest(email),
      resetPassword: (params) => base44.auth.resetPassword(params),
      logout: () => base44.auth.logout(window.location.origin),
    }),
    [user, settings, settingsError, gmail, status, refresh, loadBootstrap],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
