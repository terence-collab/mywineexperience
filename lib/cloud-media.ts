import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from "firebase/storage";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db, storage } from "./firebase";
import { flushQueuedMedia, listQueuedMedia, type QueuedMedia } from "./offline-queue";

async function ensureEnrichmentJob(userId: string, item: QueuedMedia) {
  if (!db || item.wineId === "experience") return;
  const queuedItems = await listQueuedMedia();
  // Do not start the worker while another capture for the same wine is still
  // queued. This avoids a race where audio uploads first, the job runs, and
  // the still-queued photo is missing from the worker's media set.
  const otherPendingMedia = queuedItems.some((queued) =>
    queued.id !== item.id &&
    queued.userId === userId &&
    queued.experienceId === item.experienceId &&
    queued.wineId === item.wineId,
  );
  if (otherPendingMedia) return;
  const jobRef = doc(db, "users", userId, "processingJobs", `${item.experienceId}-${item.wineId}`);
  if ((await getDoc(jobRef)).exists()) return;
  const wineRef = doc(db, "users", userId, "experiences", item.experienceId, "wines", item.wineId);
  const wineSnapshot = await getDoc(wineRef);
  const wine = wineSnapshot.data() as { audioPath?: string; photoPath?: string } | undefined;
  const mediaKinds = [...new Set([
    item.kind,
    ...(wine?.audioPath ? ["audio" as const] : []),
    ...(wine?.photoPath ? ["photo" as const] : []),
    ...queuedItems
      .filter((queued) => queued.userId === userId && queued.experienceId === item.experienceId && queued.wineId === item.wineId)
      .map((queued) => queued.kind),
  ])];
  await setDoc(jobRef, {
    id: `${item.experienceId}-${item.wineId}`,
    userId,
    experienceId: item.experienceId,
    wineId: item.wineId,
    mediaKinds,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function uploadQueuedMedia(userId: string) {
  const configuredStorage = storage;
  if (!configuredStorage) return { attempted: 0, uploaded: 0 };
  return flushQueuedMedia(async (item: QueuedMedia) => {
    const extension = item.kind === "audio" ? "m4a" : "jpg";
    const path = item.wineId === "experience"
      ? `users/${userId}/experiences/${item.experienceId}/photos/${item.id}.${extension}`
      : `users/${userId}/experiences/${item.experienceId}/wines/${item.wineId}/${item.kind}/${item.id}.${extension}`;
    await uploadBytes(ref(configuredStorage, path), item.blob, { contentType: item.blob.type || (item.kind === "audio" ? "audio/mp4" : "image/jpeg") });
    await getDownloadURL(ref(configuredStorage, path));
    if (db && item.wineId === "experience") {
      await setDoc(
        doc(db, "users", userId, "experiences", item.experienceId),
        { userId, photoPath: path, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } else if (db) {
      const wineRef = doc(db, "users", userId, "experiences", item.experienceId, "wines", item.wineId);
      const wineSnapshot = await getDoc(wineRef);
      if (!wineSnapshot.exists()) throw new Error("Wine draft metadata is not synced yet.");
      const wine = wineSnapshot.data() as { reaction?: string; status?: string };
      await setDoc(wineRef, {
        userId,
        experienceId: item.experienceId,
        [`${item.kind}Path`]: path,
        ...(item.kind === "audio" ? { retainAudio: Boolean(item.retainAudio) } : {}),
        status: wine.reaction ? "ready" : "draft",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await ensureEnrichmentJob(userId, item);
    }
  }, (item) => item.userId === userId);
}

export async function deleteExperienceMedia(userId: string, experienceId: string) {
  const configuredStorage = storage;
  if (!configuredStorage) return;
  const root = ref(configuredStorage, `users/${userId}/experiences/${experienceId}`);
  async function deleteTree(folder: ReturnType<typeof ref>) {
    const entries = await listAll(folder);
    await Promise.all(entries.items.map((item) => deleteObject(item)));
    await Promise.all(entries.prefixes.map((prefix) => deleteTree(prefix)));
  }
  await deleteTree(root);
}

export async function getMediaDownloadUrl(path: string) {
  if (!storage) return undefined;
  return getDownloadURL(ref(storage, path));
}
