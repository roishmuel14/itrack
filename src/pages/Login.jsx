import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { useAuth } from '@/api/auth';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Built-in Base44 auth with minimal branding (PRD section 10.1):
// email/password login, registration with OTP verification, Google OAuth,
// password reset (request + token form) and OTP resend with cooldown.
// SDK contract (auth.js v0.8.3): verifyOtp({ email, otpCode }),
// resendOtp(email), resetPasswordRequest(email),
// resetPassword({ resetToken, newPassword }).

const ERROR_TITLES = {
  login: 'Could not sign in',
  register: 'Could not register',
  otp: 'Could not verify',
  reset_request: 'Could not send the reset email',
  reset: 'Could not reset password',
};

// Server reasons become the toast body (same chokepoint idea as lib/toast's
// notifyError, but auth endpoints answer with {message|detail}, not reasons[]).
function authErrorMessage(err) {
  const data = err?.response?.data;
  let msg = data?.message || data?.detail || err?.message || 'Check your details and try again';
  if (Array.isArray(msg)) msg = msg.map((m) => m?.msg || String(m)).join('\n');
  return String(msg);
}

const RESEND_COOLDOWN_S = 30;

export default function Login() {
  const {
    loginWithPassword,
    loginWithGoogle,
    register,
    verifyOtp,
    resendOtp,
    resetPasswordRequest,
    resetPassword,
    refresh,
  } = useAuth();
  const toast = useToast();
  // login | register | otp | reset_request | reset
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', otp: '', resetToken: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // A reset email may land the user back here with the token in the URL.
  // Support both ?reset_token= and ?token=, then clean the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token') || params.get('token');
    if (!token) return;
    setForm((f) => ({ ...f, resetToken: token }));
    setMode('reset');
    params.delete('reset_token');
    params.delete('token');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => toast.error(ERROR_TITLES[mode] ?? 'Something went wrong', authErrorMessage(err));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const email = form.email.trim();
    try {
      if (mode === 'login') {
        try {
          await loginWithPassword(email, form.password);
        } catch (err) {
          // Unverified accounts dead-end here otherwise: route them to the
          // OTP screen, where they can enter or resend a code.
          if (/verif/i.test(authErrorMessage(err))) {
            setMode('otp');
            toast.info('Verify your email first', 'Enter the code we emailed you, or resend a fresh one.');
            return;
          }
          throw err;
        }
        await refresh();
      } else if (mode === 'register') {
        await register({ email, password: form.password, full_name: form.full_name.trim() });
        toast.info('Check your email', 'We sent you a verification code.');
        setMode('otp');
        setCooldown(RESEND_COOLDOWN_S); // a fresh code was just sent
      } else if (mode === 'otp') {
        await verifyOtp({ email, otpCode: form.otp.trim() });
        try {
          await loginWithPassword(email, form.password);
        } catch {
          // Verified, but the password on file does not match what they
          // typed: send them back to sign in (or on to reset) instead of
          // looping on the code screen.
          setMode('login');
          toast.info('Email verified', 'Now sign in with your password.');
          return;
        }
        await refresh();
      } else if (mode === 'reset_request') {
        await resetPasswordRequest(email);
        toast.info('Check your email', `If an account exists for ${email}, a password reset email is on its way.`);
        setMode('reset');
      } else if (mode === 'reset') {
        await resetPassword({ resetToken: form.resetToken.trim(), newPassword: form.newPassword });
        toast.success('Password updated', 'Sign in with your new password.');
        setForm((f) => ({ ...f, password: '', newPassword: '', resetToken: '' }));
        setMode('login');
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || cooldown > 0) return;
    setCooldown(RESEND_COOLDOWN_S);
    try {
      await resendOtp(form.email.trim());
      toast.success('New code sent', 'Only the newest code works. Older codes are no longer valid.');
    } catch (err) {
      toast.error('Could not resend the code', authErrorMessage(err));
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
            {(mode === 'login' || mode === 'register' || mode === 'reset_request') && (
              <>
                {mode === 'reset_request' && (
                  <p className="text-sm text-muted-foreground">
                    Enter your account email and we will send you a password reset email.
                  </p>
                )}
                <Input required type="email" placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" />
              </>
            )}
            {(mode === 'login' || mode === 'register') && (
              <Input
                required
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={set('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
              />
            )}
            {mode === 'login' && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  className="text-sm text-primary font-medium"
                  onClick={() => setMode('reset_request')}
                >
                  Forgot password?
                </button>
              </div>
            )}
            {mode === 'otp' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code we emailed to <span className="font-medium text-foreground">{form.email}</span>.
                </p>
                <Input
                  required
                  inputMode="numeric"
                  placeholder="Verification code"
                  value={form.otp}
                  onChange={set('otp')}
                  autoComplete="one-time-code"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Only the newest code works.</p>
                  <button
                    type="button"
                    className="text-sm text-primary font-medium disabled:opacity-50 shrink-0"
                    onClick={resend}
                    disabled={busy || cooldown > 0}
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>
              </>
            )}
            {mode === 'reset' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Check your inbox for the reset email. Use the link in it, or paste the reset code below, then choose a
                  new password.
                </p>
                <Input
                  required
                  placeholder="Reset code from the email"
                  value={form.resetToken}
                  onChange={set('resetToken')}
                  autoComplete="one-time-code"
                />
                <Input
                  required
                  type="password"
                  placeholder="New password"
                  value={form.newPassword}
                  onChange={set('newPassword')}
                  autoComplete="new-password"
                  minLength={8}
                />
              </>
            )}
            <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90">
              {busy
                ? 'One moment...'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : mode === 'otp'
                      ? 'Verify'
                      : mode === 'reset_request'
                        ? 'Send reset email'
                        : 'Reset password'}
            </Button>
          </form>

          {(mode === 'login' || mode === 'register') && (
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
