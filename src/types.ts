export type UploadMode = "references" | "photos";

export type EventWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  status: "active";
  hostName?: string;
  contactEmail?: string;
  signupOpen?: boolean;
  guestCount?: number;
  photoCount?: number;
  reviewCount?: number;
};

export type EventSettings = Pick<EventWorkspace, "name" | "hostName" | "contactEmail" | "signupOpen">;

export type FaceBox = { left: number; top: number; width: number; height: number };

export type Person = {
  id: string;
  name: string;
  referenceCount: number;
  photoCount: number;
  initials: string;
  consentStatus?: "captured" | "unknown";
  consentSource?: string;
  consentCapturedAt?: string;
  referencePreviewUrl?: string;
  galleryEnabled?: boolean;
  deletionPending?: boolean;
  galleryExpiresAt?: number;
};

export type MatchStatus =
  | "matched"
  | "suggested"
  | "needs_review"
  | "approved"
  | "rejected"
  | "unknown";

export type DecisionStatus = Extract<MatchStatus, "approved" | "rejected">;

export type PhotoMatch = {
  personId: string;
  personName: string;
  confidence?: number;
  source?: "face_match" | "manual";
  status: MatchStatus;
  reviewedAt?: string;
  faceBox?: FaceBox;
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
  warnings?: string[];
};

export type LibraryResult = UploadResult & {
  event?: EventWorkspace;
  events?: EventWorkspace[];
};

export type RematchResult = { match: PhotoMatch | null; outcome: "suggested" | "no_new_match" | "kept_decision" };
export type GalleryPhoto = Pick<PhotoAsset, "id" | "name" | "previewUrl">;
export type GuestGallery = { eventName: string; guestName: string; hostName: string; contactEmail: string; expiresAt: number; photos: GalleryPhoto[] };
export type GalleryLink = { galleryUrl: string; expiresAt: number; person: Person };
