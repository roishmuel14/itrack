import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, Mail, Search, Sparkles, Wand2 } from 'lucide-react';
import { useAuth } from '@/api/auth';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import CopyButton from '@/components/CopyButton';

// Onboarding (PRD F8): the personal address, the "watch it work" moment, and
// the optional Gmail auto-forward setup with the confirmation-code assist.
export default function Onboarding() {
  const { aliasAddress, settings, setSettings } = useAuth();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const checkConfirmation = async () => {
    setChecking(true);
    try {
      const res = await invokeFunction('inbox/confirmForwarding', {});
      if (res.found) {
        setConfirmation(res);
        setSettings((s) => (s ? { ...s, forwarding_confirmed: true } : s));
        toast.success('Confirmation found!', res.code ? `Your code: ${res.code}` : 'Use the link below to finish.');
      } else {
        toast.info('Not there yet', "Google's confirmation email hasn't arrived. Create the filter first, then check again.");
      }
    } catch (err) {
      toast.notifyError(err, 'Cannot check forwarding');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>
      <h1 className="text-2xl font-extrabold tracking-tight mb-1">Connect your inbox</h1>
      <p className="text-muted-foreground mb-6">Two ways in: forward emails yourself, or set up a one-time Gmail filter that does it forever.</p>

      <div className="bg-card rounded-2xl border card-shadow p-6 mb-4">
        <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Mail className="w-4 h-4 text-primary" /> Your personal iTrack address
        </p>
        {aliasAddress ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <code className="text-base bg-muted rounded-lg px-3 py-2 break-all">{aliasAddress}</code>
            <CopyButton text={aliasAddress} label="Copy" />
          </div>
        ) : (
          <div className="h-10 bg-muted rounded-lg animate-pulse" />
        )}
        <div className="flex items-start gap-2 mt-4 text-sm text-muted-foreground">
          <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p>
            <span className="font-medium text-foreground">Try it now:</span> forward any order confirmation from your
            inbox to this address, then open the dashboard and watch the card appear on its own.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-2xl border card-shadow p-6">
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <Wand2 className="w-4 h-4 text-primary" /> Automatic forwarding (Gmail, ~2 minutes)
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          A Gmail filter forwards future order emails for you. Google will ask to verify the destination; iTrack
          catches the verification for you in step 3.
        </p>
        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0">1</span>
            <div>
              <p className="font-medium">Add your iTrack address as a forwarding address</p>
              <p className="text-muted-foreground mt-0.5">
                Gmail: Settings, then <span className="font-medium">Forwarding and POP/IMAP</span>, then{' '}
                <span className="font-medium">Add a forwarding address</span>. Paste the address above.{' '}
                <a
                  href="https://mail.google.com/mail/u/0/#settings/fwdandpop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-medium inline-flex items-center gap-0.5"
                >
                  Open Gmail settings <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0">2</span>
            <div>
              <p className="font-medium">Google sends a confirmation to iTrack</p>
              <p className="text-muted-foreground mt-0.5">You cannot see that inbox, but we can. Click the button below and we'll fetch your code.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0">3</span>
            <div className="flex-1">
              <p className="font-medium mb-2">Fetch the confirmation</p>
              {settings?.forwarding_confirmed && !confirmation ? (
                <p className="inline-flex items-center gap-1.5 text-[hsl(var(--status-delivered))] font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Forwarding already confirmed
                </p>
              ) : confirmation ? (
                <div className="bg-muted rounded-xl p-4">
                  {confirmation.code && (
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Paste this code back in Gmail:</p>
                        <p className="text-xl font-bold font-mono tracking-wider">{confirmation.code}</p>
                      </div>
                      <CopyButton text={confirmation.code} label="Copy code" />
                    </div>
                  )}
                  {confirmation.link && (
                    <a
                      href={confirmation.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary font-medium inline-flex items-center gap-1"
                    >
                      Or confirm with one click <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <Button onClick={checkConfirmation} disabled={checking} variant="outline">
                  <Search className="w-4 h-4 me-1.5" />
                  {checking ? 'Checking the iTrack inbox...' : 'Find my confirmation code'}
                </Button>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0">4</span>
            <div>
              <p className="font-medium">Create the filter</p>
              <p className="text-muted-foreground mt-0.5">
                In Gmail search, click <span className="font-medium">Show search options</span>, set{' '}
                <span className="font-medium">From</span> to your favorite stores (e.g.{' '}
                <code className="text-xs bg-muted rounded px-1 py-0.5">amazon.com OR temu.com</code>) or Subject to{' '}
                <code className="text-xs bg-muted rounded px-1 py-0.5">order OR shipped</code>, then{' '}
                <span className="font-medium">Create filter</span> and choose <span className="font-medium">Forward it to</span> your iTrack address.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
