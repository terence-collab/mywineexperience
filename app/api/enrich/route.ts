import { NextResponse } from "next/server";

const maxInlineBytes = 20 * 1024 * 1024;

const wineSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "A faithful transcript or empty string when no audio was supplied." },
    name: { type: "string", description: "Best-supported wine name, or empty string when unknown." },
    producer: { type: "string", description: "Producer or farm name, or empty string when unknown." },
    varietal: { type: "string", description: "Grape variety or wine type, or empty string when unknown." },
    vintage: { type: "string", description: "Vintage year, or empty string when unknown." },
    summary: { type: "string", description: "Short evidence-supported summary of the host description." },
    evidence: { type: "array", items: { type: "string" }, description: "Short source snippets supporting the extracted fields." },
  },
  required: ["transcript", "name", "producer", "varietal", "vintage", "summary", "evidence"],
};

type EnrichmentRequest = {
  transcriptHint?: string;
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

  const input = [
    { type: "text", text: `Extract only details supported by the supplied evidence. Never invent a wine name or vintage. ${body.transcriptHint ? `Existing user hint: ${body.transcriptHint}` : ""}` },
    ...media.map((item) => ({ type: item.mimeType.startsWith("audio/") ? "audio" : "image", data: item.data, mime_type: item.mimeType })),
  ];

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash", input, response_format: { type: "text", mime_type: "application/json", schema: wineSchema } }),
  });
  if (!response.ok) return NextResponse.json({ error: "Gemini enrichment failed.", providerStatus: response.status }, { status: 502 });
  const result = await response.json() as { output_text?: string };
  try { return NextResponse.json({ extraction: JSON.parse(result.output_text ?? "{}"), model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" }); }
  catch { return NextResponse.json({ error: "Gemini returned an invalid structured response." }, { status: 502 }); }
}
