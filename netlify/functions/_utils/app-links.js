// WHERE TO GET THE iPHONE APP. The one place this link lives.
//
// Read by the invite email (server) and by the invite landing screen (web,
// src/App.jsx imports this file directly), so the two cannot point at different
// places. Pure constants, no imports -- it has to bundle on both sides.
//
// EMPTY UNTIL THE APP IS PUBLISHED. Every "Download the app" surface checks for
// an empty string and simply does not render, so shipping with this blank is
// safe: the email and the landing page read as they did before, and the Accept
// button still opens the app for anyone who already has it (that part is the
// universal link -- public/.well-known/apple-app-site-association -- and needs
// no store listing).
//
// When it goes live, paste the App Store URL here:
//   https://apps.apple.com/app/id1234567890
export const IOS_APP_STORE_URL = "";
