import type { EventWorkspace, Person, PhotoAsset } from "./types";

/** Local portraits, so the sample workspace never needs a network request. */
export const samplePortraits = {
  ava: {
    alt: "Portrait of a woman with long brown hair in a striped shirt, outdoors at dusk",
    filename: "sample-ava.jpg",
    src: "/images/sample-ava.jpg",
  },
  maya: {
    alt: "Portrait of a laughing woman with dark wavy hair in a red top",
    filename: "sample-maya.jpg",
    src: "/images/sample-maya.jpg",
  },
  noah: {
    alt: "Portrait of a smiling man with short dark hair in a charcoal jacket at an outdoor reception",
    filename: "sample-noah-reception.jpg",
    src: "/images/sample-noah-reception.jpg",
  },
};

export const sampleEventId = "event-sample-gala";

export type SampleData = {
  event: EventWorkspace;
  people: Person[];
  photos: PhotoAsset[];
};

/** Fresh copy each call so the demo can be reset without leaking edits. */
export function createSampleData(): SampleData {
  const now = Date.now();

  return {
    event: {
      id: sampleEventId,
      name: "The garden reception",
      hostName: "Sample studio",
      signupOpen: true,
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      status: "active",
    },
    people: [
      {
        id: "person-sample-ava",
        name: "Ava Morales",
        initials: "AM",
        referenceCount: 1,
        photoCount: 1,
        consentStatus: "captured",
        consentSource: "owner_attested",
        consentCapturedAt: new Date(now - 1000 * 60 * 80).toISOString(),
        referencePreviewUrl: samplePortraits.ava.src,
      },
      {
        id: "person-sample-maya",
        name: "Maya Johnson",
        initials: "MJ",
        referenceCount: 1,
        photoCount: 1,
        consentStatus: "captured",
        consentSource: "owner_attested",
        consentCapturedAt: new Date(now - 1000 * 60 * 80).toISOString(),
        referencePreviewUrl: samplePortraits.maya.src,
      },
      {
        id: "person-sample-noah",
        name: "Noah Kim",
        initials: "NK",
        referenceCount: 1,
        photoCount: 1,
        consentStatus: "captured",
        consentSource: "owner_attested",
        consentCapturedAt: new Date(now - 1000 * 60 * 80).toISOString(),
        referencePreviewUrl: samplePortraits.noah.src,
      },
    ],
    photos: [
      {
        id: "photo-sample-arrivals",
        name: "sample-noah-garden.jpg",
        size: 0,
        uploadedAt: new Date(now - 1000 * 60 * 5).toISOString(),
        previewUrl: "/images/sample-noah-garden.jpg",
        matches: [
          {
            personId: "person-sample-noah",
            personName: "Noah Kim",
            confidence: 91.7,
            status: "matched",
            faceBox: { left: 0.23, top: 0.12, width: 0.155, height: 0.25 },
          },
        ],
      },
      {
        id: "photo-sample-garden",
        name: samplePortraits.ava.filename,
        size: 0,
        uploadedAt: new Date(now - 1000 * 60 * 14).toISOString(),
        previewUrl: samplePortraits.ava.src,
        matches: [
          {
            personId: "person-sample-ava",
            personName: "Ava Morales",
            confidence: 84.6,
            status: "needs_review",
          },
        ],
      },
      {
        id: "photo-sample-stage",
        name: samplePortraits.maya.filename,
        size: 0,
        uploadedAt: new Date(now - 1000 * 60 * 33).toISOString(),
        previewUrl: samplePortraits.maya.src,
        matches: [
          {
            personId: "person-sample-maya",
            personName: "Maya Johnson",
            confidence: 96.2,
            status: "matched",
          },
        ],
      },
    ],
  };
}
