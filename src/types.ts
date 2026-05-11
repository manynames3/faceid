export type UploadMode = "references" | "photos";

export type EventWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  status: "active";
  guestCount?: number;
  photoCount?: number;
  reviewCount?: number;
};

export type Person = {
  id: string;
  name: string;
  referenceCount: number;
  photoCount: number;
  initials: string;
  consentStatus?: "captured" | "unknown";
};

export type MatchStatus =
  | "matched"
  | "needs_review"
  | "approved"
  | "rejected"
  | "unknown";

export type PhotoMatch = {
  personId: string;
  personName: string;
  confidence: number;
  status: MatchStatus;
  reviewedAt?: string;
};

export type PhotoAsset = {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  previewUrl: string;
  matches: PhotoMatch[];
};

export type UploadResult = {
  people: Person[];
  photos: PhotoAsset[];
};

export type LibraryResult = UploadResult & {
  event?: EventWorkspace;
  events?: EventWorkspace[];
};
