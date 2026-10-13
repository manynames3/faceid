import type { FaceBox } from "./types";

/** Map normalized face coordinates into the visible, uncropped image, excluding letterboxing. */
export function containedFaceBox(box: FaceBox, image: { width: number; height: number }, frame: { width: number; height: number }) {
  if (![...Object.values(box), image.width, image.height, frame.width, frame.height].every(Number.isFinite) || image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(1, box.left + box.width);
  const bottom = Math.min(1, box.top + box.height);
  if (right <= left || bottom <= top) return null;
  return { left: (frame.width - width) / 2 + left * width, top: (frame.height - height) / 2 + top * height, width: (right - left) * width, height: (bottom - top) * height };
}
