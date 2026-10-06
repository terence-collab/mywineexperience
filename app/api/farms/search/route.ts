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

  // Keep the provider behind this route so the server key never reaches the
  // browser. Places API (New) uses POST + X-Goog-FieldMask rather than the
  // legacy GET endpoint used previously.
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery: `${query} wine farm Western Cape South Africa`,
      languageCode: "en",
      regionCode: "ZA",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const providerError = (await response.text()).slice(0, 500);
    console.warn("Places API request failed", { status: response.status, providerError });
    return NextResponse.json({ farms: fallbackFarms, source: "curated", warning: "Places search unavailable" });
  }

  const data = await response.json() as {
    error?: { message?: string };
    places?: {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }[];
  };
  const farms = (data.places ?? []).map((place) => {
    const addressParts = place.formattedAddress?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
    const location = place.location;
    return {
      id: place.id ?? crypto.randomUUID(),
      name: place.displayName?.text ?? "Unnamed place",
      town: addressParts.at(-2) ?? addressParts[0] ?? "Western Cape",
      province: "Western Cape",
      source: "google_places",
      location: location?.latitude !== undefined && location.longitude !== undefined
        ? { latitude: location.latitude, longitude: location.longitude }
        : undefined,
    };
  });
  return NextResponse.json({ farms, source: "google_places" });
}
