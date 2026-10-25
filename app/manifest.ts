import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bouldero",
    short_name: "Bouldero",
    description: "One hold at a time.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5ef",
    theme_color: "#f6f5ef",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
