export type UploadMode = "references" | "photos";

export type Person = {
  id: string;
  name: string;
  referenceCount: number;
  photoCount: number;
  initials: string;
};

export type MatchStatus = "matched" | "review" | "unknown";

export type PhotoMatch = {
  personId: string;
  personName: string;
  confidence: number;
  status: MatchStatus;
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
