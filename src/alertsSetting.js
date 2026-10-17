// alertsSetting.js — what Settings → Account's "Desktop alerts" row says.
//
// Two facts decide it: can this browser do Web Push at all (pushSupported), and what has the
// person told it (Notification.permission). Only "default" gets a Turn on button: once a
// browser has answered "denied", requestPermission answers "denied" again at once with no
// prompt, so a button there would do nothing. The rail used to carry a button like that.
//
// kind is the rv-chip colour: g on, r blocked, none for off / not available.
export function alertsSetting(supported, permission) {
  if (!supported) {
    return { status: "unavailable", chip: "Not available", kind: "", canEnable: false,
      note: "This browser can't show TRAQS alerts." };
  }
  if (permission === "granted") {
    return { status: "on", chip: "On", kind: "g", canEnable: false,
      note: "New messages and job updates show up on this computer. To stop them, block notifications for this site in your browser." };
  }
  if (permission === "denied") {
    return { status: "blocked", chip: "Blocked", kind: "r", canEnable: false,
      note: "Your browser is blocking alerts from TRAQS. Allow notifications for this site in the browser's site settings, then come back to this page." };
  }
  return { status: "off", chip: "Off", kind: "", canEnable: true,
    note: "Get an alert on this computer for new messages and job updates." };
}
