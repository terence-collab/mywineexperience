# My Wine Experience deployment checklist

## Firebase

- [ ] Create separate development and production Firebase projects.
- [ ] Register a Web App in each project.
- [ ] Enable Email/Password, passwordless email link, and Apple providers.
- [ ] Configure Apple Service ID, Team ID, key ID, private key, and Firebase return URL.
- [ ] Create Firestore in Native mode and choose a region.
- [ ] Create Cloud Storage and choose a matching region where possible.
- [ ] Add localhost, preview, and production domains to Firebase Auth authorized domains.
- [ ] Deploy `firestore.rules`, `firestore.indexes.json`, and `storage.rules`.
- [ ] Test the rules against emulator data before using production data.

## Google Cloud / Maps

- [ ] Select a Google Cloud project with billing enabled.
- [ ] Enable Places API (New).
- [ ] Create a restricted server-side Maps key.
- [ ] Restrict the key to Places API (New) and the expected deployment usage.
- [ ] Confirm quota alerts and budget alerts.

## Gemini

- [ ] Import/select the Google Cloud project in Google AI Studio.
- [ ] Create a restricted Gemini API key.
- [ ] Choose the production model and record it as `GEMINI_MODEL`.
- [ ] Generate a high-entropy `ENRICHMENT_JOB_SECRET`.
- [ ] Choose the trusted worker: Firebase Functions, Cloud Run, or another queue worker.
- [x] Firebase Functions worker is implemented in `functions/src/index.ts`; configure it to call the deployed `/api/enrich` endpoint and deploy it.
- [ ] Set `ENRICHMENT_ENDPOINT_URL` in the Functions runtime and the same `ENRICHMENT_JOB_SECRET` in Firebase Secret Manager and the web host.
- [ ] Define retry, idempotency, and failed-processing behavior before real users.

## Vercel / GitHub

- [ ] Connect the repository to Vercel.
- [ ] Add environment variables separately for Development, Preview, and Production.
- [ ] Keep `NEXT_PUBLIC_FIREBASE_*` values public configuration only; keep Maps, Gemini, and job secrets server-only.
- [ ] Add the production domain and preview domain to Firebase Auth.
- [ ] Confirm GitHub Actions is green before enabling protected `main`.
- [ ] Deploy a preview and manually test the complete phone-sized capture flow.

## Required environment variables

See `.env.example` and `.env.gemini.example`. Verify without printing values:

```bash
npm run check:env
npm run check:env:strict
```

## Pilot acceptance pass

Use [the detailed pilot script](./PILOT_TEST_SCRIPT.md) and a staging Firebase project before production.

- [ ] Sign in on a real Android phone.
- [ ] Start a tasting with no network.
- [ ] Capture three wines with reactions, including one photo and one recording.
- [ ] End the experience offline and reconnect later.
- [ ] Confirm queued media uploads and paths appear in Firestore.
- [ ] Confirm enrichment failure preserves the original capture.
- [ ] Confirm a Loved it wine appears in Buy Again.
- [ ] Add an at-home reflection and correct a wine name.
- [ ] Export the journal.
- [ ] Delete an experience and verify its nested records and media are removed.
