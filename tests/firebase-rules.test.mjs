import assert from "node:assert/strict";
import fs from "node:fs";
import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

const projectId = process.env.GCLOUD_PROJECT ?? "wine-experience-rules-test";
let testEnv;

const experience = {
  userId: "user-a",
  farmId: "boschendal",
  farmName: "Boschendal",
  wineCount: 0,
  status: "completed",
  overallRating: 5,
};

const wine = {
  userId: "user-a",
  experienceId: "experience-a",
  name: "Untitled wine",
  reaction: "Loved it",
  status: "ready",
};

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
    storage: { rules: fs.readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test("owners can create valid experiences and wines", async () => {
  const db = testEnv.authenticatedContext("user-a").firestore();
  await assertSucceeds(db.doc("users/user-a/experiences/experience-a").set(experience));
  await assertSucceeds(db.doc("users/user-a/experiences/experience-a/wines/wine-a").set(wine));
});

test("users cannot read another user's journal", async () => {
  const db = testEnv.authenticatedContext("user-b").firestore();
  await assertFails(db.doc("users/user-a/experiences/experience-a").get());
});

test("drafts may omit a reaction, but ready wines may not", async () => {
  const db = testEnv.authenticatedContext("user-a").firestore();
  const draft = { ...wine, status: "draft" };
  delete draft.reaction;
  await assertSucceeds(db.doc("users/user-a/experiences/experience-a/wines/draft-a").set(draft));
  await assertFails(db.doc("users/user-a/experiences/experience-a/wines/invalid-a").set({ ...draft, status: "ready" }));
});

test("quick add wines use a valid rating and wine type without a reaction", async () => {
  const db = testEnv.authenticatedContext("user-a").firestore();
  const quickAdd = { ...wine, status: "ready", captureMode: "quick_add", rating: 4, wineType: "white" };
  delete quickAdd.reaction;
  await assertSucceeds(db.doc("users/user-a/experiences/experience-a/wines/quick-add-a").set(quickAdd));
  await assertFails(db.doc("users/user-a/experiences/experience-a/wines/quick-add-invalid").set({ ...quickAdd, rating: 6 }));
  await assertFails(db.doc("users/user-a/experiences/experience-a/wines/quick-add-invalid-type").set({ ...quickAdd, wineType: "orange" }));
});

test("clients cannot mutate processing jobs", async () => {
  const db = testEnv.authenticatedContext("user-a").firestore();
  const job = db.doc("users/user-a/processingJobs/job-a");
  await assertSucceeds(job.set({ userId: "user-a", status: "queued" }));
  await assertFails(job.update({ status: "ready" }));
});

test("storage enforces owner path and media type", async () => {
  const owner = testEnv.authenticatedContext("user-a").storage();
  const otherUser = testEnv.authenticatedContext("user-b").storage();
  const path = "users/user-a/experiences/experience-a/wines/wine-a/photos/photo-a.jpg";
  await assertSucceeds(owner.ref(path).put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  await assertFails(otherUser.ref(path).getMetadata());
  await assertFails(owner.ref("users/user-a/experiences/experience-a/wines/wine-a/photos/audio.mp3").put(new Uint8Array([1]), { contentType: "audio/mpeg" }));
});

assert.ok(projectId);
