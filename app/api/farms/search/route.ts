import { NextResponse } from "next/server";

const fallbackFarms = [
  { id: "boschendal", name: "Boschendal", town: "Franschhoek", province: "Western Cape", source: "curated" },
  { id: "babylonstoren", name: "Babylonstoren", town: "Paarl", province: "Western Cape", source: "curated" },
  { id: "klein-constantia", name: "Klein Constantia", town: "Constantia", province: "Western Cape", source: "curated" },
  { id: "jordan", name: "Jordan Wine Estate", town: "Stellenbosch", province: "Western Cape", source: "curated" },
];

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (!query) return NextResponse.json({ farms: fallbackFarms, source: "curated" });

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ farms: fallbackFarms.filter((farm) => `${farm.name} ${farm.town}`.toLowerCase().includes(query.toLowerCase())), source: "curated" });
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" },
    body: JSON.stringify({ textQuery: `${query} wine farm Western Cape South Africa`, languageCode: "en", pageSize: 8 }),
  });
  if (!response.ok) return NextResponse.json({ farms: fallbackFarms, source: "curated", warning: "Places search unavailable" });
  const data = await response.json() as { places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[] };
  const farms = (data.places ?? []).map((place) => ({ id: place.id ?? crypto.randomUUID(), name: place.displayName?.text ?? "Unnamed place", town: place.formattedAddress?.split(",")[0] ?? "Western Cape", province: "Western Cape", source: "google_places", location: place.location }));
  return NextResponse.json({ farms, source: "google_places" });
}
