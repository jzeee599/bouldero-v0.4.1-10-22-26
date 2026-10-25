const lightColorNames = new Set([
  "white",
  "yellow",
  "lime",
  "beige",
  "cream",
  "silver",
  "gold",
  "pink",
  "orange",
]);

export function markerTextColor(color: string) {
  const normalized = color.trim().toLocaleLowerCase();
  if (lightColorNames.has(normalized)) return "#263024";
  const hex = normalized.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return r * 0.299 + g * 0.587 + b * 0.114 > 165
    ? "#263024"
    : "#ffffff";
}

const routeColors: Record<string, string> = {
  black: "#252a25",
  blue: "#3478c8",
  brown: "#8a5b3d",
  gray: "#858b86",
  grey: "#858b86",
  green: "#4f8b55",
  lime: "#b8dc55",
  mint: "#8fd6b7",
  orange: "#ee8b35",
  pink: "#e98ba8",
  purple: "#8463ad",
  red: "#cf4d46",
  rose: "#c96f7d",
  silver: "#b8bdbc",
  teal: "#008080",
  white: "#f5f5ef",
  yellow: "#e5cf3b",
};

export function projectMarkerColor(name: string, grade: string) {
  const colorName = name
    .replace(new RegExp(`\\s+${grade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "")
    .trim()
    .toLocaleLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(colorName)) return colorName;
  return routeColors[colorName] || routeColors[colorName.split(/\s+/).at(-1) || ""] || "#71806a";
}
