import { hasConfiguredApi } from "./api";
import { hasConfiguredAuth } from "./auth";
import {
  CallbackScreen,
  NotFoundScreen,
  SignInScreen,
  UnavailableScreen,
} from "./AuthScreens";
import { Landing } from "./Landing";
import { GuestPage } from "./GuestPage";
import { GuestGalleryPage } from "./GuestGallery";
import { routeForPath, useLocation } from "./router";
import { useAuth } from "./useAuth";
import { Workspace } from "./Workspace";

/**
 * "ready": API and sign-in are both configured.
 * "misconfigured": an API with no sign-in. Never fall back to an open workspace.
 * "unconfigured": no API in this build, so there is no live workspace.
 */
function liveAvailability() {
  if (hasConfiguredApi && hasConfiguredAuth) {
    return "ready";
  }
  return hasConfiguredApi ? "misconfigured" : "unconfigured";
}

function App() {
  const { pathname, search } = useLocation();
  const route = routeForPath(pathname);
  const auth = useAuth();
  const availability = liveAvailability();

  // The Cognito redirect lands on the site root with ?code=...; hold the page
  // until the code is exchanged, then the user is moved on to /app.
  if (auth.isChecking) {
    return <CallbackScreen />;
  }

  if (route === "demo") {
    // The sample workspace never touches the API, whatever the build is configured with.
    return <Workspace mode="demo" />;
  }

  if (route === "guest") {
    return <GuestPage key={search} search={search} />;
  }

  if (route === "guest-preview") return <GuestPage key="preview" preview search="" />;
  if (route === "gallery") return <GuestGalleryPage key={search} search={search} />;
  if (route === "gallery-preview") return <GuestGalleryPage preview search="" />;

  if (route === "app") {
    if (availability !== "ready") {
      return <UnavailableScreen reason={availability} />;
    }
    if (!auth.session) {
      return (
        <SignInScreen message={auth.message} onSignIn={auth.signIn} onSignUp={auth.signUp} />
      );
    }
    // Keyed by the token so a new sign-in re-mounts and no earlier account's data survives.
    return (
      <Workspace
        accountEmail={auth.session.email}
        key={auth.session.idToken}
        mode="live"
        onSessionExpired={auth.expire}
        onSignOut={auth.signOut}
        session={auth.session}
      />
    );
  }

  if (route === "landing") {
    return <Landing signedIn={Boolean(auth.session)} />;
  }

  return <NotFoundScreen />;
}

export default App;
