import type { Hold } from "./types";
export function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
// Coordinates belong to the un-cropped image, never its viewport or outer card.
export function normalize(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
) {
  return {
    x: clamp((clientX - bounds.left) / bounds.width),
    y: clamp((clientY - bounds.top) / bounds.height),
  };
}
export function reorder(holds: Hold[]): Hold[] {
  return holds.map((hold, index) => ({
    ...hold,
    order_index: index + 1,
    is_top: hold.is_top && index === holds.length - 1,
  }));
}
