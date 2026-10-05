# External release steps

These are the remaining account- and device-dependent steps for the first real pilot. Production currently uses Firebase project `wine-experience-b8864`; the shared Google Maps/Gemini project is `smile-and-whistle`.

## 1. Create an isolated staging Firebase project

Do not use the shared `Smile and Whistle` Firebase project for staging unless you have confirmed that it contains no unrelated application data. Create a new Firebase project instead, for example `wine-experience-staging`.

In the Firebase console:

1. Create the project and enable billing if required by the selected services.
2. Register a Web App and copy its public Firebase configuration.
3. Enable Email/Password, passwordless email-link, and Google sign-in. Apple sign-in is intentionally not part of this build.
4. Create Firestore and Storage in the required region.
5. Deploy the checked-in rules and indexes:

   ```text
   firebase use wine-experience-staging
   firebase deploy --only firestore:rules,firestore:indexes,storage --project wine-experience-staging
   ```

6. Deploy the enrichment worker only after setting a staging endpoint and a staging-only `ENRICHMENT_JOB_SECRET`.
7. Add the staging Vercel preview domain and localhost to Firebase Authentication authorized domains.
8. Add the staging Firebase public variables to Vercel Preview/Development only. Do not copy production Maps, Gemini, or worker secrets into Preview/Development.

Firebase recommends a separate project for every environment so staging data and credentials cannot affect production:
<https://firebase.google.com/docs/projects/dev-workflows/overview-environments>

## 2. Add Google Cloud cost protection

In the Google Cloud console, select the `Smile and Whistle` billing account and create an **alerts-only** monthly budget scoped to the project or services used by this app.

Recommended starting thresholds are 50%, 75%, 90%, and 100%, with billing-account administrators receiving the email notifications. A budget alert monitors spend; it is not a hard spending cap.

Official instructions:
<https://cloud.google.com/billing/docs/how-to/budgets>

Also review API quotas for Places and Gemini and set conservative per-minute/day limits appropriate for a personal pilot. Record the chosen limits in the pilot notes.

## 3. Run the PWA browser pilot

Use `docs/PILOT_TEST_SCRIPT.md` and record the device, mobile browser, commit, environment, and pass/fail result. This validates the responsive PWA in mobile browsers; native Android and iOS apps are not part of this release.

At minimum verify:

- sign-in and farm search;
- offline start and three wine captures;
- one photo, one recording, and all three reactions;
- offline completion and later sync;
- enrichment success and enrichment failure preservation;
- name correction and at-home reflection;
- export;
- experience deletion and associated media deletion.

## Current boundary

Local code, production deployment, production Firebase services, rules tests, CI, Maps search, protected enrichment, and the owner-confirmed billing alerts are verified. Staging creation and PWA mobile-browser behavior remain intentionally unchecked until the external steps above are completed.
