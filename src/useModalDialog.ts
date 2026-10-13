import { useEffect, useRef } from "react";

/**
 * Opens the <dialog> it is attached to as a native modal as soon as it mounts
 * (so the browser traps focus and makes the page inert), locks page scroll,
 * and on unmount puts focus back where it was. If that control has since been
 * removed (e.g. the row was deleted), focus falls back to the main region.
 */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      dialog.showModal();
    }
    // React's autoFocus can run while a newly mounted dialog is still hidden.
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    document.documentElement.classList.add("modal-open");

    return () => {
      document.documentElement.classList.remove("modal-open");
      if (dialog.open) {
        dialog.close();
      }
      const target = opener?.isConnected ? opener : document.getElementById("main");
      target?.focus();
    };
  }, []);

  return ref;
}
