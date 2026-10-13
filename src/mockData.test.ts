import { describe, expect, it } from "vitest";
import { createSampleData, samplePortraits } from "./mockData";

describe("sample photo labels", () => {
  it("uses the displayed asset filename in the landing page and demo", () => {
    const portraits = Object.values(samplePortraits);
    const { photos } = createSampleData();

    expect(photos).toHaveLength(portraits.length);
    for (const portrait of portraits) {
      expect(portrait.src).toBe(`/images/${portrait.filename}`);
    }
    for (const photo of photos) expect(photo.previewUrl).toBe(`/images/${photo.name}`);
  });
  it("shows a different event photo and reference for the group-photo example", () => {
    const { photos, people } = createSampleData();
    const noah = people.find(person => person.name === "Noah Kim")!;
    const eventPhoto = photos.find(photo => photo.matches.some(match => match.personId === noah.id))!;
    expect(eventPhoto.previewUrl).not.toBe(noah.referencePreviewUrl);
    expect(eventPhoto.matches[0].faceBox).toBeDefined();
  });
});
