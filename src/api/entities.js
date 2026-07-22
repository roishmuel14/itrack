import { base44 } from '@/api/base44Client';

// Frontend SDK is READ + subscribe only (hard rule 3): every write goes
// through a backend function via invokeFunction.
export const Order = base44.entities.Order;
export const Shipment = base44.entities.Shipment;
export const TrackingEvent = base44.entities.TrackingEvent;
export const EmailRecord = base44.entities.EmailRecord;
export const RefundOpportunity = base44.entities.RefundOpportunity;
export const RefundPolicy = base44.entities.RefundPolicy;
export const UserSettings = base44.entities.UserSettings;

// Subscription helper with cleanup; callback gets {type, data, id, timestamp}.
export function subscribeTo(entity, callback) {
  try {
    const unsubscribe = entity.subscribe(callback);
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // socket already closed
      }
    };
  } catch {
    return () => {};
  }
}
