const publicFirebase = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];
const serverServices = ["GOOGLE_MAPS_SERVER_API_KEY", "GEMINI_API_KEY", "ENRICHMENT_JOB_SECRET"];
const strict = process.argv.includes("--strict");
const groups = [
  ["Firebase web app", publicFirebase],
  ["Server integrations", serverServices],
];
let missing = 0;

for (const [label, keys] of groups) {
  console.log(`\n${label}`);
  for (const key of keys) {
    const present = Boolean(process.env[key]?.trim());
    console.log(`${present ? "OK" : "--"} ${key}`);
    if (!present) missing += 1;
  }
}

if (missing) {
  console.log(`\n${missing} value(s) missing.`);
  console.log(strict ? "Strict mode: configuration is incomplete." : "Local-only mode is still available. Copy the example files before connecting cloud services.");
  if (strict) process.exitCode = 1;
} else {
  console.log("\nAll application environment values are present.");
}
