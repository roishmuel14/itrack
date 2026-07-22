import { Mail } from 'lucide-react';
import { useAuth } from '@/api/auth';
import CopyButton from '@/components/CopyButton';

// Stage 6 adds digest controls + account wipe; for now: the personal address.
export default function Settings() {
  const { user, aliasAddress } = useAuth();
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-extrabold tracking-tight mb-5">Settings</h1>
      <div className="bg-card rounded-2xl border card-shadow p-5 space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Signed in as</p>
          <p className="font-medium">{user?.email}</p>
        </div>
        <div>
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-primary" /> Your iTrack address
          </p>
          {aliasAddress ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <code className="text-sm bg-muted rounded-lg px-2.5 py-1.5 break-all">{aliasAddress}</code>
              <CopyButton text={aliasAddress} label="Copy" />
            </div>
          ) : (
            <div className="h-8 bg-muted rounded-lg animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
