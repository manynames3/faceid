import { Loader2, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { statusLabel } from "./library";
import type { MatchStatus, Person } from "./types";
import { useModalDialog } from "./useModalDialog";

/**
 * A gallery image that loads lazily and says so plainly when it can't load
 * (signed links expire). With `onReload` it offers a retry button; leave it
 * off inside other buttons, where a nested button would be invalid.
 */
export function PhotoImage({
  alt,
  className,
  eager = false,
  onReload,
  src,
}: {
  alt: string;
  className?: string;
  eager?: boolean;
  onReload?: () => void;
  src: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (failedSrc === src) {
    return (
      <div
        className={`image-fallback ${className ?? ""}`}
        role="img"
        aria-label={`${alt} (unavailable)`}
      >
        <span>Image unavailable</span>
        {onReload && (
          <button
            className="text-button"
            onClick={() => {
              setFailedSrc(null);
              setAttempt((count) => count + 1);
              onReload();
            }}
            type="button"
          >
            Reload
          </button>
        )}
      </div>
    );
  }

  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      key={attempt}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailedSrc(src)}
      src={src}
    />
  );
}

export function Avatar({
  person,
  size = "md",
}: {
  person: Pick<Person, "initials" | "name" | "referencePreviewUrl">;
  size?: "md" | "lg";
}) {
  return (
    <span className={`avatar avatar-${size}`}>
      {person.referencePreviewUrl ? (
        <PhotoImage alt={`Reference photo of ${person.name}`} src={person.referencePreviewUrl} />
      ) : (
        <span aria-hidden="true">{person.initials}</span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: MatchStatus }) {
  const tone = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending";
  return <span className={`badge badge-${tone}`}>{statusLabel(status)}</span>;
}

export function EmptyState({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-label">
      <Loader2 aria-hidden="true" className="spin" size={16} />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Dialog({
  children,
  title,
  onClose,
  busy = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useModalDialog();
  const titleId = useId();
  return (
    <dialog
      aria-labelledby={titleId}
      className="dialog workspace-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      ref={ref}
    >
      <header className="workspace-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          aria-label="Close dialog"
          className="button button-icon button-ghost"
          disabled={busy}
          onClick={onClose}
          title="Close"
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </header>
      <div className="workspace-dialog-body">{children}</div>
    </dialog>
  );
}

/** Confirmation in a native modal: focus is trapped, Escape cancels, focus returns. */
export function ConfirmDialog({
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const ref = useModalDialog();

  return (
    <dialog
      aria-labelledby="confirm-title"
      className="dialog confirm-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      ref={ref}
    >
      <h2 id="confirm-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button autoFocus className="button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button button-danger" onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
