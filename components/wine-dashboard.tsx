"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  observeUser,
  signOutUser,
} from "../lib/auth";
import { auth, firebaseEnabled } from "../lib/firebase";
import {
  deleteExperience as deleteCloudExperience,
  retryEnrichmentJob,
  saveExperience as saveCloudExperience,
  saveReflection as saveCloudReflection,
  saveWine as saveCloudWine,
  subscribeExperiences,
  toCloudStatus,
} from "../lib/cloud-journal";
import { getMediaDownloadUrl, uploadQueuedMedia } from "../lib/cloud-media";
import { claimUnassignedMedia, enqueueMedia, listQueuedMedia, removeQueuedMedia, removeQueuedMediaForExperience } from "../lib/offline-queue";
import { trackEvent } from "../lib/telemetry";
import { GoogleMapSurface, type MapFarm } from "./google-map-surface";

type Reaction = "Loved it" | "Liked it" | "Not for me";
type Tab = "map" | "journal" | "favourites" | "profile";
type FarmFilter = "all" | "visited" | "favourites";
type WineType = "red" | "white" | "sparkling" | "rosé" | "fortified" | "dessert" | "other";
const WINE_TYPES: WineType[] = ["dessert", "fortified", "other", "red", "rosé", "sparkling", "white"];
const WINE_TYPE_LABELS: Record<WineType, string> = { red: "Red", white: "White", sparkling: "Sparkling", "rosé": "Rosé", fortified: "Fortified", dessert: "Dessert", other: "Other" };
const VARIETY_PRESETS = ["Cabernet Sauvignon", "Chardonnay", "Chenin Blanc", "Merlot", "Pinotage", "Pinot Noir", "Riesling", "Sauvignon Blanc", "Shiraz/Syrah"];
type FarmSearchResult = { id: string; name: string; town: string; province: string; source: string; location?: { latitude: number; longitude: number } };
type Wine = {
  id: number;
  name: string;
  detail: string;
  note?: string;
  rating?: number;
  wineType?: WineType;
  varietal?: string;
  captureMode?: "tasting" | "quick_add";
  reaction?: Reaction;
  status: string;
  error?: string;
  tone: string;
  photo?: boolean;
  audio?: boolean;
  audioPath?: string;
  photoPath?: string;
  transcript?: string;
  summary?: string;
  suggestedIdentity?: {
    name?: string;
    producer?: string;
    varietal?: string;
    vintage?: string;
    region?: string;
    descriptors?: string[];
    winemakingDetails?: string[];
    foodPairings?: string[];
    evidence?: string[];
    evidenceSources?: string[];
    model?: string;
    extractionVersion?: string;
    processedAt?: unknown;
  };
  confirmedName?: string;
  suggestionStatus?: "suggested" | "confirmed" | "deferred";
  reflections?: Reflection[];
};
type Farm = {
  name: string;
  town: string;
  note: string;
  top: string;
  left: string;
  visited: boolean;
  favourite?: boolean;
  location?: { latitude: number; longitude: number };
};
type ExperienceSummary = {
  id: string;
  farmName: string;
  town: string;
  startedAt: string;
  rating: number;
  wineCount: number;
  note?: string;
  location?: { latitude: number; longitude: number };
  photo?: boolean;
  photoPath?: string;
  wines?: Wine[];
  experienceType?: "farm_tasting" | "at_home";
};
type Reflection = { id: string; note: string; createdAt: string; type: "at_home" | "general"; reaction?: Reaction };

function reactionLabel(reaction?: Reaction) {
  return reaction === "Loved it" ? "Would pour again" : reaction === "Liked it" ? "Glad I tried it" : reaction ?? "";
}

function wineVarietal(wine: Wine) {
  return wine.varietal?.trim() || wine.suggestedIdentity?.varietal?.trim() || "";
}

function wineTypeLabel(type?: WineType) {
  return type ? WINE_TYPE_LABELS[type] : "";
}

function ExperiencePhotoPreview({ path, alt }: { path?: string; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!path) return;
    void getMediaDownloadUrl(path).then(setUrl).catch(() => undefined);
  }, [path]);
  return url ? <img className="experience-photo journal-card-photo" src={url} alt={alt} /> : null;
}

const farms: Farm[] = [
  {
    name: "Boschendal",
    town: "Franschhoek",
    note: "Beautiful valley setting",
    top: "24%",
    left: "57%",
    visited: false,
    favourite: false,
    location: { latitude: -33.8496, longitude: 18.9869 },
  },
  {
    name: "Babylonstoren",
    town: "Paarl",
    note: "Garden, farm and cellar",
    top: "38%",
    left: "41%",
    visited: false,
    location: { latitude: -33.8084, longitude: 18.8456 },
  },
  {
    name: "Klein Constantia",
    town: "Constantia",
    note: "Old vines, cool slopes",
    top: "64%",
    left: "66%",
    visited: false,
    location: { latitude: -34.0261, longitude: 18.4324 },
  },
  {
    name: "Jordan Wine Estate",
    town: "Stellenbosch",
    note: "Peaceful valley views",
    top: "54%",
    left: "28%",
    visited: false,
    location: { latitude: -33.889, longitude: 18.828 },
  },
];
const initialWines: Wine[] = [];

function makePersonalFarm(name: string, town: string, note = "Private place snapshot", location?: { latitude: number; longitude: number }): Farm {
  const seed = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    name,
    town,
    note,
    top: `${24 + (seed % 52)}%`,
    left: `${22 + ((seed * 7) % 58)}%`,
    visited: false,
    location,
  };
}

function migrateDeviceJournalToAccount(userId: string) {
  try {
    const deviceKey = "my-wine-experience:device";
    const accountKey = `my-wine-experience:${userId}`;
    const deviceRaw = localStorage.getItem(deviceKey);
    if (!deviceRaw) return;
    const device = JSON.parse(deviceRaw) as { experiences?: ExperienceSummary[]; [key: string]: unknown };
    const accountRaw = localStorage.getItem(accountKey);
    const account = accountRaw ? JSON.parse(accountRaw) as { experiences?: ExperienceSummary[]; [key: string]: unknown } : {};
    const accountExperiences = account.experiences ?? [];
    const accountIds = new Set(accountExperiences.map((item) => item.id));
    const mergedExperiences = [...accountExperiences, ...(device.experiences ?? []).filter((item) => !accountIds.has(item.id))];
    localStorage.setItem(accountKey, JSON.stringify({
      ...device,
      ...account,
      experiences: mergedExperiences,
      experience: account.experience || device.experience,
      activeExperienceId: account.activeExperienceId || device.activeExperienceId,
      wines: account.experience ? account.wines : device.wines,
      experienceLocation: account.experience ? account.experienceLocation : device.experienceLocation,
    }));
    localStorage.removeItem(deviceKey);
  } catch {
    /* A failed migration leaves the device journal untouched for recovery. */
  }
}

async function syncLocalExperiencesToCloud(userId: string, items: ExperienceSummary[]) {
  await Promise.all(items.map(async (experience) => {
    await saveCloudExperience({
      id: experience.id,
      userId,
      farmId: experience.farmName.toLowerCase().replaceAll(" ", "-"),
      farmName: experience.farmName,
      farmTown: experience.town,
      startedAt: Date.parse(experience.startedAt),
      status: "completed",
      experienceType: experience.experienceType,
      wineCount: experience.wineCount,
      overallRating: experience.rating,
      note: experience.note,
      location: experience.location,
      photoPath: experience.photoPath,
    });

    await Promise.all((experience.wines ?? [])
      .flatMap((wine) => [
        saveCloudWine({
          id: String(wine.id),
          userId,
          experienceId: experience.id,
          name: wine.name,
          detail: wine.detail,
          note: wine.note,
          rating: wine.rating,
          wineType: wine.wineType,
          varietal: wine.varietal,
          captureMode: wine.captureMode,
          reaction: wine.reaction,
          status: toCloudStatus(wine.status),
          audioPath: wine.audioPath,
          photoPath: wine.photoPath,
          transcript: wine.transcript,
          summary: wine.summary,
          suggestedIdentity: wine.suggestedIdentity,
          suggestionStatus: wine.suggestionStatus,
          createdAt: Date.parse(experience.startedAt),
        }),
        ...(wine.reflections ?? []).map((reflection) => saveCloudReflection({
          id: reflection.id,
          userId,
          experienceId: experience.id,
          wineId: String(wine.id),
          type: reflection.type,
          note: reflection.note,
          reaction: reflection.reaction,
          createdAt: Date.parse(reflection.createdAt),
        })),
      ]));
  }));
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    map: "M3 6l6-3 6 3 6-3v18l-6 3-6-3-6 3V6zm6-3v18m6-15v18",
    book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17zM4 19.5A2.5 2.5 0 0 1 6.5 17H20",
    heart:
      "M20.8 8.8c0 5.5-8.8 10.2-8.8 10.2S3.2 14.3 3.2 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4z",
    user: "M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    plus: "M12 5v14M5 12h14",
    search: "m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z",
    camera:
      "M4 7h3l1.5-2h7L17 7h3v12H4V7zm8 3.1a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
    mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-6-3a6 6 0 0 0 12 0m-6 6v3m-3 0h6",
    arrow: "M5 12h14m-6-6 6 6-6 6",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function CaptureSheet({
  wines,
  experienceId,
  retainAudio,
  draft,
  onClose,
  onSave,
  onSaveDraft,
  onAutoSaveDraft,
}: {
  wines: Wine[];
  experienceId: string;
  retainAudio: boolean;
  draft?: Wine;
  onClose: () => void;
  onSave: (wine: Wine) => void;
  onSaveDraft: (wine: Wine) => void;
  onAutoSaveDraft: (wine: Wine) => void;
}) {
  const [reaction, setReaction] = useState<Reaction | undefined>(draft?.reaction);
  const [name, setName] = useState(draft?.name === "New wine" ? "" : draft?.name ?? "");
  const [note, setNote] = useState(draft?.note ?? "");
  const [wineType, setWineType] = useState<WineType | undefined>(draft?.wineType);
  const [varietal, setVarietal] = useState(draft?.varietal ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(draft?.note));
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioCaptured, setAudioCaptured] = useState(Boolean(draft?.audio));
  const [photo, setPhoto] = useState<string>();
  const [photoCaptured, setPhotoCaptured] = useState(Boolean(draft?.photo));
  const [captureMessage, setCaptureMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const photoQueueId = useRef<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  // A capture can auto-save while the parent list updates. Allocate its id and
  // visual tone once so the autosave never turns one in-progress pour into a
  // new draft on every render.
  const [captureWineId] = useState(() => draft?.id ?? wines.length + 1);
  const [captureTone] = useState(() => draft?.tone ?? (wines.length % 2 ? "rose" : "gold"));
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setCaptureMessage("Microphone capture is not available in this browser. You can still save the wine manually.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream);
      recorder.current = next;
      chunks.current = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        setRecordingSeconds(0);
        setAudioCaptured(true);
        void enqueueMedia({
          id: crypto.randomUUID(),
          userId: auth?.currentUser?.uid,
          experienceId,
           wineId: String(captureWineId),
          kind: "audio",
          retainAudio,
          blob: new Blob(chunks.current, {
            type: next.mimeType || "audio/webm",
          }),
        });
      };
      next.start();
      setRecording(true);
    } catch {
      setCaptureMessage("Microphone permission was not granted. You can still save the wine manually.");
    }
  }
  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const wineId = captureWineId;
    const previousQueueId = photoQueueId.current;
    if (previousQueueId) void removeQueuedMedia(previousQueueId);
    const queueId = crypto.randomUUID();
    photoQueueId.current = queueId;
    void enqueueMedia({
      id: queueId,
      userId: auth?.currentUser?.uid,
      experienceId,
      wineId: String(wineId),
      kind: "photo",
      blob: file,
    });
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      setPhotoCaptured(true);
    };
    reader.readAsDataURL(file);
  }
  function save() {
    if (!reaction) return;
    const wineId = captureWineId;
    onSave({
      id: wineId,
      name: name.trim() || "New wine",
      note: note.trim() || undefined,
      wineType,
      varietal: varietal.trim() || undefined,
      captureMode: "tasting",
       detail: `${audioCaptured ? "Voice note" : "Quick capture"}${photo || photoCaptured ? " - Label photo" : ""}`,
      reaction,
      status: "Waiting to upload",
       tone: captureTone,
      audio: audioCaptured,
       photo: photoCaptured,
    });
  }
  function saveDraft() {
    if (!name.trim() && !audioCaptured && !photoCaptured && !reaction && !draft) {
      onClose();
      return;
    }
    onSaveDraft({
      id: captureWineId,
      name: name.trim() || "New wine",
      note: note.trim() || undefined,
      wineType,
      varietal: varietal.trim() || undefined,
      captureMode: "tasting",
      detail: `${audioCaptured ? "Voice note" : "Draft capture"}${photoCaptured ? " - Label photo" : ""}`,
      reaction,
      status: "Draft",
      tone: captureTone,
      audio: audioCaptured,
      photo: photoCaptured,
    });
  }
  useEffect(() => {
    if (!name.trim() && !audioCaptured && !photoCaptured && !reaction) return;
    onAutoSaveDraft({
      id: captureWineId,
      name: name.trim() || "New wine",
      note: note.trim() || undefined,
      wineType,
      varietal: varietal.trim() || undefined,
      captureMode: "tasting",
      detail: `${audioCaptured ? "Voice note" : "Draft capture"}${photoCaptured ? " - Label photo" : ""}`,
      reaction,
      status: "Draft",
      tone: captureTone,
      audio: audioCaptured,
      photo: photoCaptured,
    });
  }, [audioCaptured, captureTone, captureWineId, name, note, onAutoSaveDraft, photoCaptured, reaction, varietal, wineType]);
  return (
    <div className="modal-backdrop" onClick={saveDraft}>
      <div
        className="sheet capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="capture-header">
          <div>
            <p className="eyebrow">
              POUR {captureWineId} · READY WHEN YOU ARE
            </p>
            <h2 id="capture-sheet-title">
              What would you like to <em>remember?</em>
            </h2>
          </div>
          <button className="close-button" aria-label="Save draft and close capture" onClick={saveDraft}>
            x
          </button>
        </div>
        <p className="recording-reminder">Make sure people are comfortable being recorded. Your recording is kept private and used only to organise this wine.</p>
        <div className="capture-actions">
          <button
            className={`capture-action ${recording ? "recording" : ""}`}
            onClick={toggleRecording}
          >
            <span className="action-icon">
              <Icon name="mic" />
            </span>
            <span>
              <strong>
                {recording
                  ? "Stop recording"
                  : audioCaptured
                    ? "Voice note saved"
                    : "Keep a voice note"}
              </strong>
              <small>
                {recording
                  ? `Recording - ${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`
                  : audioCaptured
                    ? "Kept. We’re filling in the details."
                    : "A few words, in your own voice"}
              </small>
            </span>
            <span className="action-arrow">{recording ? "O" : "->"}</span>
          </button>
          <button
            className="capture-action"
            onClick={() => input.current?.click()}
          >
            <span className="action-icon">
              {photo ? (
                <img className="photo-thumb" src={photo} alt="Bottle preview" />
              ) : photoCaptured ? (
                <span className="photo-queued" aria-label="Label photo queued">✓</span>
              ) : (
                <Icon name="camera" />
              )}
            </span>
            <span>
              <strong>
                  {photo || photoCaptured ? "Keep label photo" : "Photograph the bottle"}
              </strong>
              <small>
                  {photo || photoCaptured ? "Retake if needed, then keep this pour" : "A label, table, or small detail"}
              </small>
            </span>
            <span className="action-arrow">-&gt;</span>
          </button>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={choosePhoto}
          />
          <label className="name-input">
            <span>NAME</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Add or confirm a wine name"
            />
          </label>
          <label className="quick-add-field">
            <span>WINE TYPE <small>OPTIONAL</small></span>
            <select value={wineType ?? ""} onChange={(event) => setWineType((event.target.value || undefined) as WineType | undefined)}>
              <option value="">Choose a type</option>
              {WINE_TYPES.map((type) => <option key={type} value={type}>{WINE_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="quick-add-field">
            <span>VARIETY <small>OPTIONAL</small></span>
            <select value={varietal} onChange={(event) => setVarietal(event.target.value)}>
              <option value="">Choose a variety</option>
              {VARIETY_PRESETS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {captureMessage && <p className="form-message" role="status">{captureMessage}</p>}
        <p className="reaction-label">How did it land?</p>
        <div className="reaction-grid">
          {(["Loved it", "Liked it", "Not for me"] as Reaction[]).map(
            (item) => (
              <button
                key={item}
                className={reaction === item ? "chosen" : ""}
                onClick={() => setReaction(item)}
              >
                {reactionLabel(item)}
              </button>
            ),
          )}
        </div>
        <button className="text-button wine-note-toggle" type="button" onClick={() => setNoteOpen((value) => !value)}>
          {noteOpen ? "Hide your note" : "Add what stayed with you"}
        </button>
        {noteOpen && <textarea className="wine-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What made it stay with you?" maxLength={2000} />}
        <button className="primary-button" disabled={!reaction} onClick={save}>
          Keep this pour <Icon name="arrow" />
        </button>
        {(audioCaptured || photoCaptured) && (
          <>
            <p className="saved-note">
              <span className="sync-dot" /> Your private media will help organise this wine.
            </p>
            <p className="retention-note">
              {retainAudio ? "Your original recording will stay in your journal." : "Original recordings may be removed after processing. You can keep them in Me."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function QuickAddSheet({ onClose, onSave }: { onClose: () => void; onSave: (value: { name: string; wineType: WineType; varietal?: string; rating?: number; photo?: File }) => void }) {
  const [name, setName] = useState("");
  const [wineType, setWineType] = useState<WineType>();
  const [varietal, setVarietal] = useState("");
  const [customVarietal, setCustomVarietal] = useState("");
  const [rating, setRating] = useState(0);
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const selectedVarietal = varietal === "Other" ? customVarietal : varietal;

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="sheet quick-add-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-add-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="capture-header">
          <div>
            <h2 id="quick-add-title">Keep a <em>bottle.</em></h2>
          </div>
          <button className="close-button" aria-label="Close quick add" onClick={onClose}>×</button>
        </div>
        <label className="name-input quick-add-name">
          <span>WINE NAME</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Chocolate Block" autoFocus />
        </label>
        <button className="capture-action quick-add-photo" onClick={() => input.current?.click()}>
          <span className="action-icon">{preview ? <img className="photo-thumb" src={preview} alt="Bottle preview" /> : <Icon name="camera" />}</span>
          <span><strong>{photo ? "Bottle photo ready" : "Photograph the bottle"}</strong><small>{photo ? "We’ll suggest missing details after sync" : "Optional — can suggest name, type and variety"}</small></span>
          <span className="action-arrow">→</span>
        </button>
        <input ref={input} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
        <label className="quick-add-field">
          <span>WINE TYPE</span>
          <select value={wineType ?? ""} onChange={(event) => setWineType((event.target.value || undefined) as WineType | undefined)}>
            <option value="">Choose a type</option>
            {WINE_TYPES.map((type) => <option key={type} value={type}>{WINE_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="quick-add-field">
          <span>VARIETY <small>OPTIONAL</small></span>
          <select value={varietal} onChange={(event) => setVarietal(event.target.value)}>
            <option value="">Choose a variety</option>
            {VARIETY_PRESETS.map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="Other">Other / custom</option>
          </select>
        </label>
        {varietal === "Other" && <label className="name-input"><span>CUSTOM VARIETY</span><input value={customVarietal} onChange={(event) => setCustomVarietal(event.target.value)} placeholder="Enter a grape variety" /></label>}
        <div className="quick-add-rating">
          <p className="reaction-label">How did it land? <small>Optional</small></p>
          <div className="star-row" aria-label="Rate wine out of 5 stars">
            {[1, 2, 3, 4, 5].map((value) => <button key={value} className={rating >= value ? "star active" : "star"} aria-label={`${value} out of 5 stars`} onClick={() => setRating(value)}>★</button>)}
          </div>
        </div>
        <button className="primary-button" disabled={!name.trim() || !wineType || (varietal === "Other" && !customVarietal.trim())} onClick={() => wineType && onSave({ name: name.trim(), wineType, varietal: selectedVarietal || undefined, rating, photo })}>Keep this bottle <Icon name="arrow" /></button>
      </div>
    </div>
  );
}

export default function WineDashboard() {
  const [tab, setTab] = useState<Tab>("map");
  const [selectedFarm, setSelectedFarm] = useState(farms[0]);
  const [personalFarms, setPersonalFarms] = useState<Farm[]>([]);
  const [startChooserOpen, setStartChooserOpen] = useState(false);
  const [fullTastingOpen, setFullTastingOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [startDateTime, setStartDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<Wine>();
  const [endOpen, setEndOpen] = useState(false);
  const [experience, setExperience] = useState(false);
  const [activeExperienceId, setActiveExperienceId] = useState("");
  const [experienceStartedAt, setExperienceStartedAt] = useState<string>();
  const [experienceLocation, setExperienceLocation] = useState<{ latitude: number; longitude: number }>();
  const [wines, setWines] = useState(initialWines);
  const [experiences, setExperiences] = useState<ExperienceSummary[]>([]);
  const experienceSummariesRef = useRef(new Map<string, ExperienceSummary>());
  const [search, setSearch] = useState("");
  const [favouriteSearch, setFavouriteSearch] = useState("");
  const [favouriteFarmFilter, setFavouriteFarmFilter] = useState("all");
  const [favouriteWineTypeFilter, setFavouriteWineTypeFilter] = useState("all");
  const [favouriteVarietyFilter, setFavouriteVarietyFilter] = useState("all");
  const [favouriteDateFilter, setFavouriteDateFilter] = useState("all");
  const [favouriteOnly, setFavouriteOnly] = useState("all");
  const [filterReferenceTime] = useState(() => Date.now());
  const [journalSearch, setJournalSearch] = useState("");
  const [journalFarmFilter, setJournalFarmFilter] = useState("all");
  const [journalRatingFilter, setJournalRatingFilter] = useState("all");
  const [journalMonthFilter, setJournalMonthFilter] = useState("all");
  const [journalReactionFilter, setJournalReactionFilter] = useState("all");
  const [journalWineTypeFilter, setJournalWineTypeFilter] = useState("all");
  const [journalVarietyFilter, setJournalVarietyFilter] = useState("all");
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const [journalFiltersOpen, setJournalFiltersOpen] = useState(false);
  const [favouriteFiltersOpen, setFavouriteFiltersOpen] = useState(false);
  const [farmFilter, setFarmFilter] = useState<FarmFilter>("all");
  const [searchResults, setSearchResults] = useState<FarmSearchResult[]>([]);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [selectedExperience, setSelectedExperience] =
    useState<ExperienceSummary>();
  const [savedExperience, setSavedExperience] = useState<ExperienceSummary>();
  const experiencePhotoInput = useRef<HTMLInputElement>(null);
  const [selectedWine, setSelectedWine] = useState<Wine>();
  const [selectedWineExperienceId, setSelectedWineExperienceId] = useState<string>();
  const [selectedWineAudioUrl, setSelectedWineAudioUrl] = useState<string>();
  const [selectedWinePhotoUrl, setSelectedWinePhotoUrl] = useState<string>();
  const [selectedExperiencePhotoUrl, setSelectedExperiencePhotoUrl] = useState<string>();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [retryError, setRetryError] = useState<string>();
  const [reflectionWineId, setReflectionWineId] = useState<number>();
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionReaction, setReflectionReaction] = useState<Reaction>();
  const [editingWineId, setEditingWineId] = useState<number>();
  const [editedWineName, setEditedWineName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [keepAudio, setKeepAudio] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [mediaQueue, setMediaQueue] = useState({ waiting: 0, failed: 0, unassigned: 0 });
  const [cloudSyncError, setCloudSyncError] = useState(false);
  const [authUserId, setAuthUserId] = useState("device");
  const syncedCloudAccounts = useRef(new Set<string>());
  const storageKey = `my-wine-experience:${authUserId}`;
  const historyFarms = useMemo(() => experiences
    .filter((experience) => !farms.some((farm) => farm.name.toLowerCase() === experience.farmName.toLowerCase()))
    .map((experience) => ({ ...makePersonalFarm(experience.farmName, experience.town), visited: true })), [experiences]);
  const allFarms = useMemo(() => {
    const candidates = [...farms, ...personalFarms, ...historyFarms];
    return candidates.filter((farm, index) => candidates.findIndex((item) => item.name.toLowerCase() === farm.name.toLowerCase()) === index);
  }, [historyFarms, personalFarms]);
  const farmHistory = useMemo(() => {
    const history = new Map<string, { visited: boolean; favourite: boolean; visits: number }>();
    for (const item of experiences) {
      const winesForFarm = item.wines ?? [];
      const current = history.get(item.farmName) ?? { visited: false, favourite: false, visits: 0 };
      history.set(item.farmName, { visited: true, favourite: current.favourite || winesForFarm.some((wine) => wine.reaction === "Loved it"), visits: current.visits + 1 });
    }
    return history;
  }, [experiences]);
  const filtered = useMemo(
    () =>
      allFarms.filter((farm) => {
        const matchesSearch = `${farm.name} ${farm.town}`.toLowerCase().includes(search.toLowerCase());
        const history = farmHistory.get(farm.name);
        const visited = farm.visited || Boolean(history?.visited);
        const favourite = farm.favourite || Boolean(history?.favourite);
        const matchesFilter = farmFilter === "all" || (farmFilter === "visited" ? visited : favourite);
        return matchesSearch && matchesFilter;
      }),
    [allFarms, farmFilter, farmHistory, search],
  );
  const wineTypes = useMemo(() => [...new Set(experiences.flatMap((item) => (item.wines ?? []).map((wine) => wine.wineType).filter(Boolean) as WineType[]))].sort(), [experiences]);
  const wineVarieties = useMemo(() => [...new Set(experiences.flatMap((item) => (item.wines ?? []).map(wineVarietal).filter(Boolean)))].sort(), [experiences]);
  const favouriteItems = useMemo(() => {
    const cutoff = favouriteDateFilter === "30" ? filterReferenceTime - 30 * 24 * 60 * 60 * 1000 : favouriteDateFilter === "365" ? filterReferenceTime - 365 * 24 * 60 * 60 * 1000 : 0;
    return experiences.flatMap((experienceItem) => (experienceItem.wines ?? []).map((wine) => ({ wine, experience: experienceItem }))).filter(({ wine, experience: experienceItem }) => {
      const varietal = wineVarietal(wine);
      const matchesSearch = [
        wine.name,
        wine.note,
        wine.detail,
        wine.transcript,
        wine.summary,
        wine.wineType,
        wine.varietal,
        wine.suggestedIdentity?.producer,
        wine.suggestedIdentity?.varietal,
        wine.suggestedIdentity?.vintage,
        experienceItem.farmName,
      ].filter(Boolean).join(" ").toLowerCase().includes(favouriteSearch.toLowerCase());
      const matchesFarm = favouriteFarmFilter === "all" || experienceItem.farmName === favouriteFarmFilter;
      const matchesWineType = favouriteWineTypeFilter === "all" || wine.wineType === favouriteWineTypeFilter;
      const matchesVariety = favouriteVarietyFilter === "all" || varietal === favouriteVarietyFilter;
      const matchesDate = !cutoff || Date.parse(experienceItem.startedAt) >= cutoff;
      const isFavourite = wine.reaction === "Loved it" || (!wine.reaction && (wine.rating ?? 0) >= 4);
      const matchesFavourite = favouriteOnly === "all" || isFavourite;
      return matchesFavourite && matchesSearch && matchesFarm && matchesWineType && matchesVariety && matchesDate;
    });
  }, [experiences, favouriteDateFilter, favouriteFarmFilter, favouriteOnly, favouriteSearch, favouriteVarietyFilter, favouriteWineTypeFilter, filterReferenceTime]);
  const journalMonthOptions = useMemo(() => [...new Set(experiences.map((item) => item.startedAt.slice(0, 7)))].sort().reverse(), [experiences]);
  const needsReviewCount = useMemo(() => experiences.reduce((total, item) => total + (item.wines ?? []).filter((wine) => wine.suggestedIdentity && wine.suggestionStatus !== "confirmed").length, 0), [experiences]);
  const visibleExperiences = useMemo(() => experiences.filter((item) => {
    const month = item.startedAt.slice(0, 7);
    const wineSearchText = (item.wines ?? []).flatMap((wine) => [
      wine.name,
      wine.note,
      wine.detail,
      wine.transcript,
      wine.summary,
      wine.suggestedIdentity?.producer,
      wine.suggestedIdentity?.varietal,
      wine.suggestedIdentity?.vintage,
      wine.wineType,
      wine.varietal,
    ]).filter(Boolean).join(" ");
    const matchesSearch = `${item.farmName} ${item.town} ${item.note ?? ""} ${wineSearchText}`.toLowerCase().includes(journalSearch.toLowerCase());
    const matchesFarm = journalFarmFilter === "all" || item.farmName === journalFarmFilter;
    const matchesRating = journalRatingFilter === "all" || item.rating === Number(journalRatingFilter);
    const matchesMonth = journalMonthFilter === "all" || month === journalMonthFilter;
    const matchesReaction = journalReactionFilter === "all" || (item.wines ?? []).some((wine) => wine.reaction === journalReactionFilter);
    const matchesWineType = journalWineTypeFilter === "all" || (item.wines ?? []).some((wine) => wine.wineType === journalWineTypeFilter);
    const matchesVariety = journalVarietyFilter === "all" || (item.wines ?? []).some((wine) => wineVarietal(wine) === journalVarietyFilter);
    const matchesReview = !showNeedsReview || (item.wines ?? []).some((wine) => wine.suggestedIdentity && wine.suggestionStatus !== "confirmed");
    return matchesSearch && matchesFarm && matchesRating && matchesMonth && matchesReaction && matchesWineType && matchesVariety && matchesReview;
  }), [experiences, journalFarmFilter, journalMonthFilter, journalRatingFilter, journalReactionFilter, journalSearch, journalVarietyFilter, journalWineTypeFilter, showNeedsReview]);
  const journalGroups = useMemo(() => {
    const groups = new Map<string, ExperienceSummary[]>();
    for (const item of visibleExperiences) {
      const key = item.startedAt.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].sort(([first], [second]) => second.localeCompare(first));
  }, [visibleExperiences]);
  const selectedFarmHistory = farmHistory.get(selectedFarm.name);
  const selectedFarmExperiences = useMemo(
    () => experiences.filter((item) => item.farmName.toLowerCase() === selectedFarm.name.toLowerCase()),
    [experiences, selectedFarm.name],
  );
  const selectedFarmLatestRating = [...selectedFarmExperiences]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0]?.rating;
  const selectedFarmLovedWines = selectedFarmExperiences
    .flatMap((item) => item.wines ?? [])
    .filter((wine) => wine.reaction === "Loved it")
    .map((wine) => wine.name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .slice(0, 3);
  useEffect(() => observeUser((user) => {
    if (user) migrateDeviceJournalToAccount(user.uid);
    setAuthUserId(user?.uid ?? "device");
  }), []);
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/farms/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ farms?: FarmSearchResult[] }> : Promise.reject(new Error("Farm search failed")))
      .then((data) => setSearchResults(data.farms ?? []))
      .catch(() => setSearchResults([]));
    return () => controller.abort();
  }, [search]);
  // Hydration restores persisted device state once on mount.
  useEffect(() => {
    try {
      setHydrated(false);
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        const savedPersonalFarms = Array.isArray(saved.personalFarms) ? saved.personalFarms as Farm[] : [];
        setPersonalFarms(savedPersonalFarms);
        setTab(saved.tab ?? "map");
        setSelectedFarm(
          [...farms, ...savedPersonalFarms].find((farm) => farm.name === saved.selectedFarmName) ??
            farms[0],
        );
        setExperience(Boolean(saved.experience));
        setActiveExperienceId(saved.activeExperienceId ?? "");
        setExperienceStartedAt(saved.experienceStartedAt);
        setExperienceLocation(saved.experienceLocation);
        setWines(saved.wines?.length ? saved.wines : initialWines);
        setExperiences(saved.experiences ?? []);
        setKeepAudio(Boolean(saved.keepAudio));
      } else {
        setPersonalFarms([]);
        setTab("map");
        setSelectedFarm(farms[0]);
        setExperience(false);
        setActiveExperienceId("");
        setExperienceStartedAt(undefined);
        setExperienceLocation(undefined);
        setWines(initialWines);
        setExperiences([]);
        setKeepAudio(false);
      }
    } catch {
      /* local storage unavailable */
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);
  useEffect(() => {
    if (hydrated)
       localStorage.setItem(
        storageKey,
        JSON.stringify({
          tab,
          selectedFarmName: selectedFarm.name,
          personalFarms,
          experience,
          activeExperienceId,
          experienceStartedAt,
          experienceLocation,
          wines,
          experiences,
          keepAudio,
        }),
      );
  }, [
    experience,
    activeExperienceId,
    experienceStartedAt,
    experienceLocation,
    experiences,
    hydrated,
    keepAudio,
    personalFarms,
    selectedFarm.name,
    storageKey,
    tab,
    wines,
  ]);
  useEffect(() => {
    if (authUserId === "device") return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeExperiences(authUserId, (items) => {
        setExperiences((current) => {
          const cloudItems = items.map((item) => ({
                id: item.id,
                farmName: item.farmName,
                 town: item.farmTown ?? "Western Cape",
                startedAt: new Date(item.startedAt).toISOString(),
                rating: item.overallRating ?? 0,
                wineCount: item.wineCount,
                experienceType: item.experienceType,
                note: item.note,
                photo: Boolean(item.photoPath),
                photoPath: item.photoPath,
                wines: item.wines?.map((wine) => ({
                  id: Number(wine.id) || 0,
                  name: wine.name,
                  confirmedName: wine.confirmedName,
                  note: wine.note,
                  rating: wine.rating,
                  wineType: wine.wineType,
                  varietal: wine.varietal,
                  captureMode: wine.captureMode,
                  detail: wine.detail ?? wine.status,
                  reaction: wine.reaction,
                  status: wine.status,
                  error: wine.error,
                  tone: "gold",
                  audio: Boolean(wine.audioPath),
                  photo: Boolean(wine.photoPath),
                  audioPath: wine.audioPath,
                  photoPath: wine.photoPath,
                  transcript: wine.transcript,
                  summary: wine.summary,
                  suggestedIdentity: wine.suggestedIdentity,
                  suggestionStatus: wine.suggestionStatus,
                  reflections: wine.reflections?.map((reflection) => ({
                    id: reflection.id,
                    note: reflection.note,
                    type: reflection.type,
                    reaction: reflection.reaction,
                    createdAt: new Date(reflection.createdAt).toISOString(),
                  })),
                })),
          }));
          const cloudIds = new Set(cloudItems.map((item) => item.id));
          return [...cloudItems, ...current.filter((item) => !cloudIds.has(item.id))];
        });
      }, () => setCloudSyncError(true));
    } catch {
      // Local-first capture remains available if Firebase is temporarily unavailable.
    }
    return () => unsubscribe?.();
  }, [authUserId]);
  useEffect(() => {
    if (!hydrated || authUserId === "device" || !firebaseEnabled || !experiences.length || syncedCloudAccounts.current.has(authUserId)) return;
    syncedCloudAccounts.current.add(authUserId);
    void (async () => {
      await claimUnassignedMedia(authUserId);
      await syncLocalExperiencesToCloud(authUserId, experiences);
      await uploadQueuedMedia(authUserId);
    })().catch(() => {
      setCloudSyncError(true);
      syncedCloudAccounts.current.delete(authUserId);
    });
  }, [authUserId, experiences, hydrated]);
  useEffect(() => {
    const sync = () => {
      const userId = auth?.currentUser?.uid;
      if (userId) void uploadQueuedMedia(userId);
    };
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);
  useEffect(() => {
     const refreshQueue = () => void listQueuedMedia().then((items) => setMediaQueue({ waiting: items.length, failed: items.filter((item) => Boolean(item.lastError)).length, unassigned: items.filter((item) => !item.userId).length })).catch(() => undefined);
    refreshQueue();
    window.addEventListener("media-queue-changed", refreshQueue);
    window.addEventListener("online", refreshQueue);
    return () => { window.removeEventListener("media-queue-changed", refreshQueue); window.removeEventListener("online", refreshQueue); };
  }, []);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);
  useEffect(() => {
    setSelectedWineAudioUrl(undefined);
    setSelectedWinePhotoUrl(undefined);
    if (selectedWine?.audioPath) void getMediaDownloadUrl(selectedWine.audioPath).then(setSelectedWineAudioUrl).catch(() => undefined);
    if (selectedWine?.photoPath) void getMediaDownloadUrl(selectedWine.photoPath).then(setSelectedWinePhotoUrl).catch(() => undefined);
  }, [selectedWine]);
  useEffect(() => {
    setSelectedExperiencePhotoUrl(undefined);
    const experiencePhotoPath = selectedExperience?.photoPath || selectedExperience?.wines?.[0]?.photoPath;
    if (experiencePhotoPath) void getMediaDownloadUrl(experiencePhotoPath).then(setSelectedExperiencePhotoUrl).catch(() => undefined);
  }, [selectedExperience]);
  function rememberFarm(farm: Farm) {
    setPersonalFarms((current) => current.some((item) => item.name.toLowerCase() === farm.name.toLowerCase()) ? current : [...current, farm]);
    setSelectedFarm(farm);
  }
  async function attachUnassignedMedia() {
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    await claimUnassignedMedia(uid);
    await uploadQueuedMedia(uid);
  }
  async function retryQueuedMedia() {
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    await uploadQueuedMedia(uid);
  }
  function begin() {
    const experienceId = crypto.randomUUID();
    const startedAt = startDateTime ? new Date(startDateTime).toISOString() : new Date().toISOString();
    const uid = auth?.currentUser?.uid;
    setFullTastingOpen(false);
    setActiveExperienceId(experienceId);
    setExperienceStartedAt(startedAt);
    setExperienceLocation(undefined);
    if (typeof navigator !== "undefined" && navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setExperienceLocation(location);
          const completed = experienceSummariesRef.current.get(experienceId);
          if (!completed) return;
          const updated = { ...completed, location };
          experienceSummariesRef.current.set(experienceId, updated);
          setExperiences((current) => current.map((item) => item.id === experienceId ? updated : item));
          setSavedExperience((current) => current?.id === experienceId ? updated : current);
          const uid = auth?.currentUser?.uid;
          if (uid && firebaseEnabled)
            void saveCloudExperience({
              id: updated.id,
              userId: uid,
              farmId: updated.farmName.toLowerCase().replaceAll(" ", "-"),
              farmName: updated.farmName,
              farmTown: updated.town,
              startedAt: Date.parse(updated.startedAt),
              status: "completed",
              wineCount: updated.wineCount,
              overallRating: updated.rating,
              note: updated.note,
              location,
            }).catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 },
      );
    setWines([]);
    setCaptureDraft(undefined);
    setRating(0);
    setNote("");
    setExperience(true);
    if (uid && firebaseEnabled) {
      void saveCloudExperience({
        id: experienceId,
        userId: uid,
        farmId: selectedFarm.name.toLowerCase().replaceAll(" ", "-"),
        farmName: selectedFarm.name,
        farmTown: selectedFarm.town,
        farmNote: selectedFarm.note,
        startedAt: Date.parse(startedAt),
        status: "active",
        wineCount: 0,
      }).then(() => setCloudSyncError(false)).catch(() => setCloudSyncError(true));
    }
    trackEvent("experience_started", { online: navigator.onLine });
  }
  function persistActiveWine(wine: Wine, wineCount: number) {
    const uid = auth?.currentUser?.uid;
    if (!uid || !firebaseEnabled || !activeExperienceId) return;
    void Promise.all([
      saveCloudExperience({
        id: activeExperienceId,
        userId: uid,
        farmId: selectedFarm.name.toLowerCase().replaceAll(" ", "-"),
        farmName: selectedFarm.name,
        farmTown: selectedFarm.town,
        farmNote: selectedFarm.note,
        startedAt: Date.parse(experienceStartedAt ?? new Date().toISOString()),
        status: "active",
        wineCount,
        location: experienceLocation,
      }),
      saveCloudWine({
        id: String(wine.id),
        userId: uid,
        experienceId: activeExperienceId,
        name: wine.name,
        detail: wine.detail,
        note: wine.note,
        rating: wine.rating,
        wineType: wine.wineType,
        varietal: wine.varietal,
        captureMode: wine.captureMode,
        reaction: wine.reaction,
        status: toCloudStatus(wine.status),
        audioPath: wine.audioPath,
        photoPath: wine.photoPath,
        createdAt: Date.now(),
      }),
    ]).then(async () => {
      setCloudSyncError(false);
      await uploadQueuedMedia(uid);
    }).catch(() => setCloudSyncError(true));
  }
  function saveWine(wine: Wine) {
    const nextWines = wines.some((item) => item.id === wine.id) ? wines.map((item) => item.id === wine.id ? wine : item) : [...wines, wine];
    setWines(nextWines);
    persistActiveWine(wine, nextWines.length);
    setCaptureDraft(undefined);
    setCaptureOpen(false);
    trackEvent("wine_saved", { kind: wine.audio || wine.photo ? "media" : "manual", online: navigator.onLine });
  }

  function saveQuickAdd(value: { name: string; wineType: WineType; varietal?: string; rating?: number; photo?: File }) {
    const experienceId = crypto.randomUUID();
    const wineId = 1;
    const startedAt = new Date().toISOString();
    const wine: Wine = {
      id: wineId,
      name: value.name,
      detail: "Quick add at home",
      rating: value.rating,
      wineType: value.wineType,
      varietal: value.varietal,
      captureMode: "quick_add",
      status: "ready",
      tone: value.wineType === "red" ? "purple" : value.wineType === "rosé" ? "rose" : value.wineType === "white" ? "gold" : "green",
      photo: Boolean(value.photo),
    };
    const summary: ExperienceSummary = {
      id: experienceId,
      farmName: "At home",
      town: "Personal journal",
      startedAt,
      rating: value.rating ?? 0,
      wineCount: 1,
      experienceType: "at_home",
      wines: [wine],
    };
    if (value.photo) {
      void enqueueMedia({ id: crypto.randomUUID(), userId: auth?.currentUser?.uid, experienceId, wineId: String(wineId), kind: "photo", blob: value.photo });
    }
    experienceSummariesRef.current.set(experienceId, summary);
    setExperiences((current) => [summary, ...current]);
    setQuickAddOpen(false);
    setTab("journal");
    trackEvent("wine_saved", { kind: "quick_add", online: navigator.onLine });
    const uid = auth?.currentUser?.uid;
    if (uid && firebaseEnabled) {
      void Promise.all([
        saveCloudExperience({ id: experienceId, userId: uid, farmId: "at-home", farmName: "At home", farmTown: "Personal journal", startedAt: Date.parse(startedAt), status: "completed", wineCount: 1, overallRating: value.rating, experienceType: "at_home" }),
        saveCloudWine({ id: String(wineId), userId: uid, experienceId, name: wine.name, detail: wine.detail, rating: wine.rating, wineType: wine.wineType, varietal: wine.varietal, captureMode: "quick_add", status: "ready", createdAt: Date.now() }),
      ]).then(async () => {
        setCloudSyncError(false);
        await uploadQueuedMedia(uid);
      }).catch(() => setCloudSyncError(true));
    }
  }
  const updateWineDraft = useCallback((wine: Wine) => {
    setWines((current) => current.some((item) => item.id === wine.id) ? current.map((item) => item.id === wine.id ? wine : item) : [...current, wine]);
  }, []);
  function saveWineDraft(wine: Wine) {
    const nextWines = wines.some((item) => item.id === wine.id) ? wines.map((item) => item.id === wine.id ? wine : item) : [...wines, wine];
    setWines(nextWines);
    persistActiveWine(wine, nextWines.length);
    setCaptureDraft(undefined);
    setCaptureOpen(false);
  }
  function finish() {
    if (!rating) return;
    const summary = {
      id: activeExperienceId || crypto.randomUUID(),
      farmName: selectedFarm.name,
      town: selectedFarm.town,
       startedAt: experienceStartedAt ?? new Date().toISOString(),
      rating,
      wineCount: wines.length,
      experienceType: "farm_tasting" as const,
      note: note || undefined,
      location: experienceLocation,
      wines: [...wines],
    };
    experienceSummariesRef.current.set(summary.id, summary);
    setExperiences((current) => [summary, ...current]);
    setSavedExperience(summary);
    setExperience(false);
    setActiveExperienceId("");
    setExperienceStartedAt(undefined);
    setExperienceLocation(undefined);
    setEndOpen(false);
    trackEvent("experience_completed", { wineCount: summary.wineCount, rating: summary.rating, online: navigator.onLine });
    const uid = auth?.currentUser?.uid;
    if (uid && firebaseEnabled)
      void Promise.all([
        saveCloudExperience({
          id: summary.id,
          userId: uid,
           farmId: selectedFarm.name.toLowerCase().replaceAll(" ", "-"),
           farmName: summary.farmName,
           farmTown: summary.town,
           farmNote: selectedFarm.note,
          startedAt: Date.parse(summary.startedAt),
          status: "completed",
          wineCount: summary.wineCount,
          overallRating: summary.rating,
          note: summary.note,
          location: summary.location,
        }),
        ...wines.map((wine) => saveCloudWine({
              id: String(wine.id),
              userId: uid,
              experienceId: summary.id,
              name: wine.name,
              detail: wine.detail,
              note: wine.note,
              reaction: wine.reaction,
              status: toCloudStatus(wine.status),
              rating: wine.rating,
              wineType: wine.wineType,
              varietal: wine.varietal,
              captureMode: wine.captureMode,
              createdAt: Date.now(),
        })),
      ]).then(async () => {
        setCloudSyncError(false);
        await uploadQueuedMedia(uid);
      }).catch(() => setCloudSyncError(true));
  }
  function saveReflection() {
    if (!selectedExperience || !reflectionWineId || !reflectionText.trim()) return;
    const reflection: Reflection = {
      id: crypto.randomUUID(),
      note: reflectionText.trim(),
      createdAt: new Date().toISOString(),
      type: "at_home",
      reaction: reflectionReaction,
    };
    const updated = {
      ...selectedExperience,
      wines: selectedExperience.wines?.map((wine) =>
        wine.id === reflectionWineId
          ? { ...wine, reflections: [...(wine.reflections ?? []), reflection] }
          : wine,
      ),
    };
    setExperiences((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedExperience(updated);
    setReflectionText("");
    setReflectionReaction(undefined);
    setReflectionWineId(undefined);
    const uid = auth?.currentUser?.uid;
    if (uid && firebaseEnabled)
      void saveCloudReflection({
        id: reflection.id,
        userId: uid,
        experienceId: updated.id,
        wineId: String(reflectionWineId),
        type: reflection.type,
        note: reflection.note,
        reaction: reflection.reaction,
        createdAt: Date.parse(reflection.createdAt),
      }).catch(() => undefined);
  }
  function saveWineName() {
    if (!selectedExperience || !editingWineId || !editedWineName.trim()) return;
    const name = editedWineName.trim();
    const updated = {
      ...selectedExperience,
      wines: selectedExperience.wines?.map((wine) => wine.id === editingWineId ? { ...wine, name, confirmedName: name, suggestionStatus: "confirmed" as const } : wine),
    };
    setExperiences((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedExperience(updated);
    setEditingWineId(undefined);
    setEditedWineName("");
    setWines((current) => current.map((wine) => wine.id === editingWineId ? { ...wine, name, confirmedName: name, suggestionStatus: "confirmed" } : wine));
    const updatedWine = updated.wines?.find((wine) => wine.id === editingWineId);
    const uid = auth?.currentUser?.uid;
    if (uid && firebaseEnabled && updatedWine)
      void saveCloudWine({
        id: String(editingWineId),
        userId: uid,
        experienceId: updated.id,
        name,
        confirmedName: name,
        reaction: updatedWine.reaction,
        rating: updatedWine.rating,
        wineType: updatedWine.wineType,
        varietal: updatedWine.varietal,
        captureMode: updatedWine.captureMode,
        status: toCloudStatus(updatedWine.status),
        suggestedIdentity: updatedWine.suggestedIdentity,
        suggestionStatus: "confirmed",
        createdAt: Date.now(),
      }).catch(() => undefined);
  }
  function updateSuggestionStatus(status: "confirmed" | "deferred") {
    if (!selectedWine || !selectedWineExperienceId) return;
    const suggestedName = selectedWine.suggestedIdentity?.name?.trim();
    const updatedWine = {
      ...selectedWine,
      ...(status === "confirmed" && suggestedName ? { name: suggestedName, confirmedName: suggestedName } : {}),
      suggestionStatus: status,
    };
    const updateExperience = (item: ExperienceSummary) => item.id === selectedWineExperienceId
      ? { ...item, wines: item.wines?.map((wine) => wine.id === selectedWine.id ? updatedWine : wine) }
      : item;
    setExperiences((current) => current.map(updateExperience));
    setSelectedExperience((current) => current && current.id === selectedWineExperienceId ? updateExperience(current) : current);
    setSelectedWine(updatedWine);
    trackEvent("suggestion_reviewed", { status });
    const uid = auth?.currentUser?.uid;
    if (uid && firebaseEnabled)
      void saveCloudWine({
        id: String(updatedWine.id),
        userId: uid,
        experienceId: selectedWineExperienceId,
        name: updatedWine.name,
        confirmedName: updatedWine.confirmedName,
        reaction: updatedWine.reaction,
        rating: updatedWine.rating,
        wineType: updatedWine.wineType,
        varietal: updatedWine.varietal,
        captureMode: updatedWine.captureMode,
        status: toCloudStatus(updatedWine.status),
        suggestedIdentity: updatedWine.suggestedIdentity,
        suggestionStatus: status,
        createdAt: Date.now(),
      }).catch(() => undefined);
  }
  async function retrySelectedWineEnrichment() {
    const uid = auth?.currentUser?.uid;
    if (!uid || !selectedWine || !selectedWineExperienceId) return;
    const wine = selectedWine;
    setRetryError(undefined);
    setSelectedWine({ ...wine, status: "processing", error: undefined });
    try {
      await retryEnrichmentJob(uid, selectedWineExperienceId, String(wine.id));
    } catch {
      setSelectedWine({ ...wine, status: "error" });
      setRetryError("We could not queue another attempt. Check your connection and try again.");
    }
  }
  function editSelectedWineName() {
    if (!selectedWine || !selectedWineExperienceId) return;
    const source = experiences.find((item) => item.id === selectedWineExperienceId);
    if (!source) return;
    setSelectedExperience(source);
    setEditingWineId(selectedWine.id);
    setEditedWineName(selectedWine.name);
    setSelectedWine(undefined);
  }
  async function exportJournal() {
    const queuedMedia = (await listQueuedMedia()).map((item) => ({ id: item.id, userId: item.userId, experienceId: item.experienceId, wineId: item.wineId, kind: item.kind, retainAudio: item.retainAudio, createdAt: item.createdAt, attempts: item.attempts, lastError: item.lastError }));
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), accountId: auth?.currentUser?.uid ?? "device", experiences, wines, queuedMedia }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "my-wine-experience.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  function addExperiencePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !savedExperience) return;
    const updated = { ...savedExperience, photo: true };
    setSavedExperience(updated);
    setExperiences((current) => current.map((item) => item.id === updated.id ? updated : item));
    void enqueueMedia({
      id: crypto.randomUUID(),
      userId: auth?.currentUser?.uid,
      experienceId: updated.id,
      wineId: "experience",
      kind: "photo",
      blob: file,
    }).then(() => {
      const uid = auth?.currentUser?.uid;
      if (uid) return uploadQueuedMedia(uid);
      return undefined;
    }).catch(() => setCloudSyncError(true));
  }
  async function removeExperience(summary: ExperienceSummary) {
    setDeleteError(undefined);
    const uid = auth?.currentUser?.uid;
    try {
      if (uid && firebaseEnabled) await deleteCloudExperience(uid, summary.id);
      await removeQueuedMediaForExperience(summary.id);
    } catch {
      setDeleteError("We could not remove everything yet. Check your connection and try again.");
      return;
    }
    setExperiences((current) => current.filter((item) => item.id !== summary.id));
    experienceSummariesRef.current.delete(summary.id);
    setSelectedExperience(undefined);
    setConfirmDeleteId(undefined);
  }
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <span>Kept</span>
          <span>Wine memories, kept close</span>
        </div>
        <div className="topbar-right">
            <span className="sync-dot" /> <span>{cloudSyncError ? "Saved on this device — cloud sync needs retry" : mediaQueue.unassigned ? `${mediaQueue.unassigned} media ready to attach` : mediaQueue.failed ? `${mediaQueue.failed} media needs retry` : mediaQueue.waiting ? `${mediaQueue.waiting} media waiting to upload` : isOnline ? "Ready to sync" : "Offline - saved on this device"}</span>
           <button className="avatar" aria-label="Open profile" onClick={() => setTab("profile")}>T</button>
        </div>
      </header>
      <section className={`page-content page-content-${tab}`}>
        {tab === "map" && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">WESTERN CAPE - 05 OCTOBER 2026</p>
              </div>
            </div>
            <div className="map-card">
              <div className="map-toolbar">
                <div className="search-field">
                  <Icon name="search" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search places or towns"
                  />
                </div>
                <button
                  className="filter-pill"
                  aria-label="Change map filter"
                  onClick={() => setFarmFilter((current) => current === "all" ? "visited" : current === "visited" ? "favourites" : "all")}
                >
                  {farmFilter === "all" ? "All places" : farmFilter === "visited" ? "Kept places" : "Worth revisiting"}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="farm-search-results" role="listbox" aria-label="Farm search results">
                  {searchResults.slice(0, 6).map((result) => (
                    <button
                      key={result.id}
                      onClick={() => {
                        const local = allFarms.find((farm) => farm.name.toLowerCase() === result.name.toLowerCase());
                        rememberFarm(local ?? makePersonalFarm(result.name, result.town, "Google place", result.location));
                        setSearch(result.name);
                        setSearchResults([]);
                      }}
                    >
                      <strong>{result.name}</strong><small>{result.town}, {result.province}</small>
                    </button>
                  ))}
                </div>
              )}
              {search.trim().length >= 2 && searchResults.length === 0 && (
                <button className="manual-farm-result" onClick={() => { rememberFarm(makePersonalFarm(search.trim(), "Western Cape")); setSearchResults([]); }}>
                  Use “{search.trim()}” as a private place
                </button>
              )}
              <GoogleMapSurface
                farms={filtered.map((farm) => ({ ...farm, visited: farm.visited || farmHistory.get(farm.name)?.visited, favourite: farm.favourite || farmHistory.get(farm.name)?.favourite })) as MapFarm[]}
                selectedFarm={selectedFarm}
                onSelect={(farm) => setSelectedFarm(allFarms.find((candidate) => candidate.name === farm.name) ?? makePersonalFarm(farm.name, farm.town, "Google place", farm.location))}
              />
              <div className="farm-preview">
                <div>
                  <p className="eyebrow">
                  {selectedFarm.visited || selectedFarmHistory?.visited ? "A PLACE YOU’VE KEPT" : "A PLACE TO REMEMBER"}
                  </p>
                  <h2>{selectedFarm.name}</h2>
                  <p className="muted">
                    {selectedFarm.town} - {selectedFarm.note}{selectedFarmHistory?.visits ? ` - ${selectedFarmHistory.visits} visit${selectedFarmHistory.visits === 1 ? "" : "s"}` : ""}
                  </p>
                  {selectedFarmLatestRating ? <p className="farm-history-detail">Latest feeling: {"*".repeat(selectedFarmLatestRating)}</p> : null}
                  {selectedFarmLovedWines.length ? <p className="farm-history-detail">Worth revisiting: {selectedFarmLovedWines.join(", ")}</p> : null}
                  {selectedFarmHistory?.visited && <button className="text-button" onClick={() => { setJournalSearch(selectedFarm.name); setTab("journal"); }}>Open memories <Icon name="arrow" /></button>}
                </div>
                <button
                  className="round-arrow"
                  aria-label={`Start an experience at ${selectedFarm.name}`}
                  onClick={() => setFullTastingOpen(true)}
                >
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "journal" && (
          <div className="list-view">
            <div className="search-control-row">
              <div className="search-field journal-search">
                <Icon name="search" />
                <input value={journalSearch} onChange={(event) => setJournalSearch(event.target.value)} placeholder="Search places, bottles, or memories" />
              </div>
              <button className="filter-toggle" type="button" aria-expanded={journalFiltersOpen} onClick={() => setJournalFiltersOpen((value) => !value)}>
                Filters <span aria-hidden="true">{journalFiltersOpen ? "−" : "+"}</span>
              </button>
            </div>
            {journalFiltersOpen && <div className="filter-row" aria-label="Journal filters">
              <select value={journalFarmFilter} onChange={(event) => setJournalFarmFilter(event.target.value)} aria-label="Filter journal by farm">
                <option value="all">All farms</option>
                {[...new Set(experiences.map((item) => item.farmName))].sort().map((farmName) => <option key={farmName} value={farmName}>{farmName}</option>)}
              </select>
              <select value={journalRatingFilter} onChange={(event) => setJournalRatingFilter(event.target.value)} aria-label="Filter journal by rating">
                <option value="all">All ratings</option>
                {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}
              </select>
              <select value={journalMonthFilter} onChange={(event) => setJournalMonthFilter(event.target.value)} aria-label="Filter journal by month">
                <option value="all">All months</option>
                {journalMonthOptions.map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`))}</option>)}
              </select>
              <select value={journalReactionFilter} onChange={(event) => setJournalReactionFilter(event.target.value)} aria-label="Filter journal by reaction">
                <option value="all">All reactions</option>
                <option value="Loved it">Loved it</option>
                <option value="Liked it">Liked it</option>
                <option value="Not for me">Not for me</option>
              </select>
              <select value={journalWineTypeFilter} onChange={(event) => setJournalWineTypeFilter(event.target.value)} aria-label="Filter journal by wine type">
                <option value="all">All wine types</option>
                {wineTypes.map((type) => <option key={type} value={type}>{WINE_TYPE_LABELS[type]}</option>)}
              </select>
              <select value={journalVarietyFilter} onChange={(event) => setJournalVarietyFilter(event.target.value)} aria-label="Filter journal by variety">
                <option value="all">All varieties</option>
                {wineVarieties.map((variety) => <option key={variety} value={variety}>{variety}</option>)}
              </select>
              {needsReviewCount > 0 && <button className={`review-filter ${showNeedsReview ? "active" : ""}`} onClick={() => setShowNeedsReview((value) => !value)}>Needs review ({needsReviewCount})</button>}
            </div>}
            {journalGroups.length ? (
              journalGroups.map(([month, items]) => <div key={month} className="journal-month-group">
                <p className="month-label">{new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`))}</p>
                {items.map((item) => {
                  const savedWines = item.wines ?? [];
                  const wineNames = savedWines.map((wine) => wine.name).filter((name) => name && name !== "Wine experience");
                  const date = new Date(item.startedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
                  const title = wineNames[0] || item.farmName || "Wine memory";
                  return (
                <button
                  className="journal-card featured journal-card-button"
                  key={item.id}
                  onClick={() => setSelectedExperience(item)}
                >
                  {(item.photoPath || item.wines?.[0]?.photoPath) && <ExperiencePhotoPreview path={item.photoPath || item.wines?.[0]?.photoPath} alt={`Photo from ${item.farmName}`} />}
                  <div className="card-copy">
                    <h2>{title}</h2>
                    <p className="journal-card-context">{item.experienceType === "at_home" ? "At home" : `${item.farmName} · ${item.town}`} · {date}</p>
                    <div className="journal-card-bottles">
                      {savedWines.map((wine) => (
                        <div className="journal-card-bottle" key={wine.id}>
                          {savedWines.length > 1 && <strong>{wine.name}</strong>}
                          <span>{[wineTypeLabel(wine.wineType), wineVarietal(wine)].filter(Boolean).join(" · ") || "Wine details to add"}</span>
                          {wine.rating ? <span className="wine-stars" aria-label={`${wine.rating} out of 5 stars`}>{"★".repeat(wine.rating)}</span> : wine.reaction ? <span className="reaction-chip loved">{reactionLabel(wine.reaction)}</span> : <span>Not yet rated</span>}
                          {(wine.note || wine.detail) && <p>{wine.note || wine.detail}</p>}
                        </div>
                      ))}
                    </div>
                    {item.note && item.note !== title && <p className="journal-card-note">{item.note}</p>}
                    <span className="text-button card-open-button">
                      View full memory <Icon name="arrow" />
                    </span>
                  </div>
                </button>
                  );
                })}
              </div>)
            ) : experiences.length ? (
              <div className="empty-state"><h2>No matching memories.</h2><p className="muted">Try another farm, town, or note.</p></div>
            ) : (
              <div className="empty-state">
                <p className="eyebrow">YOUR FIRST MEMORY</p>
                <h2>Start with a bottle or place you want to keep.</h2>
                <p className="muted">Your places, bottles, and small details will stay here for whenever you want to return.</p>
                <button className="primary-button" onClick={() => setFullTastingOpen(true)}>Keep a tasting <Icon name="arrow" /></button>
              </div>
            )}
          </div>
        )}
        {tab === "favourites" && (
          <div className="list-view">
            <div className="search-control-row">
              <div className="search-field favourites-search">
                <Icon name="search" />
              <input value={favouriteSearch} onChange={(event) => setFavouriteSearch(event.target.value)} placeholder="Search your wines" />
              </div>
              <button className="filter-toggle" type="button" aria-expanded={favouriteFiltersOpen} onClick={() => setFavouriteFiltersOpen((value) => !value)}>
                Filters <span aria-hidden="true">{favouriteFiltersOpen ? "−" : "+"}</span>
              </button>
            </div>
            {favouriteFiltersOpen && <div className="filter-row" aria-label="Buy again filters">
              <select value={favouriteOnly} onChange={(event) => setFavouriteOnly(event.target.value)} aria-label="Filter My Wines by favourite status">
                <option value="all">All wines</option>
                <option value="favourites">Favourites</option>
              </select>
              <select value={favouriteFarmFilter} onChange={(event) => setFavouriteFarmFilter(event.target.value)} aria-label="Filter favourites by farm">
                <option value="all">All farms</option>
                {[...new Set(experiences.map((item) => item.farmName))].sort().map((farmName) => <option key={farmName} value={farmName}>{farmName}</option>)}
              </select>
              <select value={favouriteWineTypeFilter} onChange={(event) => setFavouriteWineTypeFilter(event.target.value)} aria-label="Filter favourites by wine type">
                <option value="all">All wine types</option>
                {wineTypes.map((type) => <option key={type} value={type}>{WINE_TYPE_LABELS[type]}</option>)}
              </select>
              <select value={favouriteVarietyFilter} onChange={(event) => setFavouriteVarietyFilter(event.target.value)} aria-label="Filter favourites by variety">
                <option value="all">All varieties</option>
                {wineVarieties.map((variety) => <option key={variety} value={variety}>{variety}</option>)}
              </select>
              <select value={favouriteDateFilter} onChange={(event) => setFavouriteDateFilter(event.target.value)} aria-label="Filter favourites by date">
                <option value="all">Any date</option>
                <option value="30">Last 30 days</option>
                <option value="365">Last year</option>
              </select>
            </div>}
            {favouriteItems.map(({ wine, experience: experienceItem }) => (
                  <button className="wine-row wine-row-button" key={`${experienceItem.id}-${wine.id}`} onClick={() => { setSelectedWine(wine); setSelectedWineExperienceId(experienceItem.id); }} aria-label={`Open ${wine.name} from ${experienceItem.farmName}`}>
                  <div className={`wine-art ${wine.tone}`}>
                    <span>{wine.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="wine-info">
                    <p className="eyebrow">{wine.status}</p>
                    <h3>{wine.name}</h3>
                    <p className="muted">{experienceItem.farmName} · {[wineTypeLabel(wine.wineType), wineVarietal(wine)].filter(Boolean).join(" · ") || wine.detail}</p>
                    {wine.rating ? <span className="wine-stars" aria-label={`${wine.rating} out of 5 stars`}>{"★".repeat(wine.rating)}</span> : wine.reaction ? <span className="reaction-chip loved">{wine.reaction}</span> : <span className="muted">Not yet rated</span>}
                  </div>
                </button>
              ))}
            {!favouriteItems.length && (
              <div className="empty-state">
                <h2>{favouriteOnly === "favourites" ? "Your favourites will grow here." : "Your wines will appear here."}</h2>
                <p className="muted">Save a wine during a tasting or use Quick Add to keep it in your collection.</p>
              </div>
            )}
          </div>
        )}
        {tab === "profile" && (
          <div className="list-view profile-view">
            <div className="account-status">
              <div>
                <strong>{auth?.currentUser?.email ?? "Your private journal"}</strong>
                <p>{firebaseEnabled && auth?.currentUser ? "Your journal is syncing securely." : firebaseEnabled ? "Sign in to keep this journal synced." : "Cloud sync is not configured in this version of the app."}</p>
              </div>
              <button className="text-button" onClick={() => void signOutUser()}>
                Sign out
              </button>
            </div>
            <div className="settings-list">
              {auth?.currentUser && mediaQueue.unassigned > 0 && <button onClick={() => void attachUnassignedMedia()}><span>↗</span><div>Attach pending media<small>Sync offline captures to this account</small></div><Icon name="arrow" /></button>}
              {auth?.currentUser && mediaQueue.failed > 0 && <button onClick={() => void retryQueuedMedia()}><span>↻</span><div>Retry media uploads<small>{mediaQueue.failed} capture{mediaQueue.failed === 1 ? "" : "s"} waiting for another try</small></div><Icon name="arrow" /></button>}
              <button onClick={() => setKeepAudio((value) => !value)}>
                <span>R</span> Keep original recordings{" "}
                <small>{keepAudio ? "On" : "Off"}</small>
              </button>
              <a className="settings-link" href="/privacy">
                <span>?</span>
                <div>
                  Help and privacy<small>Read more</small>
                </div>
                <Icon name="arrow" />
              </a>
              <button className="export-journal" onClick={exportJournal}>
                <span>↓</span>
                <div>
                  Export your journal<small>Download a private JSON copy</small>
                </div>
                <Icon name="arrow" />
              </button>
            </div>
          </div>
        )}
      </section>
      {experience && (
        <section className="active-experience-panel" aria-label="Active wine tasting">
          <div className="active-experience-heading">
            <div>
              <p className="eyebrow">WINE LIST</p>
              <h2>{wines.length ? `${wines.length} of 7 wines` : "Wine 1 - ready when the first pour arrives"}</h2>
            </div>
            <span className="sync-status">{cloudSyncError ? "Saved on this device — sync needs retry" : mediaQueue.failed ? `${mediaQueue.failed} need retry` : mediaQueue.waiting ? `${mediaQueue.waiting} waiting` : isOnline ? "Ready to sync" : "Saved on this device"}</span>
          </div>
          {wines.map((wine, index) => (
            <button className="active-wine-row" key={wine.id} onClick={() => { if (wine.status === "Draft") { setCaptureDraft(wine); setCaptureOpen(true); } }} disabled={wine.status !== "Draft"}>
              <span className="wine-number">{index + 1}</span>
              <div><strong>{wine.name}</strong><small>{wine.reaction ?? "Choose a reaction"}</small></div>
              <span className="processing-status">{wine.status}</span>
            </button>
          ))}
          {wines.some((wine) => wine.status === "Draft") && <p className="muted">Drafts are saved on this device. Tap a draft to finish it.</p>}
          {wines.length >= 7 && <p className="muted">Seven wines captured. You can still edit existing entries.</p>}
        </section>
      )}
      {experience && (
        <section className="experience-bar">
          <div>
            <p className="eyebrow">
              ACTIVE EXPERIENCE - {selectedFarm.name.toUpperCase()}
            </p>
            <strong>{wines.length} wines captured</strong>
          </div>
          <button className="end-link" onClick={() => setEndOpen(true)}>
            End
          </button>
          <button
            onClick={() => setCaptureOpen(true)}
            disabled={wines.length >= 7}
          >
            <Icon name="plus" /> Add wine
          </button>
        </section>
      )}
      <nav className="bottom-nav">
        <div className="bottom-nav-items">
          {(
            [
              ["map", "map", "Places"],
              ["journal", "book", "Journal"],
              ["start", "plus", "Keep"],
              ["favourites", "heart", "Wines"],
              ["profile", "user", "Me"],
            ] as [Tab | "start", string, string][]
          ).map(([key, icon, label]) => (
            <button
              key={key}
              className={key === "start" ? "nav-action" : tab === key ? "selected" : ""}
              aria-current={key !== "start" && tab === key ? "page" : undefined}
              aria-label={key === "start" ? "Keep a wine or tasting" : label}
              onClick={() => key === "start" ? setStartChooserOpen(true) : setTab(key)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      {startChooserOpen && (
        <div className="modal-backdrop" onClick={() => setStartChooserOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="start-sheet-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2 id="start-sheet-title">What would you like to <em>keep?</em></h2>
            <button className="primary-button chooser-button" onClick={() => { setStartChooserOpen(false); setQuickAddOpen(true); }}>Keep a bottle <Icon name="arrow" /></button>
            <button className="text-button chooser-secondary" onClick={() => { setStartChooserOpen(false); setFullTastingOpen(true); }}>Start a tasting <Icon name="arrow" /></button>
          </div>
        </div>
      )}
      {fullTastingOpen && (
        <div className="modal-backdrop" onClick={() => setFullTastingOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="start-sheet-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="eyebrow">KEEP A TASTING</p>
            <h2 id="start-sheet-title">Where are you <em>today?</em></h2>
            <div className="selected-farm">
              <div className="farm-icon">F</div>
              <div>
                <strong>{selectedFarm.name}</strong>
                <p>{selectedFarm.town}, Western Cape</p>
              </div>
              <button onClick={() => setFullTastingOpen(false)}>Change farm</button>
            </div>
            <label className="name-input setup-datetime">
              <span>DATE &amp; TIME</span>
              <input
                type="datetime-local"
                value={startDateTime}
                onChange={(event) => setStartDateTime(event.target.value)}
              />
            </label>
            <p className="reassurance">Keep the feeling first. Details can come later.</p>
            <button className="primary-button" onClick={begin}>
              Begin keeping <Icon name="arrow" />
            </button>
          </div>
        </div>
      )}
      {quickAddOpen && <QuickAddSheet onClose={() => setQuickAddOpen(false)} onSave={saveQuickAdd} />}
      {captureOpen && (
        <CaptureSheet
          wines={wines}
          experienceId={activeExperienceId || "draft-experience"}
          retainAudio={keepAudio}
          draft={captureDraft}
          onClose={() => { setCaptureDraft(undefined); setCaptureOpen(false); }}
          onSave={saveWine}
          onSaveDraft={saveWineDraft}
          onAutoSaveDraft={updateWineDraft}
        />
      )}
      {endOpen && (
        <div className="modal-backdrop" onClick={() => setEndOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="end-sheet-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="eyebrow">KEEP THE DAY</p>
            <h2 id="end-sheet-title">
              What would you <em>keep?</em>
            </h2>
            <div className="end-summary" aria-label="Experience summary">
              <div><strong>{wines.length}</strong><span>bottles kept</span></div>
              <div><strong>{wines.filter((wine) => wine.reaction === "Loved it").length}</strong><span>pour again</span></div>
              <div><strong>{wines.filter((wine) => wine.status === "Waiting to upload" || wine.status === "Processing").length}</strong><span>filling in details</span></div>
            </div>
            <p className="muted">Your memory is kept before any background details are filled in.</p>
            <div className="star-row">
              {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    aria-label={`Rate farm experience ${value} out of 5 stars`}
                  className={rating >= value ? "star active" : "star"}
                  key={value}
                  onClick={() => setRating(value)}
                >
                  *
                </button>
              ))}
            </div>
            <textarea
              className="farm-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What made it stay with you?"
            />
            {wines.some((wine) => wine.status === "Draft") && <p className="muted">You have {wines.filter((wine) => wine.status === "Draft").length} unfinished draft{wines.filter((wine) => wine.status === "Draft").length === 1 ? "" : "s"}. They will stay saved on this device.</p>}
            <button
              className="primary-button"
              disabled={!rating}
              onClick={finish}
            >
              Keep for later <Icon name="arrow" />
            </button>
          </div>
        </div>
      )}
      {savedExperience && (
        <div className="modal-backdrop" onClick={() => setSavedExperience(undefined)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="saved-sheet-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="eyebrow">KEPT FOR LATER</p>
            <h2 id="saved-sheet-title">Your memory is <em>kept.</em></h2>
            <p className="muted">{savedExperience.wineCount} {savedExperience.wineCount === 1 ? "bottle" : "bottles"} kept at {savedExperience.farmName}. Any photo or voice note will quietly fill in the details.</p>
            <div className="receipt-actions">
              <button className="primary-button" onClick={() => { setSelectedExperience(savedExperience); setSavedExperience(undefined); }}>View memory <Icon name="arrow" /></button>
              <input ref={experiencePhotoInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={addExperiencePhoto} />
              <button className="text-button" onClick={() => experiencePhotoInput.current?.click()}>{savedExperience.photo ? "Photo ready to keep" : "Add a place photo"} <Icon name="camera" /></button>
              <button className="text-button" onClick={() => setSavedExperience(undefined)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {selectedExperience && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedExperience(undefined)}
        >
          <div
            className="sheet experience-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="experience-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="sheet-handle sheet-close-handle" type="button" aria-label="Close experience details" onClick={() => setSelectedExperience(undefined)}><span /></button>
            <h2 id="experience-detail-title">{selectedExperience.wines?.[0]?.name || selectedExperience.farmName || "Wine memory"}</h2>
            <p className="experience-context">{selectedExperience.experienceType === "at_home" ? "At home" : `${selectedExperience.farmName} · ${selectedExperience.town}`} · {new Date(selectedExperience.startedAt).toLocaleDateString("en-ZA")} {selectedExperience.rating ? <><span aria-hidden="true">·</span> <span className="wine-stars" aria-label={`${selectedExperience.rating} out of 5 stars`}>{"★".repeat(selectedExperience.rating)}</span></> : null}</p>
            {selectedExperience.experienceType !== "at_home" && <a className="detail-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedExperience.farmName}, ${selectedExperience.town}`)}`} target="_blank" rel="noreferrer">Open farm in Maps <Icon name="arrow" /></a>}
            {selectedExperiencePhotoUrl && <img className="experience-photo" src={selectedExperiencePhotoUrl} alt={`Photo from ${selectedExperience.farmName}`} />}
            {selectedExperience.note && <p className="experience-detail-note">{selectedExperience.note}</p>}
            {selectedExperience.wines?.map((wine) => (
              <div className="experience-wine" key={wine.id}>
                {wine.photoPath && <ExperiencePhotoPreview path={wine.photoPath} alt={`Label photo for ${wine.name}`} />}
                {editingWineId === wine.id ? (
                  <input
                    className="name-input"
                    value={editedWineName}
                    onChange={(event) => setEditedWineName(event.target.value)}
                    aria-label="Correct wine name"
                  />
                ) : <strong>{wine.name}</strong>}
                {wine.rating ? <span className="reaction-chip loved">{"★".repeat(wine.rating)} / 5</span> : wine.reaction ? <span className={`reaction-chip ${wine.reaction === "Loved it" ? "loved" : "neutral"}`}>{reactionLabel(wine.reaction)}</span> : <span className="muted">Not yet rated</span>}
                {(wine.wineType || wineVarietal(wine)) && <p className="wine-category-line">{[wineTypeLabel(wine.wineType), wineVarietal(wine)].filter(Boolean).join(" · ")}</p>}
                {wine.detail && <p className="detail-copy">{wine.detail}</p>}
                {wine.note && <p className="personal-note">“{wine.note}”</p>}
                {wine.summary && <p className="detail-copy">{wine.summary}</p>}
                {wine.suggestedIdentity && <p className="detail-copy">{[wine.suggestedIdentity.producer, wine.suggestedIdentity.varietal, wine.suggestedIdentity.vintage, wine.suggestedIdentity.region].filter(Boolean).join(" · ")}</p>}
                <button className="text-button" onClick={() => { setSelectedWine(wine); setSelectedWineExperienceId(selectedExperience.id); }}>Open wine</button>
                {editingWineId === wine.id ? (
                  <button className="text-button" onClick={saveWineName}>Save name</button>
                ) : (
                  <button className="text-button" onClick={() => { setEditingWineId(wine.id); setEditedWineName(wine.name); }}>
                    Edit name
                  </button>
                )}
                {wine.reflections?.map((reflection) => (
                  <p className="muted" key={reflection.id}>At home{reflection.reaction ? ` · ${reflection.reaction}` : ""}: {reflection.note}</p>
                ))}
                <button className="text-button" onClick={() => { setReflectionWineId(wine.id); setReflectionReaction(undefined); }}>
                  Add a second thought <Icon name="arrow" />
                </button>
              </div>
            ))}
            {reflectionWineId && (
              <div className="reflection-form">
                <textarea
                  className="farm-note"
                  value={reflectionText}
                  onChange={(event) => setReflectionText(event.target.value)}
                  placeholder="What stayed with you when you came back to it?"
                />
                <p className="reaction-label">How does it land now? <small>Optional</small></p>
                <div className="reaction-grid">
                  {(["Loved it", "Liked it", "Not for me"] as Reaction[]).map((item) => <button key={item} className={reflectionReaction === item ? "chosen" : ""} onClick={() => setReflectionReaction(item)}>{reactionLabel(item)}</button>)}
                </div>
                <button className="primary-button" disabled={!reflectionText.trim()} onClick={saveReflection}>
                  Keep this thought <Icon name="arrow" />
                </button>
              </div>
            )}
            {confirmDeleteId === selectedExperience.id ? (
              <div className="delete-confirmation">
                <p className="muted">This removes the experience, its wines, reflections, and stored media.</p>
                {deleteError && <p className="form-message">{deleteError}</p>}
                <button className="danger-button" onClick={() => void removeExperience(selectedExperience)}>Confirm delete</button>
                <button className="text-button" onClick={() => setConfirmDeleteId(undefined)}>Keep experience</button>
              </div>
            ) : (
              <div className="detail-footer-actions">
                <button className="danger-button" onClick={() => setConfirmDeleteId(selectedExperience.id)}>Delete</button>
                <button className="primary-button sheet-done-button" onClick={() => setSelectedExperience(undefined)}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}
      {selectedWine && (
        <div className="modal-backdrop" onClick={() => setSelectedWine(undefined)}>
          <div className="sheet wine-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="wine-detail-title" onClick={(event) => event.stopPropagation()}>
            <button className="sheet-handle sheet-close-handle" type="button" aria-label="Close wine details" onClick={() => setSelectedWine(undefined)}><span /></button>
            <p className="eyebrow">BOTTLE MEMORY</p>
            <h2 id="wine-detail-title">{selectedWine.name}</h2>
            {selectedWine.rating ? <span className="reaction-chip loved">{"★".repeat(selectedWine.rating)} / 5</span> : selectedWine.reaction ? <span className="reaction-chip loved">{selectedWine.reaction}</span> : null}
            {(selectedWine.wineType || wineVarietal(selectedWine)) && <p className="wine-category-line">{[wineTypeLabel(selectedWine.wineType), wineVarietal(selectedWine)].filter(Boolean).join(" · ")}</p>}
            <p className="detail-copy">{selectedWine.detail}</p>
            {selectedWine.note && <div className="detail-section"><p className="eyebrow">YOUR NOTE</p><p className="detail-copy">{selectedWine.note}</p></div>}
            {selectedWine.summary && <div className="detail-section"><p className="eyebrow">HOST SUMMARY</p><p className="detail-copy">{selectedWine.summary}</p></div>}
            {selectedWine.transcript && <div className="detail-section"><p className="eyebrow">TRANSCRIPT</p><p className="detail-copy">{selectedWine.transcript}</p></div>}
            {selectedWine.suggestedIdentity && (
              <div className="detail-section">
                <p className="eyebrow">DETAILS WE FOUND</p>
                <p className="detail-copy">
                  {[selectedWine.suggestedIdentity.name, selectedWine.suggestedIdentity.producer, selectedWine.suggestedIdentity.varietal, selectedWine.suggestedIdentity.vintage, selectedWine.suggestedIdentity.region].filter(Boolean).join(" · ") || "No additional details yet."}
                </p>
                {selectedWine.suggestedIdentity.descriptors?.length ? <p className="muted">Descriptors: {selectedWine.suggestedIdentity.descriptors.join(", ")}</p> : null}
                {selectedWine.suggestedIdentity.winemakingDetails?.length ? <p className="muted">Winemaking: {selectedWine.suggestedIdentity.winemakingDetails.join(", ")}</p> : null}
                {selectedWine.suggestedIdentity.foodPairings?.length ? <p className="muted">Pairings: {selectedWine.suggestedIdentity.foodPairings.join(", ")}</p> : null}
                {selectedWine.suggestedIdentity.evidence?.map((snippet) => <p className="muted" key={snippet}>“{snippet}”</p>)}
                <p className="muted">Suggestion only — edit the wine name if you want to confirm it.</p>
                {selectedWine.suggestionStatus === "confirmed" ? <p className="suggestion-confirmed">Confirmed by you</p> : (
                  <div className="suggestion-actions">
                    <button className="primary-button" onClick={() => updateSuggestionStatus("confirmed")}>Looks right <Icon name="arrow" /></button>
                    <button className="text-button" onClick={editSelectedWineName}>Edit</button>
                    <button className="text-button" onClick={() => updateSuggestionStatus("deferred")}>Leave for later</button>
                  </div>
                )}
              </div>
            )}
            <div className="detail-section">
              <p className="eyebrow">WHAT YOU CAPTURED</p>
              <p className="muted">{selectedWine.photoPath ? "Label photo available" : selectedWine.photo ? "Label photo saved" : "No label photo saved"} · {selectedWine.audioPath ? "Voice note available" : selectedWine.audio ? "Voice note queued" : "No voice note saved"}</p>
              <p className="muted">Status: {selectedWine.status}</p>
              {selectedWine.error && <>
                <p className="form-message">We could not organise this capture yet. You can retry the organiser or retry media uploads from Profile.</p>
                <button className="text-button" onClick={() => void retrySelectedWineEnrichment()}>Retry organisation <Icon name="arrow" /></button>
                {retryError && <p className="form-message">{retryError}</p>}
              </>}
              {selectedWinePhotoUrl && <img className="detail-photo" src={selectedWinePhotoUrl} alt={`Label photo for ${selectedWine.name}`} />}
              {selectedWineAudioUrl && <audio className="audio-player" controls preload="metadata" src={selectedWineAudioUrl} />}
            </div>
            {selectedWine.reflections?.map((reflection) => (
              <div className="reflection" key={reflection.id}><small>SECOND THOUGHT{reflection.reaction ? ` · ${reactionLabel(reflection.reaction)}` : ""}</small><p>{reflection.note}</p></div>
            ))}
             <button className="primary-button" onClick={() => { setReflectionWineId(selectedWine.id); setReflectionReaction(undefined); setSelectedWine(undefined); }}>Add a second thought <Icon name="arrow" /></button>
            <button className="primary-button sheet-done-button" onClick={() => setSelectedWine(undefined)}>Done</button>
          </div>
        </div>
      )}
    </main>
  );
}
