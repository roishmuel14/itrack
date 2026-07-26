import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Image as ImageIcon, Mail } from 'lucide-react';
import { useAuth } from '@/api/auth';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { GMAIL_CONNECT_ENABLED } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Settings() {
  const { user, settings, setSettings, gmail, disconnectGmail, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoProgress, setLogoProgress] = useState(null);

  const saveDigest = async (patch) => {
    setBusy(true);
    try {
      const res = await invokeFunction('settings/update', patch);
      setSettings(res.settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.notifyError(err, 'Cannot save settings');
    } finally {
      setBusy(false);
    }
  };

  // The function is bounded per call so it cannot time out, so loop until it
  // reports nothing left. Stop on zero progress too: rows inside their recheck
  // cooldown keep `remaining` positive and would otherwise spin forever.
  const refreshLogos = async () => {
    setLogoBusy(true);
    let processed = 0;
    let updated = 0;
    try {
      for (let round = 0; round < 25; round++) {
        const res = await invokeFunction('orders/backfillImages', {});
        processed += res.processed ?? 0;
        updated += res.updated ?? 0;
        setLogoProgress({ processed, updated });
        if (!res.has_more || (res.processed ?? 0) === 0) break;
      }
      toast.success(
        updated > 0 ? `Updated ${updated} logo${updated === 1 ? '' : 's'}` : 'Logos are already up to date',
        updated > 0 ? 'Your cards should look sharper now.' : undefined,
      );
    } catch (err) {
      toast.notifyError(err, 'Cannot refresh logos');
    } finally {
      setLogoBusy(false);
      setLogoProgress(null);
    }
  };

  const doWipe = async () => {
    setBusy(true);
    try {
      await invokeFunction('account/wipe', { confirm: true });
      toast.success('All your data was deleted', 'Your account starts fresh.');
      setWipeOpen(false);
      setWipeText('');
      await refresh();
    } catch (err) {
      toast.notifyError(err, 'Cannot wipe account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-extrabold tracking-tight mb-5">Settings</h1>

      <div className="bg-card rounded-2xl border card-shadow p-5 space-y-5 mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Signed in as</p>
          <p className="font-medium">{user?.email}</p>
        </div>
        <div>
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-primary" /> Gmail connection
          </p>
          {!GMAIL_CONNECT_ENABLED ? (
            <p className="text-sm text-muted-foreground">
              Automatic read-only Gmail sync is coming soon. For now, add orders from the dashboard by
              pasting an order email or a tracking number.
            </p>
          ) : gmail.connected ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--status-delivered))] font-medium">
                <CheckCircle2 className="w-4 h-4" /> Connected (read-only)
              </p>
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={async () => {
                  try {
                    await disconnectGmail();
                    toast.success('Gmail disconnected');
                  } catch (err) {
                    toast.notifyError(err, 'Cannot disconnect');
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">Not connected.</p>
              <Link to="/onboarding" className="text-sm text-primary font-medium">
                Connect your Gmail
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl border card-shadow p-5 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-sm">Merchant logos</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fetches each store's own icon at full resolution for orders that have no logo or a blurry one.
            </p>
          </div>
          <Button variant="outline" onClick={refreshLogos} disabled={logoBusy}>
            <ImageIcon className="w-4 h-4 me-1.5" />
            {logoBusy
              ? `Refreshing${logoProgress ? ` (${logoProgress.updated}/${logoProgress.processed})` : ''}...`
              : 'Refresh logos'}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border card-shadow p-5 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">Daily email digest</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Arriving today, newly overdue, and refund deadlines. Skipped when there is nothing to say.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!!settings?.digest_enabled}
            disabled={busy || !settings}
            onClick={() => saveDigest({ digest_enabled: !settings.digest_enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${settings?.digest_enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white card-shadow transition-all ${settings?.digest_enabled ? 'start-[22px]' : 'start-0.5'}`}
            />
          </button>
        </div>
        {settings?.digest_enabled && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t">
            <label htmlFor="digest-hour" className="text-sm text-muted-foreground">
              Send around (UTC hour)
            </label>
            <select
              id="digest-hour"
              value={settings.digest_hour_utc ?? 7}
              disabled={busy}
              onChange={(e) => saveDigest({ digest_hour_utc: Number(e.target.value) })}
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
            >
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="bg-card rounded-2xl border border-[hsl(var(--status-overdue))]/30 card-shadow p-5">
        <p className="font-semibold text-sm flex items-center gap-1.5 text-[hsl(var(--status-overdue))]">
          <AlertTriangle className="w-4 h-4" /> Danger zone
        </p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Delete every order, shipment, event, email record, and refund iTrack holds for your account. This cannot be undone.
        </p>
        {!wipeOpen ? (
          <Button variant="outline" className="border-[hsl(var(--status-overdue))]/40 text-[hsl(var(--status-overdue))] hover:bg-[hsl(var(--status-overdue-bg))]" onClick={() => setWipeOpen(true)}>
            Delete all my data
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Type <span className="font-mono font-bold">DELETE</span> to confirm:
            </p>
            <Input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder="DELETE" className="max-w-40" />
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                disabled={busy || wipeText !== 'DELETE'}
                onClick={doWipe}
              >
                {busy ? 'Deleting...' : 'Permanently delete'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => { setWipeOpen(false); setWipeText(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
