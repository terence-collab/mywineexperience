import { trackEvent } from "./telemetry";

export type QueuedMedia = {
  id: string;
  userId?: string;
  experienceId: string;
  wineId: string;
  kind: "audio" | "photo";
  retainAudio?: boolean;
  blob: Blob;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

const databaseName = "my-wine-experience";
const storeName = "media-queue";

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueMedia(item: Omit<QueuedMedia, "createdAt" | "attempts">) {
  if (typeof indexedDB === "undefined") return;
  const database = await openQueue();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put({ ...item, createdAt: Date.now(), attempts: 0 });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
  trackEvent("media_queued", { kind: item.kind, online: typeof navigator !== "undefined" && navigator.onLine });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("media-queue-changed"));
}

export async function listQueuedMedia() {
  if (typeof indexedDB === "undefined") return [] as QueuedMedia[];
  const database = await openQueue();
  return new Promise<QueuedMedia[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result as QueuedMedia[]); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function removeQueuedMedia(id: string) {
  if (typeof indexedDB === "undefined") return;
  const database = await openQueue();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("media-queue-changed"));
}

export async function removeQueuedMediaForExperience(experienceId: string) {
  const items = (await listQueuedMedia()).filter((item) => item.experienceId === experienceId);
  await Promise.all(items.map((item) => removeQueuedMedia(item.id)));
  return items.length;
}

export async function claimUnassignedMedia(userId: string) {
  if (typeof indexedDB === "undefined") return 0;
  const database = await openQueue();
  const items = await new Promise<QueuedMedia[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as QueuedMedia[]).filter((item) => !item.userId));
    request.onerror = () => reject(request.error);
  });
  await Promise.all(items.map((item) => new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put({ ...item, userId });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  })));
  database.close();
  if (items.length && typeof window !== "undefined") window.dispatchEvent(new Event("media-queue-changed"));
  return items.length;
}

async function markQueueFailure(item: QueuedMedia, error: unknown) {
  if (typeof indexedDB === "undefined") return;
  const database = await openQueue();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put({
      ...item,
      attempts: item.attempts + 1,
      lastError: error instanceof Error ? error.message : "Upload failed",
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("media-queue-changed"));
}

export async function flushQueuedMedia(upload: (item: QueuedMedia) => Promise<void>, shouldUpload: (item: QueuedMedia) => boolean = () => true) {
  const items = (await listQueuedMedia()).filter(shouldUpload);
  let uploaded = 0;
  for (const item of items) {
    try {
      await upload(item);
      await removeQueuedMedia(item.id);
      trackEvent("media_upload_completed", { kind: item.kind, attempts: item.attempts + 1 });
      uploaded += 1;
    } catch (error) {
      await markQueueFailure(item, error);
      trackEvent("media_upload_failed", { kind: item.kind, attempts: item.attempts + 1 });
    }
  }
  if (uploaded > 0) trackEvent("offline_sync_recovered", { count: uploaded });
  return { attempted: items.length, uploaded };
}
