import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, firebaseEnabled } from "./firebase";
import { deleteExperienceMedia } from "./cloud-media";

export type CloudExperience = {
  id: string;
  userId: string;
  farmId: string;
  farmName: string;
  farmTown?: string;
  farmNote?: string;
  startedAt: number;
  status: "active" | "completed";
  wineCount: number;
  overallRating?: number;
  note?: string;
  location?: { latitude: number; longitude: number };
  photoPath?: string;
  wines?: CloudWine[];
};

export type CloudWine = {
  id: string;
  userId: string;
  experienceId: string;
  name: string;
  note?: string;
  reaction: "Loved it" | "Liked it" | "Not for me";
  status: "draft" | "waiting_upload" | "processing" | "ready" | "error";
  error?: string;
  audioPath?: string;
  photoPath?: string;
  transcript?: string;
  summary?: string;
  suggestedIdentity?: {
    producer?: string;
    varietal?: string;
    vintage?: string;
    evidence?: string[];
    model?: string;
  };
  suggestionStatus?: "suggested" | "confirmed" | "deferred";
  retainAudio?: boolean;
  createdAt: number;
  reflections?: CloudReflection[];
};

export type CloudReflection = {
  id: string;
  userId: string;
  experienceId: string;
  wineId: string;
  type: "at_home" | "general";
  note: string;
  reaction?: CloudWine["reaction"];
  createdAt: number;
};

export type CloudEnrichmentJob = {
  id: string;
  userId: string;
  experienceId: string;
  wineId: string;
  mediaKinds: ("audio" | "photo")[];
  status: "queued" | "processing" | "ready" | "error";
  attempts: number;
  createdAt: number;
  error?: string;
};

function requireDb() {
  if (!firebaseEnabled || !db) throw new Error("Firebase is not configured for this environment.");
  return db;
}

export async function saveExperience(experience: CloudExperience) {
  const firestore = requireDb();
  const ref = doc(firestore, "users", experience.userId, "experiences", experience.id);
  await setDoc(ref, stripUndefined({ ...experience, updatedAt: serverTimestamp() }), { merge: true });
}

export async function saveWine(wine: CloudWine) {
  const firestore = requireDb();
  const ref = doc(collection(doc(firestore, "users", wine.userId, "experiences", wine.experienceId), "wines"), wine.id);
  await setDoc(ref, stripUndefined({ ...wine, updatedAt: serverTimestamp() }), { merge: true });
}

export async function saveReflection(reflection: CloudReflection) {
  const firestore = requireDb();
  const wineRef = doc(
    collection(
      doc(firestore, "users", reflection.userId, "experiences", reflection.experienceId),
      "wines",
    ),
    reflection.wineId,
  );
  const reflectionRef = doc(collection(wineRef, "reflections"), reflection.id);
  await setDoc(reflectionRef, stripUndefined({ ...reflection, updatedAt: serverTimestamp() }), { merge: true });
}

export async function saveEnrichmentJob(job: CloudEnrichmentJob) {
  const firestore = requireDb();
  const jobRef = doc(collection(doc(firestore, "users", job.userId), "processingJobs"), job.id);
  await setDoc(jobRef, stripUndefined({ ...job, updatedAt: serverTimestamp() }), { merge: true });
}

export async function retryEnrichmentJob(userId: string, experienceId: string, wineId: string) {
  const firestore = requireDb();
  const jobRef = doc(firestore, "users", userId, "processingJobs", `${experienceId}-${wineId}`);
  const jobSnapshot = await getDoc(jobRef);
  if (!jobSnapshot.exists() || jobSnapshot.data().status !== "error") {
    throw new Error("This capture is not ready to retry yet.");
  }
  const wineRef = doc(firestore, "users", userId, "experiences", experienceId, "wines", wineId);
  const wineSnapshot = await getDoc(wineRef);
  if (!wineSnapshot.exists()) throw new Error("The wine capture no longer exists.");
  const wine = wineSnapshot.data() as Pick<CloudWine, "audioPath" | "photoPath">;
  const mediaKinds = [
    ...(wine.audioPath ? ["audio" as const] : []),
    ...(wine.photoPath ? ["photo" as const] : []),
  ];
  if (!mediaKinds.length) throw new Error("No uploaded media is available to retry.");
  await deleteDoc(jobRef);
  await setDoc(jobRef, {
    id: `${experienceId}-${wineId}`,
    userId,
    experienceId,
    wineId,
    mediaKinds,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function listExperiences(userId: string) {
  const firestore = requireDb();
  const snapshot = await getDocs(query(collection(firestore, "users", userId, "experiences"), orderBy("startedAt", "desc")));
  return Promise.all(snapshot.docs.map(async (item) => {
    const winesSnapshot = await getDocs(collection(item.ref, "wines"));
    const wines = await Promise.all(winesSnapshot.docs.map(async (wine) => {
      const reflectionsSnapshot = await getDocs(collection(wine.ref, "reflections"));
      return { id: wine.id, ...wine.data(), reflections: reflectionsSnapshot.docs.map((reflection) => ({ id: reflection.id, ...reflection.data() })) } as CloudWine;
    }));
    return { id: item.id, ...item.data(), wines } as CloudExperience;
  }));
}

/**
 * Keep the journal current while background enrichment changes wine records.
 * The top-level experience document does not change when a worker enriches a
 * nested wine, so each experience gets its own wines listener.
 */
export function subscribeExperiences(
  userId: string,
  onChange: (items: CloudExperience[]) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  const firestore = requireDb();
  const experiences = new Map<string, CloudExperience>();
  const wineUnsubscribers = new Map<string, () => void>();

  function emit() {
    onChange([...experiences.values()].sort((left, right) => right.startedAt - left.startedAt));
  }

  const experienceUnsubscribe = onSnapshot(
    query(collection(firestore, "users", userId, "experiences"), orderBy("startedAt", "desc")),
    (snapshot) => {
      const currentIds = new Set(snapshot.docs.map((item) => item.id));
      for (const [experienceId, unsubscribe] of wineUnsubscribers) {
        if (!currentIds.has(experienceId)) {
          unsubscribe();
          wineUnsubscribers.delete(experienceId);
          experiences.delete(experienceId);
        }
      }

      for (const item of snapshot.docs) {
        const existing = experiences.get(item.id);
        experiences.set(item.id, { id: item.id, ...item.data(), wines: existing?.wines } as CloudExperience);
        if (wineUnsubscribers.has(item.id)) continue;

        const unsubscribe = onSnapshot(
          collection(item.ref, "wines"),
          (wineSnapshot) => {
            void Promise.all(wineSnapshot.docs.map(async (wine) => {
              const reflectionsSnapshot = await getDocs(collection(wine.ref, "reflections"));
              return {
                id: wine.id,
                ...wine.data(),
                reflections: reflectionsSnapshot.docs.map((reflection) => ({ id: reflection.id, ...reflection.data() })),
              } as CloudWine;
            }))
              .then((wines) => {
                const current = experiences.get(item.id);
                if (current) experiences.set(item.id, { ...current, wines });
                emit();
              })
              .catch(onError);
          },
          onError,
        );
        wineUnsubscribers.set(item.id, unsubscribe);
      }
      emit();
    },
    onError,
  );

  return () => {
    experienceUnsubscribe();
    for (const unsubscribe of wineUnsubscribers.values()) unsubscribe();
    wineUnsubscribers.clear();
  };
}

export async function deleteExperience(userId: string, experienceId: string) {
  const firestore = requireDb();
  const experienceRef = doc(firestore, "users", userId, "experiences", experienceId);
  // Remove Storage objects first. If this fails, keep the Firestore record so
  // the user can retry instead of leaving an apparently deleted orphan.
  await deleteExperienceMedia(userId, experienceId);
  const wines = await getDocs(collection(experienceRef, "wines"));
  const jobs = await getDocs(query(collection(firestore, "users", userId, "processingJobs"), where("experienceId", "==", experienceId)));
  const batch = writeBatch(firestore);
  for (const wine of wines.docs) {
    const reflections = await getDocs(collection(wine.ref, "reflections"));
    reflections.docs.forEach((reflection) => batch.delete(reflection.ref));
    batch.delete(wine.ref);
  }
  jobs.docs.forEach((job) => batch.delete(job.ref));
  batch.delete(experienceRef);
  await batch.commit();
}

export function toCloudStatus(status: string): CloudWine["status"] {
  const statuses: CloudWine["status"][] = ["draft", "waiting_upload", "processing", "ready", "error"];
  return statuses.includes(status as CloudWine["status"]) ? status as CloudWine["status"] : "draft";
}

export function stripUndefined(value: DocumentData) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
