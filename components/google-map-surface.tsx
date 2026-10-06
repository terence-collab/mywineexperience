"use client";

import { useEffect, useRef, useState } from "react";

type Coordinate = { latitude: number; longitude: number };
export type MapFarm = { name: string; town: string; top: string; left: string; location?: Coordinate; visited?: boolean; favourite?: boolean };
type GoogleMap = { panTo: (position: { lat: number; lng: number }) => void; setZoom: (zoom: number) => void };
type GoogleMarker = { setMap: (map: GoogleMap | null) => void; addListener: (event: string, callback: () => void) => void };
type GoogleNamespace = { maps: { Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap; Marker: new (options: Record<string, unknown>) => GoogleMarker } };

let mapsLoader: Promise<GoogleNamespace | null> | undefined;

function loadGoogleMaps(apiKey: string) {
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve) => {
    const existing = document.getElementById("google-maps-js") as HTMLScriptElement | null;
    if (existing) {
      const currentGoogle = (window as unknown as { google?: GoogleNamespace }).google;
      if (currentGoogle?.maps?.Map) {
        resolve(currentGoogle);
        return;
      }
      existing.addEventListener("load", () => resolve((window as unknown as { google?: GoogleNamespace }).google ?? null), { once: true });
      return;
    }
    const callbackName = "__wineExperienceMapsReady";
    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      resolve((window as unknown as { google?: GoogleNamespace }).google ?? null);
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
    const script = document.createElement("script");
    script.id = "google-maps-js";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=${callbackName}`;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return mapsLoader;
}

export function GoogleMapSurface({ farms, selectedFarm, onSelect }: { farms: MapFarm[]; selectedFarm: MapFarm; onSelect: (farm: MapFarm) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMap | undefined>(undefined);
  const markersRef = useRef<GoogleMarker[]>([]);
  const onSelectRef = useRef(onSelect);
  const [mapState, setMapState] = useState<"loading" | "ready" | "fallback">("loading");
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;
    if (!apiKey || !mapElement.current) { setMapState("fallback"); return; }
    let cancelled = false;
    void loadGoogleMaps(apiKey).then(async (google) => {
      if (cancelled || !google || !mapElement.current) { if (!cancelled) setMapState("fallback"); return; }
      try {
        mapRef.current = new google.maps.Map(mapElement.current, {
          center: { lat: -33.86, lng: 18.82 }, zoom: 10, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative",
          styles: [
            { elementType: "geometry", stylers: [{ color: "#ebe8dd" }] },
            { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#d6ddc7" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9d5cf" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#f9f5eb" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dfcfb8" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#713247" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#ebe8dd" }] },
          ],
        });
        setMapState("ready");
      } catch {
        if (!cancelled) setMapState("fallback");
      }
    }).catch(() => { if (!cancelled) setMapState("fallback"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const google = (window as unknown as { google?: GoogleNamespace }).google;
    if (!mapRef.current || !google) return;
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = farms.filter((farm) => farm.location).map((farm) => {
      const marker = new google.maps.Marker({
        map: mapRef.current, position: { lat: farm.location!.latitude, lng: farm.location!.longitude }, title: farm.name,
        label: { text: "●", color: farm.favourite ? "#713247" : "#8d9678", fontSize: "24px" },
      });
      marker.addListener("click", () => onSelectRef.current(farm));
      return marker;
    });
  }, [farms, mapState]);

  useEffect(() => {
    if (!mapRef.current || !selectedFarm.location) return;
    mapRef.current.panTo({ lat: selectedFarm.location.latitude, lng: selectedFarm.location.longitude });
    mapRef.current.setZoom(13);
  }, [selectedFarm]);

  if (mapState === "fallback") return (
    <div className="map-art" aria-label="Wine country map preview">
      <div className="map-lines line-one" /><div className="map-lines line-two" />
      {farms.map((farm) => <button key={farm.name} className={`map-pin ${selectedFarm.name === farm.name ? "active" : ""} ${farm.visited ? "visited" : ""} ${farm.favourite ? "favourite" : ""}`} style={{ top: farm.top, left: farm.left }} onClick={() => onSelect(farm)}><span className="pin-dot" /><span>{farm.name}</span></button>)}
    </div>
  );

  return <div ref={mapElement} className="google-map-surface" aria-label="Google Map of wine country" />;
}
