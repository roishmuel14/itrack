import { ReceiptText } from 'lucide-react';

// Stage 6 fills this screen (open opportunities, countdowns, claim copy).
export default function Refunds() {
  return (
    <div className="text-center py-24 max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-secondary grid place-items-center mx-auto mb-5">
        <ReceiptText className="w-8 h-8 text-primary" />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight mb-2">Refund radar</h1>
      <p className="text-muted-foreground">
        When a package runs late, iTrack checks the merchant's policies and drafts your claim. Nothing to see yet.
      </p>
    </div>
  );
}
