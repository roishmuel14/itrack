import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/api/functions';

// Auth + first-load bootstrap. bootstrap returns the user's settings AND the
// Gmail connection state ({configured, connected, connector_id}), which is
// the single source of truth for the connect flow.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [gmail, setGmail] = useState({ configured: false, connected: false, connector_id: null });
  const [status, setStatus] = useState('loading'); // loading | anonymous | authenticated

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
      setStatus('anonymous');
      return;
    }
    setUser(me);
    setStatus('authenticated');
    try {
      const boot = await invokeFunction('account/bootstrap', {});
      setSettings(boot.settings);
      setGmail(boot.gmail ?? { configured: false, connected: false, connector_id: null });
    } catch (err) {
      console.error('bootstrap failed', err);
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const api = useMemo(
    () => ({
      user,
      settings,
      gmail,
      status,
      isAdmin: user?.role === 'admin',
      refresh,
      setSettings,
      connectGmail: async () => {
        if (!gmail.connector_id) throw new Error('Gmail connection is not configured yet');
        const redirectUrl = await base44.connectors.connectAppUser(gmail.connector_id);
        window.location.href = redirectUrl;
      },
      disconnectGmail: async () => {
        if (!gmail.connector_id) return;
        await base44.connectors.disconnectAppUser(gmail.connector_id);
        setGmail((g) => ({ ...g, connected: false }));
      },
      loginWithGoogle: () => base44.auth.loginWithProvider('google', window.location.origin),
      loginWithPassword: (email, password) => base44.auth.loginViaEmailPassword(email, password),
      register: (params) => base44.auth.register(params),
      verifyOtp: (params) => base44.auth.verifyOtp(params),
      logout: () => base44.auth.logout(window.location.origin),
    }),
    [user, settings, gmail, status, refresh],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
