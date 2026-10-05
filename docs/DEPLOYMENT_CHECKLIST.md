# My Wine Experience deployment checklist

For the remaining account- and device-dependent work, follow [`EXTERNAL_RELEASE_STEPS.md`](./EXTERNAL_RELEASE_STEPS.md).

## Current verified state

Production is currently running from the `wine-experience-b8864` Firebase project and the `master` branch of the connected Vercel project. Production secrets are configured server-side only. Preview and development do not inherit production Maps/Gemini secrets; configure them only after a separate staging Firebase project is available.

## Firebase

- [ ] Create a separate staging/development Firebase project. *(Production project is `wine-experience-b8864`; staging remains pending.)*
- [x] Register the production Web App. *(The staging Web App remains pending until the staging project exists.)*
- [x] Enable Email/Password and passwordless email link providers. *(Apple sign-in is intentionally excluded from this build.)*
- [x] Create Firestore in Native mode and choose a region.
- [x] Create Cloud Storage and choose a matching region where possible.
- [x] Add localhost, preview, and production domains to Firebase Auth authorized domains.
- [x] Deploy `firestore.rules`, `firestore.indexes.json`, and `storage.rules`.
- [x] Test the rules against emulator data before using production data. (`npm run test:rules`)

## Google Cloud / Maps

- [x] Use the existing `Smile and Whistle` Google Cloud project with billing enabled.
- [x] Enable Places API (New).
- [x] Use the existing restricted server-side Maps key for Wine Experience.
- [x] Add Places API (New) to that key's API restrictions.
- [x] Confirm quota alerts and budget alerts. *(Owner confirmed configured.)*

## Gemini

- [x] Import/select the shared `Smile and Whistle` Google Cloud project in Google AI Studio.
- [x] Create a restricted Gemini API key.
- [x] Choose the production model and record it as `GEMINI_MODEL`.
- [x] Generate a high-entropy `ENRICHMENT_JOB_SECRET`.
- [x] Choose Firebase Functions as the trusted worker.
- [x] Firebase Functions worker is implemented in `functions/src/index.ts`; configure it to call the deployed `/api/enrich` endpoint and deploy it.
- [x] Set `ENRICHMENT_ENDPOINT_URL` in the Functions runtime and the same `ENRICHMENT_JOB_SECRET` in Firebase Secret Manager and the web host.
- [x] Define retry, idempotency, and failed-processing behavior before real users.

## Vercel / GitHub

- [x] Connect the repository to Vercel.
- [ ] Add non-production environment variables against a separate staging Firebase project. *(Production variables are configured; production secrets are not copied to Preview/Development.)*
- [x] Keep `NEXT_PUBLIC_FIREBASE_*` values public configuration only; keep Maps, Gemini, and job secrets server-only.
- [x] Add the production domain and preview domain to Firebase Auth.
- [x] Confirm GitHub Actions is green on the current `master` production branch.
- [ ] Deploy a preview and manually test the complete phone-sized capture flow.

## Required environment variables

See `.env.example` and `.env.gemini.example`. Verify without printing values:

```bash
npm run check:env
npm run check:env:strict
```

## Pilot acceptance pass

Use [the detailed pilot script](./PILOT_TEST_SCRIPT.md) and a staging Firebase project before production.

- [ ] Sign in to the PWA in a mobile browser on Android.
- [ ] Start a tasting with no network.
- [ ] Capture three wines with reactions, including one photo and one recording.
- [ ] End the experience offline and reconnect later.
- [ ] Confirm queued media uploads and paths appear in Firestore.
- [ ] Confirm enrichment failure preserves the original capture.
- [ ] Confirm a Loved it wine appears in Buy Again.
- [ ] Add an at-home reflection and correct a wine name.
- [ ] Export the journal.
- [ ] Delete an experience and verify its nested records and media are removed.

The pilot validates the responsive PWA in mobile browsers; native Android and iOS apps are not part of this release.
