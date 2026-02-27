// upload.js — alias for ai-schedule; handles file parsing requests
// Files are sent as base64 inside the messages[] array (same shape as ai-schedule).
// Kept as a separate endpoint to allow future direct-upload optimizations
// (e.g., multipart streaming) without touching ai-schedule.js.
export { handler } from "./ai-schedule.js";
