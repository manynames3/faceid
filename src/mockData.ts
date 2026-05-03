import type { Person, PhotoAsset } from "./types";

export const initialPeople: Person[] = [
  {
    id: "person-ava-morales",
    name: "Ava Morales",
    initials: "AM",
    referenceCount: 3,
    photoCount: 8,
  },
  {
    id: "person-noah-kim",
    name: "Noah Kim",
    initials: "NK",
    referenceCount: 2,
    photoCount: 5,
  },
  {
    id: "person-maya-johnson",
    name: "Maya Johnson",
    initials: "MJ",
    referenceCount: 4,
    photoCount: 11,
  },
];

export const initialPhotos: PhotoAsset[] = [
  {
    id: "photo-001",
    name: "reception-041.jpg",
    size: 2_412_000,
    uploadedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    previewUrl:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80",
    matches: [
      {
        personId: "person-ava-morales",
        personName: "Ava Morales",
        confidence: 98.4,
        status: "matched",
      },
      {
        personId: "person-noah-kim",
        personName: "Noah Kim",
        confidence: 91.7,
        status: "matched",
      },
    ],
  },
  {
    id: "photo-002",
    name: "dance-floor-118.jpg",
    size: 3_810_000,
    uploadedAt: new Date(Date.now() - 1000 * 60 * 33).toISOString(),
    previewUrl:
      "https://images.unsplash.com/photo-1529634806980-85c3dd6d34ac?auto=format&fit=crop&w=900&q=80",
    matches: [
      {
        personId: "person-maya-johnson",
        personName: "Maya Johnson",
        confidence: 96.2,
        status: "matched",
      },
    ],
  },
  {
    id: "photo-003",
    name: "table-portraits-022.jpg",
    size: 1_921_000,
    uploadedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    previewUrl:
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=900&q=80",
    matches: [
      {
        personId: "person-ava-morales",
        personName: "Ava Morales",
        confidence: 84.6,
        status: "review",
      },
    ],
  },
];
