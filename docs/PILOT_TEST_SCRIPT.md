# My Wine Experience pilot script

Run this against a staging Firebase project and a preview deployment before using production data. Record the device, browser version, connection state, timestamp, and a screenshot for every failure. Do not put real voice recordings or private notes into issue comments.

## Setup

- Use one Android phone as the primary pilot device and one iPhone for compatibility coverage.
- Create a fresh test account for each device.
- Confirm the preview deployment has the Firebase, Places, Gemini, and enrichment-worker variables configured.
- Confirm Firestore and Storage rules are deployed to the staging project.
- Have one test farm that is returned by Places search and one private/manual farm.

## Core offline capture

1. Sign in, open Map, and search for the test farm.
2. Start an experience and disable mobile data and Wi-Fi.
3. Add three wines. For the first, enter a manual name and tap **Loved it**. For the second, record audio. For the third, take a label photo and tap **Liked it**.
4. Close one capture sheet before choosing a reaction. Confirm it appears as **Draft** and can be resumed.
5. End the experience with a one-to-five-star rating and a note.
6. Confirm the saved experience remains visible while offline and the status says saved on the device or waiting to upload.

Expected result: no step blocks on Gemini, Places, or a network response; no wine, reaction, rating, note, draft, photo, or audio capture disappears.

## Reconnection and enrichment

1. Restore connectivity and leave the app open for at least two minutes.
2. Confirm the header moves from waiting to ready/synced and media queue failures are visible if present.
3. Confirm the worker changes the wine status from processing to ready or a clear error state.
4. Open the wine detail. Confirm the transcript, summary, suggested details, evidence snippets, label image, and retained audio player appear when applicable.
5. Repeat once with Gemini unavailable. Confirm the original capture remains and the entry reports an error rather than being deleted.

Expected result: retrying is safe and does not create duplicate wines or duplicate journal experiences. Original audio is removed only after a successful result when **Keep original recordings** is off.

## Account continuity and privacy

1. Capture an offline photo/audio item before signing in.
2. Sign in and open Profile. Confirm the item is shown as unassigned rather than uploaded automatically.
3. Tap **Attach pending media** and confirm it uploads only to the signed-in account.
4. Sign out and sign in on the second device. Confirm the journal and private farm history appear without exposing another account's queue.
5. Export the journal and confirm the JSON contains journal metadata and media references, not raw binary media.

## Deletion and recovery

1. Open an experience, add an at-home reflection, and correct a wine name.
2. Delete the experience and confirm the destructive confirmation copy is shown.
3. Verify the experience, nested wines/reflections, processing jobs, and Storage media are gone from the staging account.
4. Reopen the app and confirm the deleted item does not return from local or cloud hydration.

## Acceptance record

Record: device/browser, test account, commit/preview URL, Firebase project, pass/fail per section, screenshots of any failure, and whether the failure is reproducible offline, online, or only on one mobile browser. A pilot is not accepted until both Android and iPhone complete the core flow without data loss.
