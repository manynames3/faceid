import { useSyncExternalStore } from "react";

export type Route = "landing" | "demo" | "app" | "guest" | "guest-preview" | "gallery" | "gallery-preview" | "not-found";

const navigateEvent = "faceid:navigate";

export function routeForPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/":
    case "/index.html":
      return "landing";
    case "/demo":
      return "demo";
    case "/app":
      return "app";
    case "/guest":
      return "guest";
    case "/demo/guest":
      return "guest-preview";
    case "/gallery":
      return "gallery";
    case "/demo/gallery":
      return "gallery-preview";
    default:
      return "not-found";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(navigateEvent, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(navigateEvent, callback);
  };
}

/** Current path and query as one string, so React re-renders on any navigation. */
export function useLocation() {
  const href = useSyncExternalStore(
    subscribe,
    () => `${window.location.pathname}${window.location.search}`,
    () => "/",
  );
  const queryStart = href.indexOf("?");
  return {
    pathname: queryStart === -1 ? href : href.slice(0, queryStart),
    search: queryStart === -1 ? "" : href.slice(queryStart),
  };
}

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}) {
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new Event(navigateEvent));
  if (!path.includes("#")) {
    window.scrollTo(0, 0);
  }
}
