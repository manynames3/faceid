import { useEffect, useRef, useState } from "react";
import { containedFaceBox } from "./faceBox";
import type { FaceBox } from "./types";
import { PhotoImage } from "./ui";

export function MatchedPhoto({ alt, src, faceBox, onReload }: { alt: string; src: string; faceBox?: FaceBox; onReload?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ src: "", width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setFrame({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const outline = faceBox && image.src === src ? containedFaceBox(faceBox, image, frame) : null;
  return (
    <div className="matched-photo" ref={ref}>
      <PhotoImage alt={alt} eager onError={() => setImage({ src: "", width: 0, height: 0 })} onLoad={event => setImage({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onReload={onReload} src={src} />
      {outline && <span aria-hidden="true" className="face-outline" style={outline} />}
    </div>
  );
}
