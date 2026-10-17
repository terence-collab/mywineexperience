import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kept · Wine memories, kept close.",
    short_name: "Kept",
    description: "A private digital cellar for the bottles, places, and moments worth remembering.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f1e9",
    theme_color: "#6d3040",
    orientation: "portrait",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
