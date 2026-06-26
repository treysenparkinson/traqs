import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App.jsx";

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

// NOTE: intentionally NOT wrapped in <StrictMode>. In React 18 dev, StrictMode
// double-invokes effects, which makes the Auth0 SDK fire the refresh-token grant
// twice in quick succession. With Refresh Token Rotation + reuse detection enabled
// on the tenant, the second use of the just-rotated token trips reuse detection and
// Auth0 revokes the token family (403 on /oauth/token, then a failed prompt=none
// fallback). StrictMode is a no-op in production, so dropping it only affects dev.
createRoot(document.getElementById("root")).render(
  <Auth0Provider
    domain={domain}
    clientId={clientId}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience: audience,
      scope: "openid profile email offline_access",
    }}
    cacheLocation="localstorage"
    useRefreshTokens={true}
    useRefreshTokensFallback={true}
  >
    <App />
  </Auth0Provider>
);
