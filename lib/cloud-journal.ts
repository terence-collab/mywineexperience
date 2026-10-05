import {
  collection,
  doc,
  getDocs,
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
  reaction: "Loved it" | "Liked it" | "Not for me";
  status: "draft" | "waiting_upload" | "processing" | "ready" | "error";
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
  await setDoc(ref, { ...experience, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveWine(wine: CloudWine) {
  const firestore = requireDb();
  const ref = doc(collection(doc(firestore, "users", wine.userId, "experiences", wine.experienceId), "wines"), wine.id);
  await setDoc(ref, { ...wine, updatedAt: serverTimestamp() }, { merge: true });
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
  await setDoc(reflectionRef, { ...reflection, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveEnrichmentJob(job: CloudEnrichmentJob) {
  const firestore = requireDb();
  const jobRef = doc(collection(doc(firestore, "users", job.userId), "processingJobs"), job.id);
  await setDoc(jobRef, { ...job, updatedAt: serverTimestamp() }, { merge: true });
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

export async function deleteExperience(userId: string, experienceId: string) {
  const firestore = requireDb();
  const experienceRef = doc(firestore, "users", userId, "experiences", experienceId);
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
  await deleteExperienceMedia(userId, experienceId);
}

export function toCloudStatus(status: string): CloudWine["status"] {
  const statuses: CloudWine["status"][] = ["draft", "waiting_upload", "processing", "ready", "error"];
  return statuses.includes(status as CloudWine["status"]) ? status as CloudWine["status"] : "draft";
}

export function stripUndefined(value: DocumentData) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
