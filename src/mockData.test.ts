import { describe, expect, it } from "vitest";
import { createSampleData, samplePortraits } from "./mockData";

describe("sample photo labels", () => {
  it("uses the displayed asset filename in the landing page and demo", () => {
    const portraits = Object.values(samplePortraits);
    const { photos } = createSampleData();

    expect(photos).toHaveLength(portraits.length);
    for (const portrait of portraits) {
      expect(portrait.src).toBe(`/images/${portrait.filename}`);
      expect(photos.find((photo) => photo.previewUrl === portrait.src)?.name).toBe(
        portrait.filename,
      );
    }
  });
});
