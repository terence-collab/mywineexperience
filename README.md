# My Wine Experience

Phone-first private wine-tasting journal for capturing the place, the pour, and the wines worth remembering.

## What is implemented

- Map home with curated Western Cape farms and a server-side Google Places search boundary.
- Start and active experience flow with a seven-wine limit.
- Reaction capture: Loved it, Liked it, or Not for me.
- Mobile microphone and camera capture with local-first status and IndexedDB media queue.
- Offline-safe local journal persistence, export, deletion, completed experience history, and wine reflections.
- Firebase Authentication UI for email/password and Apple sign-in.
- Firestore and Storage helpers, security rules, indexes, and deploy configuration.
- Server-only Gemini enrichment route with structured wine extraction.
- Firebase Functions enrichment worker with retries, Storage media reads, and audio-retention cleanup.
- Installable PWA manifest.

## Local setup

Requires Node.js 22 or newer.

```bash
npm install
npx next dev
```

The app works without cloud credentials using the local-first journal. Copy `.env.example` to `.env.local` when connecting Firebase and Maps. Keep Gemini server variables in a server-only environment file; never prefix them with `NEXT_PUBLIC_`.

Check configuration without revealing any values:

```bash
npm run check:env
npm run check:env:strict
```

For local Firebase integration testing, install the Firebase CLI, start the emulators, and set `NEXT_PUBLIC_FIREBASE_EMULATORS=true` in `.env.local`:

```bash
firebase emulators:start
```

The configured local services are Auth on `9099`, Firestore on `8080`, Storage on `9199`, and the Emulator UI on `4000`. Keep emulator mode disabled for preview and production.

## Cloud configuration

1. Create or select a Firebase project and copy the project ID into a local `.firebaserc` based on `.firebaserc.example`.
2. Create a Firebase Web App and provide its values through the `NEXT_PUBLIC_FIREBASE_*` variables.
3. Enable Email/Password and Apple providers in Firebase Authentication. Add the deployed domain and `localhost` to authorized domains.
4. Set `GOOGLE_MAPS_SERVER_API_KEY` with Places API (New) Text Search enabled.
5. Set server-only `GEMINI_API_KEY`, optional `GEMINI_MODEL`, and `ENRICHMENT_JOB_SECRET`.
6. Set the Functions parameter `ENRICHMENT_ENDPOINT_URL` to the deployed `/api/enrich` URL, store the same `ENRICHMENT_JOB_SECRET` with Firebase Secret Manager, and deploy it:

```bash
firebase functions:secrets:set ENRICHMENT_JOB_SECRET
cd functions && npm install && npm run build && cd ..
npx -y firebase-tools@latest deploy --only functions
```

7. Review and deploy the versioned rules and indexes:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes,storage
```

Remote provisioning and deployment require the project owner's Firebase project ID, billing/location choices, and credentials.

See [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) for the complete Firebase, Maps, Gemini, Vercel, and real-device pilot handoff.

## Verification

```bash
npm run lint
npx next build
```

The supported local production check is `npx next build`. The starter's Vinext/Cloudflare wrapper may not run on every host architecture because its `workerd` binary is platform-specific.

GitHub Actions runs the same lint and build/test checks on pushes to `main` and pull requests. The repository also includes a pull-request checklist covering screenshots, privacy, Firebase rules, indexes, and environment changes.

## Important routes

- `/` — product shell and capture flow
- `/manifest.webmanifest` — PWA metadata
- `/api/farms/search?q=...` — Google Places boundary with curated fallback
- `/api/enrich` — trusted server job boundary for Gemini enrichment
