# Enrichment worker

`functions/src/index.ts` is the trusted Firebase Functions worker for queued wine enrichment.

It listens for `users/{userId}/processingJobs/{jobId}` documents, verifies the job belongs to the path user, reads the referenced Storage media, calls the deployed Next.js `/api/enrich` route, and writes the structured result back to the wine entry. It retries failures up to three times. When processing succeeds, original audio is deleted unless the wine's `retainAudio` flag is true.

## Configure and deploy

1. Deploy the Next.js app first and provide `ENRICHMENT_ENDPOINT_URL` as the Firebase Functions parameter, using its absolute `/api/enrich` URL.
2. Set the same high-entropy `ENRICHMENT_JOB_SECRET` in Vercel and Firebase Secret Manager:

```bash
firebase functions:secrets:set ENRICHMENT_JOB_SECRET
```

3. Install and build the worker:

```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

The first deployment prompts for the `ENRICHMENT_ENDPOINT_URL` parameter. Use a separate endpoint for each Firebase environment.

Use separate secrets and Firebase projects for preview/staging and production. The worker never exposes Firebase Admin credentials or the Gemini key to the browser.
