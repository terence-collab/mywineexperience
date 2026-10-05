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

  // The shared Smile and Whistle credential is restricted to the legacy
  // Places API, so use its server-side Text Search endpoint here. Keeping the
  // provider behind this route means the client never receives the key and we
  // can migrate to Places API (New) later without changing the UI contract.
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  endpoint.searchParams.set("query", `${query} wine farm Western Cape South Africa`);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("region", "za");
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    const providerError = (await response.text()).slice(0, 500);
    console.warn("Places API request failed", { status: response.status, providerError });
    return NextResponse.json({ farms: fallbackFarms, source: "curated", warning: "Places search unavailable" });
  }
  const data = await response.json() as {
    status?: string;
    error_message?: string;
    results?: {
      place_id?: string;
      name?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }[];
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn("Places API request failed", { status: data.status, providerError: data.error_message });
    return NextResponse.json({ farms: fallbackFarms, source: "curated", warning: "Places search unavailable" });
  }
  const farms = (data.results ?? []).map((place) => {
    const addressParts = place.formatted_address?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
    const location = place.geometry?.location;
    return {
      id: place.place_id ?? crypto.randomUUID(),
      name: place.name ?? "Unnamed place",
      town: addressParts[1] ?? addressParts[0] ?? "Western Cape",
      province: "Western Cape",
      source: "google_places",
      location: location?.lat !== undefined && location.lng !== undefined
        ? { latitude: location.lat, longitude: location.lng }
        : undefined,
    };
  });
  return NextResponse.json({ farms, source: "google_places" });
}
