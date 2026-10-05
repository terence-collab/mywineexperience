export type ProductEvent =
  | "experience_started"
  | "experience_completed"
  | "wine_saved"
  | "media_queued"
  | "media_upload_completed"
  | "media_upload_failed"
  | "suggestion_reviewed"
  | "offline_sync_recovered";

const allowedEvents = new Set<ProductEvent>([
  "experience_started",
  "experience_completed",
  "wine_saved",
  "media_queued",
  "media_upload_completed",
  "media_upload_failed",
  "suggestion_reviewed",
  "offline_sync_recovered",
]);

type SafeValue = string | number | boolean;
type SafeDetails = Record<string, SafeValue>;

function safeDetails(details: SafeDetails | undefined) {
  if (!details) return undefined;
  const allowedKeys = new Set(["kind", "count", "attempts", "online", "rating", "wineCount", "status"]);
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => allowedKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")));
}

export function trackEvent(event: ProductEvent, details?: SafeDetails) {
  if (typeof window === "undefined" || !allowedEvents.has(event)) return;
  const body = JSON.stringify({ event, details: safeDetails(details) });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Observability must never interrupt capture.
  }
}
