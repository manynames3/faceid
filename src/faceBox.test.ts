import { describe, expect, it } from "vitest";
import { containedFaceBox } from "./faceBox";

describe("face outlines on uncropped images", () => {
  const box = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 };
  it("accounts for horizontal letterboxing on portrait photos", () => {
    expect(containedFaceBox(box, { width: 200, height: 400 }, { width: 400, height: 400 })).toEqual({ left: 150, top: 100, width: 100, height: 200 });
  });
  it("accounts for vertical letterboxing on group photos", () => {
    expect(containedFaceBox(box, { width: 600, height: 300 }, { width: 300, height: 300 })).toEqual({ left: 75, top: 112.5, width: 150, height: 75 });
  });
  it("clips out-of-frame coordinates and rejects invalid dimensions", () => {
    expect(containedFaceBox({ left: -0.1, top: 0, width: 0.3, height: 1 }, { width: 100, height: 100 }, { width: 100, height: 100 })?.width).toBeCloseTo(20);
    expect(containedFaceBox(box, { width: 0, height: 100 }, { width: 100, height: 100 })).toBeNull();
    expect(containedFaceBox({ ...box, left: NaN }, { width: 100, height: 100 }, { width: 100, height: 100 })).toBeNull();
    expect(containedFaceBox({ ...box, left: 2 }, { width: 100, height: 100 }, { width: 100, height: 100 })).toBeNull();
  });
});
