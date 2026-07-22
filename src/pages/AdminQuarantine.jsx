import { useCallback, useEffect, useState } from 'react';
import { Inbox, Trash2, UserCheck } from 'lucide-react';
import { EmailRecord } from '@/api/entities';
import { invokeFunction } from '@/api/functions';
import { useAuth } from '@/api/auth';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';

// Admin-only quarantine (PRD 10.7): unroutable emails, assign or delete.
export default function AdminQuarantine() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [records, setRecords] = useState(null);
  const [assignTo, setAssignTo] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await EmailRecord.filter({ parse_status: 'unroutable' }, '-received_at', 200);
      setRecords(rows);
    } catch (err) {
      console.error(err);
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground">This screen is for admins only.</p>
      </div>
    );
  }

  const act = async (record, payload, verb) => {
    setBusyId(record.id);
    try {
      await invokeFunction('inbox/requeue', { email_record_id: record.id, ...payload });
      toast.success(verb === 'assign' ? 'Email assigned and reprocessed' : 'Quarantined email deleted');
      await load();
    } catch (err) {
      toast.notifyError(err, 'Cannot requeue');
    } finally {
      setBusyId(null);
    }
  };

  if (records === null) {
    return <div className="max-w-3xl mx-auto h-40 bg-muted rounded-2xl animate-pulse" aria-busy="true" />;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-extrabold tracking-tight mb-1">Quarantine</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Emails that reached the shared inbox without a matching alias. Assign them to a user (re-runs the
        pipeline) or delete them.
      </p>

      {records.length === 0 ? (
        <div className="bg-card rounded-2xl border card-shadow p-10 text-center">
          <Inbox className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-muted-foreground">Quarantine is empty. Routing is healthy.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div key={r.id} className="bg-card rounded-2xl border card-shadow p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{r.subject || '(no subject)'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From {r.from_address || 'unknown'} - {formatDateTime(r.received_at)}
                    {r.alias_token && <> - saw token <code className="bg-muted px-1 rounded">{r.alias_token}</code></>}
                  </p>
                </div>
              </div>
              {r.snippet && (
                <details className="mb-3">
                  <summary className="text-xs text-primary font-medium cursor-pointer">snippet</summary>
                  <blockquote className="text-xs text-muted-foreground bg-muted rounded-lg p-3 mt-1.5 whitespace-pre-line break-words max-h-40 overflow-y-auto">
                    {r.snippet}
                  </blockquote>
                </details>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="user@email.com"
                  value={assignTo[r.id] ?? ''}
                  onChange={(e) => setAssignTo((m) => ({ ...m, [r.id]: e.target.value }))}
                  className="max-w-56 h-9"
                  type="email"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={busyId === r.id || !(assignTo[r.id] ?? '').includes('@')}
                  onClick={() => act(r, { owner_email: assignTo[r.id] }, 'assign')}
                >
                  <UserCheck className="w-4 h-4 me-1.5" /> Assign
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-muted-foreground"
                  disabled={busyId === r.id}
                  onClick={() => act(r, { delete: true }, 'delete')}
                >
                  <Trash2 className="w-4 h-4 me-1.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
