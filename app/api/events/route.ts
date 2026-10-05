import { NextResponse } from "next/server";

const events = new Set([
  "experience_started",
  "experience_completed",
  "wine_saved",
  "media_queued",
  "media_upload_completed",
  "media_upload_failed",
  "suggestion_reviewed",
  "offline_sync_recovered",
]);

export async function POST(request: Request) {
  let body: { event?: unknown; details?: unknown };
  try {
    body = await request.json() as { event?: unknown; details?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }
  if (typeof body.event !== "string" || !events.has(body.event)) {
    return NextResponse.json({ error: "Unsupported event." }, { status: 400 });
  }
  // Keep production logs useful without accepting private journal content.
  console.info("wine_experience_event", body.event, body.details ?? undefined);
  return new NextResponse(null, { status: 204 });
}
