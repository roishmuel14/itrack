import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardPaste, Loader2, Lock, Mail, Sparkles } from 'lucide-react';
import { useAuth } from '@/api/auth';
import { useGmailSync } from '@/api/useGmailSync';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import ManualAddDialog from '@/components/ManualAddDialog';

// Onboarding. Manual add is the primary path; the Gmail card offers per-user
// read-only OAuth connect plus the first inbox scan.
export default function Onboarding() {
  const { gmail, connectGmail } = useAuth();
  const { sync, syncing, progress } = useGmailSync();
  const toast = useToast();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);

  const startConnect = async () => {
    setConnectBusy(true);
    try {
      await connectGmail();
    } catch (err) {
      toast.error('Cannot connect Gmail', err?.message ?? 'Try again in a moment.');
      setConnectBusy(false);
    }
  };

  const runFirstSync = async () => {
    const res = await sync();
    if (res.ok) {
      toast.success('Inbox scanned', `${res.processed} order emails imported.`);
      navigate('/');
    } else if (res.notConnected) {
      toast.error('Gmail not connected yet', 'Finish the Google consent step first.');
    } else {
      toast.notifyError(res.error, 'Sync failed');
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>
      <h1 className="text-2xl font-extrabold tracking-tight mb-1">Add your orders</h1>
      <p className="text-muted-foreground mb-6">
        Paste any order or shipping email and iTrack turns it into a live tracking card. Same parser,
        whether it comes from your inbox or your clipboard.
      </p>

      <div className="bg-card rounded-2xl border card-shadow p-6 mb-4">
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <ClipboardPaste className="w-4 h-4 text-primary" /> Paste an order email
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Copy the full text of an order confirmation or shipping notice and drop it in. iTrack reads
          the merchant, items, dates, and tracking automatically. You can also add a bare tracking
          number and store.
        </p>
        <Button onClick={() => setAddOpen(true)} className="h-11">
          <Sparkles className="w-4 h-4 me-1.5" /> Add an order
        </Button>
      </div>

      <div className="bg-card rounded-2xl border card-shadow p-6">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-primary" /> Your Gmail, read-only
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            One click, Google's official consent screen, read-only access. iTrack never sends mail,
            never stores full emails, and you can disconnect anytime in Settings.
          </p>
          {gmail.connected ? (
            <div className="space-y-4">
              <p className="inline-flex items-center gap-1.5 text-[hsl(var(--status-delivered))] font-medium text-sm">
                <CheckCircle2 className="w-4 h-4" /> Gmail connected
              </p>
              {syncing ? (
                <div className="flex items-center gap-3 bg-muted rounded-xl p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <div className="text-sm">
                    <p className="font-medium">Scanning your inbox...</p>
                    <p className="text-muted-foreground">{progress?.processed ?? 0} order emails imported so far</p>
                  </div>
                </div>
              ) : (
                <Button onClick={runFirstSync}>
                  <Sparkles className="w-4 h-4 me-1.5" /> Scan my inbox now
                </Button>
              )}
            </div>
          ) : (
            <Button onClick={startConnect} disabled={connectBusy} className="h-11">
              {connectBusy ? 'Opening Google...' : 'Connect Gmail'}
            </Button>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground mt-4">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Scope: gmail.readonly. We scan for order-related mail from the last 60 days, then keep an
            eye out for new updates every time you open iTrack.
          </p>
      </div>

      <ManualAddDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => navigate('/')} />
    </div>
  );
}
