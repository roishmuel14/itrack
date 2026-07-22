import { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuth } from '@/api/auth';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Built-in Base44 auth with minimal branding (PRD section 10.1):
// email/password login, registration with OTP verification, Google OAuth.
export default function Login() {
  const { loginWithPassword, loginWithGoogle, register, verifyOtp, refresh } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState('login'); // login | register | otp
  const [form, setForm] = useState({ email: '', password: '', full_name: '', otp: '' });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        await loginWithPassword(form.email.trim(), form.password);
        await refresh();
      } else if (mode === 'register') {
        await register({ email: form.email.trim(), password: form.password, full_name: form.full_name.trim() });
        toast.info('Check your email', 'We sent you a verification code.');
        setMode('otp');
      } else {
        await verifyOtp({ email: form.email.trim(), otp: form.otp.trim() });
        await loginWithPassword(form.email.trim(), form.password);
        await refresh();
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || err?.message || 'Check your details and try again';
      toast.error(mode === 'login' ? 'Could not sign in' : 'Could not register', String(msg));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary grid place-items-center card-shadow mb-3">
            <Package className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">iTrack</h1>
          <p className="text-muted-foreground text-sm mt-1 text-center">
            Every package you're waiting for, in one place.
          </p>
        </div>

        <div className="bg-card rounded-2xl card-shadow border p-6">
          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <Input required placeholder="Your name" value={form.full_name} onChange={set('full_name')} autoComplete="name" />
            )}
            {mode !== 'otp' && (
              <>
                <Input required type="email" placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" />
                <Input
                  required
                  type="password"
                  placeholder="Password"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={8}
                />
              </>
            )}
            {mode === 'otp' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code we emailed to <span className="font-medium text-foreground">{form.email}</span>.
                </p>
                <Input required inputMode="numeric" placeholder="Verification code" value={form.otp} onChange={set('otp')} />
              </>
            )}
            <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90">
              {busy ? 'One moment...' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Verify'}
            </Button>
          </form>

          {mode !== 'otp' && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px bg-border flex-1" />
              </div>
              <Button type="button" variant="outline" className="w-full h-11 rounded-xl" onClick={loginWithGoogle}>
                Continue with Google
              </Button>
            </>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button className="text-primary font-medium" onClick={() => setMode('register')}>
                Create an account
              </button>
            </>
          ) : (
            <button className="text-primary font-medium" onClick={() => setMode('login')}>
              Back to sign in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
