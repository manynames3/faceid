import { ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { ACCEPT_ATTRIBUTE, formatBytes, MAX_REFERENCE_FILES, validateImageFiles } from "./uploads";

export function ReferenceSelection({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <li>
      <img alt={`Selected reference ${file.name}`} ref={ref} />
      <div><strong className="truncate">{file.name}</strong><span className="meta">{formatBytes(file.size)}</span></div>
      <button aria-label={`Remove ${file.name}`} className="button button-icon button-ghost" disabled={disabled} onClick={onRemove} title="Remove photo" type="button"><X aria-hidden="true" size={17} /></button>
    </li>
  );
}

export function ReferencePhotos({ files, disabled, onChange, onIssues }: {
  files: File[]; disabled: boolean; onChange: (files: File[]) => void; onIssues: (issues: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  function add(incoming: File[]) {
    if (disabled) return;
    const unique = incoming.filter(file => !files.some(saved => saved.name === file.name && saved.size === file.size && saved.lastModified === file.lastModified));
    const result = validateImageFiles([...files, ...unique], { maxFiles: MAX_REFERENCE_FILES });
    onChange(result.accepted);
    onIssues(result.rejected.map(file => `${file.name}: ${file.reason}`));
  }
  return (
    <div className="guest-photo-picker">
      <input accept={ACCEPT_ATTRIBUTE} aria-label="Choose reference photos" className="visually-hidden" disabled={disabled} multiple onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} ref={input} tabIndex={-1} type="file" />
      {files.length > 0 && <ul aria-label="Selected reference photos" className="reference-selection">{files.map((file, index) => <ReferenceSelection disabled={disabled} file={file} key={`${file.name}-${file.lastModified}-${index}`} onRemove={() => onChange(files.filter((_, position) => position !== index))} />)}</ul>}
      {files.length < MAX_REFERENCE_FILES && (
        <div className="reference-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}>
          <ImagePlus aria-hidden="true" size={25} />
          <strong>{files.length ? "A second angle?" : "A clear photo of you"}</strong>
          <button aria-describedby={hintId} className="button" disabled={disabled} onClick={() => input.current?.click()} type="button">{files.length ? "Add another photo" : "Choose a photo"}</button>
        </div>
      )}
      <p className="hint" id={hintId}>One clear, well-lit photo of just you. A second angle is optional. JPEG or PNG, up to 15 MB each.</p>
    </div>
  );
}
