import { NextResponse } from "next/server";

const maxInlineBytes = 20 * 1024 * 1024;
const extractionVersion = "wine-extraction-v1";

const wineSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "A faithful transcript or empty string when no audio was supplied." },
    name: { type: "string", description: "Best-supported wine name, or empty string when unknown." },
    producer: { type: "string", description: "Producer or farm name, or empty string when unknown." },
    varietal: { type: "string", description: "Grape variety or wine type, or empty string when unknown." },
    wineType: { type: "string", description: "Broad wine type: red, white, sparkling, rosé, fortified, dessert, other, or empty string when unknown." },
    vintage: { type: "string", description: "Vintage year, or empty string when unknown." },
    region: { type: "string", description: "Region or appellation only when stated in the evidence." },
    descriptors: { type: "array", items: { type: "string" }, description: "Tasting descriptors explicitly stated in the evidence." },
    winemakingDetails: { type: "array", items: { type: "string" }, description: "Winemaking details explicitly stated in the evidence." },
    foodPairings: { type: "array", items: { type: "string" }, description: "Food pairings explicitly mentioned in the evidence." },
    summary: { type: "string", description: "Short evidence-supported summary of the host description." },
    evidence: { type: "array", items: { type: "string" }, description: "Short source snippets supporting the extracted fields." },
    evidenceSources: { type: "array", items: { type: "string" }, description: "Evidence kinds used, such as ocr, transcript, or user_hint." },
  },
  required: ["transcript", "name", "producer", "varietal", "wineType", "vintage", "summary", "evidence"],
};

type EnrichmentRequest = {
  transcriptHint?: string;
  context?: { farmName?: string; farmTown?: string; capturedAt?: string };
  media?: { data: string; mimeType: string }[];
};

export async function POST(request: Request) {
  const jobSecret = process.env.ENRICHMENT_JOB_SECRET;
  if (!jobSecret || request.headers.get("x-enrichment-job-secret") !== jobSecret) {
    return NextResponse.json({ error: "Enrichment jobs require a trusted server credential." }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Gemini is not configured." }, { status: 503 });

  let body: EnrichmentRequest;
  try { body = await request.json() as EnrichmentRequest; } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const media = (body.media ?? []).filter((item) => item?.data && item?.mimeType).slice(0, 3);
  const totalBytes = media.reduce((sum, item) => sum + Math.ceil(item.data.length * 0.75), 0);
  if (totalBytes > maxInlineBytes) return NextResponse.json({ error: "Inline media exceeds the 20 MB limit; upload it through the Files API first." }, { status: 413 });
  console.info("wine_experience_event", "enrichment_started", { provider: "gemini", mediaCount: media.length });

  const input = [
    { type: "text", text: [
      "Extract only details supported by the supplied evidence. Never invent a wine name, vintage, descriptors, or technical detail.",
      "A close label image outweighs a vague spoken phrase when they conflict.",
      body.context?.farmName ? `Farm context: ${body.context.farmName}${body.context.farmTown ? `, ${body.context.farmTown}` : ""}. Use it only for disambiguation; do not fabricate a match.` : "",
      body.context?.capturedAt ? `Capture time: ${body.context.capturedAt}.` : "",
      body.transcriptHint ? `Existing user hint: ${body.transcriptHint}` : "",
    ].filter(Boolean).join(" ") },
    ...media.map((item) => ({ type: item.mimeType.startsWith("audio/") ? "audio" : "image", data: item.data, mime_type: item.mimeType })),
  ];

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash", store: false, input, response_format: { type: "text", mime_type: "application/json", schema: wineSchema } }),
  });
  if (!response.ok) {
    console.info("wine_experience_event", "enrichment_failed", { provider: "gemini", providerStatus: response.status });
    return NextResponse.json({ error: "Gemini enrichment failed.", providerStatus: response.status }, { status: 502 });
  }
  const result = await response.json() as { output_text?: string };
  try {
    const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
    console.info("wine_experience_event", "enrichment_completed", { provider: "gemini", model, extractionVersion });
    return NextResponse.json({ extraction: JSON.parse(result.output_text ?? "{}"), model, extractionVersion });
  } catch {
    console.info("wine_experience_event", "enrichment_failed", { provider: "gemini", reason: "invalid_structured_response" });
    return NextResponse.json({ error: "Gemini returned an invalid structured response." }, { status: 502 });
  }
}
