import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Wine Experience",
    short_name: "My Wine",
    description: "Enjoy the tasting now. Remember what mattered later.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f1e9",
    theme_color: "#6d3040",
    orientation: "portrait",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
