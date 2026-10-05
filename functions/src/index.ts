import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret, defineString } from "firebase-functions/params";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

const enrichmentJobSecret = defineSecret("ENRICHMENT_JOB_SECRET");
const enrichmentEndpointUrl = defineString("ENRICHMENT_ENDPOINT_URL");
const maxAttempts = 3;

if (!getApps().length) initializeApp();

type Job = {
  userId: string;
  experienceId: string;
  wineId: string;
  mediaKinds?: Array<"audio" | "photo">;
  attempts?: number;
  status?: "queued" | "processing" | "ready" | "error";
};

type Wine = {
  name?: string;
  confirmedName?: string;
  suggestionStatus?: "suggested" | "confirmed" | "deferred";
  audioPath?: string;
  photoPath?: string;
  retainAudio?: boolean;
};

type Extraction = {
  transcript?: string;
  name?: string;
  producer?: string;
  varietal?: string;
  vintage?: string;
  region?: string;
  descriptors?: string[];
  winemakingDetails?: string[];
  foodPairings?: string[];
  summary?: string;
  evidence?: string[];
  evidenceSources?: string[];
};

const extractionVersion = "wine-extraction-v1";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Enrichment failed.";
}

function winePath(userId: string, experienceId: string, wineId: string) {
  return `users/${userId}/experiences/${experienceId}/wines/${wineId}`;
}

function assertOwnedPath(path: string | undefined, userId: string) {
  if (!path || !path.startsWith(`users/${userId}/experiences/`)) {
    throw new Error("Media path is not owned by the processing user.");
  }
  return path;
}

async function readMedia(path: string, kind: "audio" | "photo", bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>) {
  const file = bucket.file(path);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  const mimeType = metadata.contentType || (kind === "audio" ? "audio/mp4" : "image/jpeg");
  return { data: buffer.toString("base64"), mimeType };
}

export const processEnrichmentJob = onDocumentCreated(
  {
    document: "users/{userId}/processingJobs/{jobId}",
    region: "europe-west1",
    retry: true,
    secrets: [enrichmentJobSecret],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const currentJobSnapshot = await snapshot.ref.get();
    if (!currentJobSnapshot.exists) return;
    const job = currentJobSnapshot.data() as Job;
    if (job.status === "ready" || job.status === "error") return;
    const { userId } = event.params;
    const { experienceId, wineId } = job;
    if (job.userId !== userId || job.experienceId !== experienceId || job.wineId !== wineId) {
      throw new Error("Processing job ownership metadata is inconsistent.");
    }

    const firestore = getFirestore();
    const wineRef = firestore.doc(`${winePath(userId, experienceId, wineId)}`);
    const wineSnapshot = await wineRef.get();
    if (!wineSnapshot.exists) throw new Error("Wine entry no longer exists.");
    const wine = wineSnapshot.data() as Wine;
    const experienceSnapshot = await firestore.doc(`users/${userId}/experiences/${experienceId}`).get();
    const experience = experienceSnapshot.data() as { farmName?: string; farmTown?: string; startedAt?: unknown } | undefined;
    const attempt = Number(job.attempts ?? 0) + 1;
    await snapshot.ref.set({ status: "processing", attempts: attempt, startedAt: Timestamp.now(), error: FieldValue.delete() }, { merge: true });
    await wineRef.set({ status: "processing", updatedAt: Timestamp.now() }, { merge: true });

    try {
      const bucket = getStorage().bucket();
      const media: Array<{ data: string; mimeType: string }> = [];
      const kinds = job.mediaKinds ?? [];
      if (kinds.includes("audio")) {
        const audioPath = assertOwnedPath(wine.audioPath, userId);
        media.push(await readMedia(audioPath, "audio", bucket));
      }
      if (kinds.includes("photo")) {
        const photoPath = assertOwnedPath(wine.photoPath, userId);
        media.push(await readMedia(photoPath, "photo", bucket));
      }

      const endpoint = enrichmentEndpointUrl.value();
      if (!endpoint) throw new Error("ENRICHMENT_ENDPOINT_URL is not configured.");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enrichment-job-secret": enrichmentJobSecret.value() },
        body: JSON.stringify({
          transcriptHint: wine.name,
          context: {
            farmName: experience?.farmName,
            farmTown: experience?.farmTown,
            capturedAt: typeof experience?.startedAt === "number" ? new Date(experience.startedAt).toISOString() : undefined,
          },
          media,
        }),
      });
      if (!response.ok) throw new Error(`Enrichment endpoint returned ${response.status}.`);
      const payload = await response.json() as { extraction?: Extraction; model?: string; extractionVersion?: string };
      const extraction = payload.extraction;
      if (!extraction) throw new Error("Enrichment endpoint returned no extraction.");

      const update: Record<string, unknown> = {
        status: "ready",
        transcript: extraction.transcript || "",
        summary: extraction.summary || "",
        name: wine.confirmedName || (wine.suggestionStatus === "confirmed" ? wine.name : extraction.name) || wine.name || "Untitled wine",
        suggestedIdentity: {
          name: extraction.name || "",
          producer: extraction.producer || "",
          varietal: extraction.varietal || "",
          vintage: extraction.vintage || "",
          region: extraction.region || "",
          descriptors: extraction.descriptors ?? [],
          winemakingDetails: extraction.winemakingDetails ?? [],
          foodPairings: extraction.foodPairings ?? [],
          evidence: extraction.evidence ?? [],
          evidenceSources: extraction.evidenceSources ?? [],
          model: payload.model ?? "unknown",
          extractionVersion: payload.extractionVersion ?? extractionVersion,
          processedAt: Timestamp.now(),
        },
        suggestionStatus: wine.suggestionStatus === "confirmed" ? "confirmed" : "suggested",
        updatedAt: Timestamp.now(),
      };
      if (!wine.retainAudio && wine.audioPath && kinds.includes("audio")) {
        const audioPath = assertOwnedPath(wine.audioPath, userId);
        await bucket.file(audioPath).delete({ ignoreNotFound: true });
        update.audioPath = FieldValue.delete();
      }
      await wineRef.set(update, { merge: true });
      await snapshot.ref.set({ status: "ready", completedAt: Timestamp.now(), error: FieldValue.delete() }, { merge: true });
    } catch (error) {
      const message = errorMessage(error);
      const terminal = attempt >= maxAttempts;
      await wineRef.set({ status: terminal ? "error" : "waiting_upload", error: message, updatedAt: Timestamp.now() }, { merge: true });
      await snapshot.ref.set({ status: terminal ? "error" : "queued", error: message, updatedAt: Timestamp.now() }, { merge: true });
      if (!terminal) throw error;
    }
  },
);
