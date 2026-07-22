import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/api/functions';

// Auth + first-load bootstrap (PRD F8): on the first authenticated load,
// account/bootstrap idempotently creates UserSettings with the personal
// alias and returns it.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | anonymous | authenticated

  const refresh = useCallback(async () => {
    setStatus('loading');
    let me = null;
    try {
      me = await base44.auth.me();
    } catch {
      // Stale cached token must not lock users out of a public app:
      // clear and continue anonymously.
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
      status,
      isAdmin: user?.role === 'admin',
      aliasAddress: settings ? aliasAddressFor(settings.alias_token) : null,
      refresh,
      setSettings,
      loginWithGoogle: () => base44.auth.loginWithProvider('google', window.location.origin),
      loginWithPassword: (email, password) => base44.auth.loginViaEmailPassword(email, password),
      register: (params) => base44.auth.register(params),
      verifyOtp: (params) => base44.auth.verifyOtp(params),
      logout: () => base44.auth.logout(window.location.origin),
    }),
    [user, settings, status, refresh],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

// The shared inbox base address. TODO stage 2: replace the placeholder with
// the real iTrack Gmail account once created (single source: this constant).
export const INBOX_BASE = 'itrackapp44@gmail.com';

export function aliasAddressFor(token) {
  if (!token) return null;
  const [local, domain] = INBOX_BASE.split('@');
  return `${local}+${token}@${domain}`;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
