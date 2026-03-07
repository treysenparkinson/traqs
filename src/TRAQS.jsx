import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, cloneElement } from "react";
import * as XLSX from "xlsx";
import { fetchTasks, saveTasks, fetchPeople, savePeople, fetchClients, saveClients, callAI, fetchMessages, postMessage, deleteThread, uploadAttachment, fetchGroups, saveGroups, callNotify } from "./api.js";
import { TRAQS_LOGO_BLUE, TRAQS_LOGO_WHITE, UL_LOGO_WHITE } from "./logo.js";

const COLORS = ["#6366f1","#f43f5e","#10b981","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316","#3b82f6","#84cc16"];
const ADMIN_PERMS = [
  { key: "editJobs",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, label: "Create, edit & delete jobs" },
  { key: "moveJobs",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>, label: "Move & resize jobs on Gantt and team view" },
  { key: "reassign",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>, label: "Reassign operations to team members" },
  { key: "lockJobs",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, label: "Lock & unlock jobs" },
  { key: "manageTeam",    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: "Add, edit & remove team members" },
  { key: "manageClients", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><line x1="10" y1="6" x2="14" y2="6"/><line x1="10" y1="10" x2="14" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/><line x1="10" y1="18" x2="14" y2="18"/></svg>, label: "Add, edit & delete clients" },
  { key: "undoHistory",   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.86"/></svg>, label: "Undo schedule history changes" },
  { key: "orgSettings",   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "Access organization settings" },
];
const PRIORITIES = ["Low","Medium","High"];
const STATUSES = ["Not Started","Pending","In Progress","On Hold","Finished"];
const PRI_C = { Low: "#10b981", Medium: "#f59e0b", High: "#f43f5e" };
const STA_C = { "Not Started": "#94a3b8", Pending: "#a78bfa", "In Progress": "#3b82f6", "On Hold": "#f59e0b", Finished: "#10b981" };
const STA_ICON = { "Not Started": "○", Pending: "◔", "In Progress": "◑", "On Hold": "⏸", Finished: "●" };
const toDS = dt => { const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,"0"); const d = String(dt.getDate()).padStart(2,"0"); return `${y}-${m}-${d}`; };
const NOW = new Date(); const TD = toDS(NOW);
const addD = (ds, n) => { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return toDS(d); };
const isWeekend = ds => { const d = new Date(ds + "T12:00:00").getDay(); return d === 0 || d === 6; };
const addBD = (ds, n) => { let d = new Date(ds + "T12:00:00"); let remaining = Math.abs(n); const dir = n >= 0 ? 1 : -1; while (remaining > 0) { d.setDate(d.getDate() + dir); if (d.getDay() !== 0 && d.getDay() !== 6) remaining--; } return toDS(d); };
const nextBD = ds => { let d = new Date(ds + "T12:00:00"); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return toDS(d); };
const diffBD = (a, b) => { let count = 0; let c = new Date(a + "T12:00:00"); const end = new Date(b + "T12:00:00"); while (c < end) { c.setDate(c.getDate() + 1); if (c.getDay() !== 0 && c.getDay() !== 6) count++; } return count; };
const diffD = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const fm = ds => new Date(ds + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const uid = () => "t" + Math.random().toString(36).substr(2, 8);

// Health: compare progress vs timeline
const getHealth = (t) => {
  if (t.status === "Finished") return "done";
  if (t.status === "Not Started" && TD > t.start) return "critical";
  if (t.status === "Not Started") return "ontime";
  const total = diffD(t.start, t.end) + 1;
  const elapsed = diffD(t.start, TD) + 1;
  const pctTime = Math.min(elapsed / Math.max(total, 1), 1);
  const pctDone = t.status === "Finished" ? 1 : t.status === "In Progress" ? 0.5 : t.status === "Pending" ? 0.15 : t.status === "On Hold" ? 0.25 : 0;
  if (t.status === "On Hold" && pctTime > 0.5) return "critical";
  if (pctTime > pctDone + 0.35) return "critical";
  if (pctTime > pctDone + 0.15) return "behind";
  return "ontime";
};
const HEALTH_DOT = { ontime: "#10b981", behind: "#f59e0b", critical: "#ef4444", done: "#10b981" };
const OP_COLORS = { Wire: "#3b82f6", Cut: "#f97316", Layout: "#8b5cf6" };
const HEALTH_COLOR = { ontime: "#10b981", behind: "#f59e0b", critical: "#ef4444", done: "#10b981" };



const mkPeople = () => [
  { id: 99, name: "Trey", role: "Admin", cap: 8, color: "#6366f1", timeOff: [], userRole: "admin", email: "" },
  { id: 100, name: "Max", role: "Admin", cap: 8, color: "#f43f5e", timeOff: [], userRole: "admin", email: "" },
];
const mkTasks = () => [];

const mkClients = () => [
  { id: "c1", name: "Beaver Equipment", contact: "", email: "", phone: "", color: "#2563eb", notes: "" },
  { id: "c2", name: "Biofire Diagnositcs", contact: "", email: "", phone: "", color: "#dc2626", notes: "" },
  { id: "c3", name: "Clearstream", contact: "", email: "", phone: "", color: "#16a34a", notes: "" },
  { id: "c4", name: "Codale", contact: "", email: "", phone: "", color: "#d97706", notes: "" },
  { id: "c5", name: "Delta Valve", contact: "", email: "", phone: "", color: "#7c3aed", notes: "" },
  { id: "c6", name: "FLS", contact: "", email: "", phone: "", color: "#0891b2", notes: "" },
  { id: "c7", name: "Industrial Power Technologies", contact: "", email: "", phone: "", color: "#c026d3", notes: "" },
  { id: "c8", name: "JMC", contact: "", email: "", phone: "", color: "#e11d48", notes: "" },
  { id: "c9", name: "Lehi City Power", contact: "", email: "", phone: "", color: "#059669", notes: "" },
  { id: "c10", name: "National Welding Corp", contact: "", email: "", phone: "", color: "#9333ea", notes: "" },
  { id: "c11", name: "Nueman Machinery", contact: "", email: "", phone: "", color: "#ea580c", notes: "" },
  { id: "c12", name: "OTC", contact: "", email: "", phone: "", color: "#0284c7", notes: "" },
  { id: "c13", name: "OVO", contact: "", email: "", phone: "", color: "#4f46e5", notes: "" },
  { id: "c14", name: "Rebuild-It", contact: "", email: "", phone: "", color: "#b91c1c", notes: "" },
  { id: "c15", name: "Royal", contact: "", email: "", phone: "", color: "#15803d", notes: "" },
  { id: "c16", name: "Tigua Enterprises", contact: "", email: "", phone: "", color: "#a21caf", notes: "" },
  { id: "c17", name: "Wheeler CAT", contact: "", email: "", phone: "", color: "#ca8a04", notes: "" },
  { id: "c18", name: "WTR Engineering", contact: "", email: "", phone: "", color: "#0e7490", notes: "" },
];

const fontLink = document.createElement("link"); fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
if (!document.querySelector('link[href*="DM+Sans"]')) document.head.appendChild(fontLink);
if (!document.querySelector('meta[name="viewport"]')) { const vp = document.createElement("meta"); vp.name = "viewport"; vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"; document.head.appendChild(vp); }


// Inject animation keyframes
const animStyle = document.createElement("style");
animStyle.textContent = `
/* ── Spring easing reference ───────────────────────────────────────────
   Smooth decelerate : cubic-bezier(0.22, 1, 0.36, 1)
   Spring overshoot  : cubic-bezier(0.34, 1.56, 0.64, 1)
   Snappy press      : cubic-bezier(0.4, 0, 0.2, 1)
─────────────────────────────────────────────────────────────────────── */

@keyframes viewEnter {
  0%   { opacity: 0; transform: translateY(20px) scale(0.97); filter: blur(6px); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0);   }
}
@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes cardPop {
  0%   { opacity: 0; transform: translateY(16px) scale(0.94); filter: blur(3px); }
  60%  { opacity: 1; transform: translateY(-3px) scale(1.01); filter: blur(0);   }
  100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0);   }
}
@keyframes springPop {
  0%   { opacity: 0; transform: scale(0.82) translateY(12px); filter: blur(4px); }
  55%  { opacity: 1; transform: scale(1.04) translateY(-4px); filter: blur(0);   }
  75%  { transform: scale(0.98) translateY(1px); }
  100% { opacity: 1; transform: scale(1)    translateY(0);    }
}
/* glow-pulse injected dynamically by useEffect so it tracks T.accent */
@keyframes ghost-fade-in {
  0%   { opacity: 0; transform: scale(0.88); filter: blur(3px); }
  60%  { opacity: 1; transform: scale(1.03); filter: blur(0);   }
  100% { opacity: 1; transform: scale(1);    filter: blur(0);   }
}
@keyframes drag-lift {
  from { transform: scale(1);    box-shadow: none; }
  to   { transform: scale(1.04); box-shadow: 0 12px 32px rgba(0,0,0,0.3); }
}
@keyframes modalOverlayIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes modalBoxIn {
  0%   { opacity: 0; transform: scale(0.88) translateY(32px); filter: blur(6px); }
  55%  { opacity: 1; transform: scale(1.02) translateY(-4px); filter: blur(0);   }
  75%  { transform: scale(0.99) translateY(1px); }
  100% { opacity: 1; transform: scale(1)    translateY(0);    filter: blur(0);   }
}
@keyframes deleteShake {
  0%   { transform: scale(0.88) translateY(32px); opacity: 0; filter: blur(6px); }
  50%  { opacity: 1; filter: blur(0); }
  65%  { transform: scale(1.03) translateY(-3px); }
  80%  { transform: scale(0.99) rotate(-0.4deg); }
  100% { transform: scale(1)    rotate(0deg); opacity: 1; }
}
@keyframes ctxMenuIn {
  0%   { opacity: 0; transform: scale(0.90) translateY(-10px); filter: blur(3px); }
  60%  { opacity: 1; transform: scale(1.02) translateY(2px);   filter: blur(0);   }
  100% { opacity: 1; transform: scale(1)    translateY(0);     filter: blur(0);   }
}
@keyframes headerSlide {
  0%   { opacity: 0; transform: translateY(-14px); filter: blur(3px); }
  100% { opacity: 1; transform: translateY(0);     filter: blur(0);   }
}
@keyframes filterSlide {
  0%   { opacity: 0; transform: translateY(-8px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes dropIn {
  0%   { opacity: 0; transform: translateY(-8px) scale(0.93); filter: blur(3px); }
  60%  { opacity: 1; transform: translateY(2px)  scale(1.01); filter: blur(0);   }
  100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0);   }
}
@keyframes fadeScale {
  0%   { opacity: 0; transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1);    }
}
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1.0); opacity: 1;   }
}
@keyframes spin {
  from { transform: rotate(0deg);   }
  to   { transform: rotate(360deg); }
}
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 2px 12px var(--glow-color, rgba(6,182,212,0.2)); }
  50%       { box-shadow: 0 4px 24px var(--glow-color, rgba(6,182,212,0.4)); }
}
@keyframes staggerUp {
  0%   { opacity: 0; transform: translateY(14px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes badgeBounce {
  0%   { transform: scale(0);    opacity: 0; }
  55%  { transform: scale(1.18); opacity: 1; }
  75%  { transform: scale(0.92);             }
  100% { transform: scale(1);                }
}
@keyframes ganttBarSlide {
  0%   { opacity: 0; transform: scaleX(0.4); transform-origin: left; }
  100% { opacity: 1; transform: scaleX(1);   transform-origin: left; }
}
@keyframes glassShimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes ftIntroExit {
  0%   { opacity: 1; transform: scale(1);    filter: blur(0); }
  12%  { opacity: 1; transform: scale(0.95); filter: blur(0); }
  100% { opacity: 0; transform: scale(1.14) translateY(-20px); filter: blur(14px); }
}
@keyframes ftInputEnter {
  0%   { opacity: 0; transform: translateY(36px) scale(0.97); filter: blur(8px); }
  55%  { opacity: 1; transform: translateY(-4px) scale(1.01); filter: blur(0);   }
  100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0);   }
}
@keyframes ftFeaturePop {
  0%   { opacity: 0; transform: translateY(20px) scale(0.88); }
  65%  { opacity: 1; transform: translateY(-4px) scale(1.02); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}

@keyframes selectBubbleIn {
  0%   { opacity: 0; transform: scale(0);    }
  60%  { opacity: 1; transform: scale(1.25); }
  80%  { transform: scale(0.88); }
  100% { opacity: 1; transform: scale(1);    }
}
.select-bubble-in { animation: selectBubbleIn 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

/* ── Animation classes ─────────────────────────────────────────────── */
.anim-view-enter  { animation: viewEnter   0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
.anim-card        { animation: cardPop     0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-modal-overlay { animation: modalOverlayIn 0.25s ease both; }
.anim-modal-box   { animation: modalBoxIn  0.48s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-delete-box  { animation: deleteShake 0.52s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-ctx         { animation: ctxMenuIn   0.26s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-header      { animation: headerSlide 0.42s cubic-bezier(0.22, 1, 0.36, 1) both; }
.anim-filter      { animation: filterSlide 0.36s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both; }
.anim-drop        { animation: dropIn      0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-badge       { animation: badgeBounce 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-gantt-bar   { animation: ganttBarSlide 0.38s cubic-bezier(0.22, 1, 0.36, 1) both; }
.anim-spring      { animation: springPop   0.5s  cubic-bezier(0.34, 1.56, 0.64, 1) both; }

.anim-tab {
  transition: all 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
}
.anim-tab:hover  { transform: translateY(-1px) scale(1.03); }
.anim-tab:active { transform: scale(0.94) translateY(0); transition-duration: 0.08s; }

.anim-btn {
  transition: all 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
}
.anim-btn:hover  { box-shadow: 0 6px 20px rgba(0,0,0,0.2); filter: brightness(1.08); }
.anim-btn:active { filter: brightness(0.95); transition-duration: 0.08s; }

.anim-card-wrap {
  transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.32s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.22s ease;
}
.anim-card-wrap:hover  { transform: translateY(-4px) scale(1.007); box-shadow: 0 20px 52px rgba(0,0,0,0.18); }
.anim-card-wrap:active { transform: translateY(-1px) scale(0.99); transition-duration: 0.1s; }

.anim-stagger { animation: staggerUp 0.4s  cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.anim-row     { animation: fadeScale 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
.ft-intro-enter { animation: modalBoxIn   0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.ft-intro-exit  { animation: ftIntroExit  0.38s cubic-bezier(0.4, 0, 1, 1) both; }
.ft-input-enter { animation: ftInputEnter 0.52s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

* { -webkit-tap-highlight-color: transparent; }
html { scroll-behavior: smooth; }

.traqs-midnight input[type="date"]::-webkit-calendar-picker-indicator,
.traqs-obsidian  input[type="date"]::-webkit-calendar-picker-indicator,
.traqs-dark      input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) brightness(2); cursor: pointer; }
.traqs-midnight input[type="date"],
.traqs-obsidian  input[type="date"],
.traqs-dark      input[type="date"] { color-scheme: dark; }

.traqs-frost input[type="date"]::-webkit-calendar-picker-indicator,
.traqs-light input[type="date"]::-webkit-calendar-picker-indicator { filter: none; cursor: pointer; }
.traqs-frost input[type="date"],
.traqs-light input[type="date"] { color-scheme: light; }

@media (max-width: 767px) {
  .anim-card-wrap:hover  { transform: none; box-shadow: none; }
  .anim-card-wrap:active { transform: scale(0.97); transition-duration: 0.1s; }
}
`;
if (!document.querySelector('style[data-traqs]')) { animStyle.setAttribute("data-traqs", "1"); document.head.appendChild(animStyle); }

// ─── Custom-theme color helpers ──────────────────────────────────────────────
function hexLum(hex) {
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  return 0.2126*l(r)+0.7152*l(g)+0.0722*l(b);
}
function blendHex(hex, f) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const t=f>0?255:0, a=Math.abs(f), c=v=>Math.min(255,Math.max(0,Math.round(v+(t-v)*a))).toString(16).padStart(2,"0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function accentText(accent) {
  // Returns black or white depending on which contrasts better against the accent color
  try { return hexLum(accent) > 0.35 ? "#0f172a" : "#ffffff"; } catch { return "#ffffff"; }
}

function buildCustomTheme(bg, accent) {
  const dk = hexLum(bg) < 0.18;
  const card = blendHex(bg, dk ? 0.10 : 0);
  const bord = blendHex(bg, dk ? 0.18 : -0.12);
  return {
    name:"Custom", bg, surface:blendHex(bg,dk?0.07:-0.03), card, border:bord,
    borderLight:blendHex(bg,dk?0.24:-0.09),
    text:dk?"#f1f5f9":"#0f172a", textSec:dk?"#f1f5f9":"#0f172a", textDim:dk?"#f1f5f9":"#0f172a",
    accent, accentText:accentText(accent), danger:"#f43f5e",
    font:"'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif", mono:"'JetBrains Mono',monospace",
    radius:16, radiusSm:12, radiusXs:8, glass:card, glassBorder:bord,
    blur:"none", glow:"none", colorScheme:dk?"dark":"light",
  };
}

const THEMES = {
  midnight: { name: "Dark",  bg: "#080d18", surface: "#0d1424", card: "#111c30", border: "#1a2a45", borderLight: "#243555", text: "#e6ecf8", textSec: "#e6ecf8", textDim: "#e6ecf8", accent: "#3d7fff", accentText: "#ffffff", danger: "#f43f5e", font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", mono: "'JetBrains Mono', monospace", radius: 16, radiusSm: 12, radiusXs: 8, glass: "#111c30", glassBorder: "#1e2f4a", blur: "none", glow: "none", colorScheme: "dark" },
  obsidian: { name: "Obsidian",  bg: "#07070e", surface: "#0d0d1a", card: "#111120", border: "#1c1c34", borderLight: "#252548", text: "#eeeef8", textSec: "#eeeef8", textDim: "#eeeef8", accent: "#7c3aed", accentText: "#ffffff", danger: "#f43f5e", font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", mono: "'JetBrains Mono', monospace", radius: 16, radiusSm: 12, radiusXs: 8, glass: "#111120", glassBorder: "#1c1c34", blur: "none", glow: "none", colorScheme: "dark" },
  frost:    { name: "White",     bg: "#f0f4f9", surface: "#ffffff",  card: "#ffffff",  border: "#e2e8f2", borderLight: "#d4dce8", text: "#0f172a", textSec: "#0f172a", textDim: "#0f172a", accent: "#0ea5e9", accentText: "#ffffff", danger: "#ef4444", font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", mono: "'JetBrains Mono', monospace", radius: 16, radiusSm: 12, radiusXs: 8, glass: "#ffffff",  glassBorder: "#e2e8f2", blur: "none", glow: "none", colorScheme: "light" },
};
// Legacy aliases so any existing code referencing "dark"/"light" still resolves
THEMES.dark  = THEMES.midnight;
THEMES.light = THEMES.frost;

// Theme ref - updated by App, read by all components
let T = THEMES.light;

const Badge = ({ t, c, lg }) => <span style={{ display: "inline-flex", alignItems: "center", padding: lg ? "5px 14px" : "4px 12px", borderRadius: 20, fontSize: lg ? 13 : 12, fontWeight: 600, fontFamily: T.font, background: c + "18", color: c, border: `1px solid ${c}22`, whiteSpace: "nowrap" }}>{t}</span>;
const Btn = ({ children, onClick, variant = "primary", size = "md", disabled = false, style: sx = {} }) => {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: T.font, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", borderRadius: T.radiusSm, border: "none", whiteSpace: "nowrap", flexShrink: 0 };
  const sizes = { sm: { padding: "7px 16px", fontSize: 13 }, md: { padding: "10px 20px", fontSize: 14 } };
  const vars = { primary: { background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, color: T.accentText, boxShadow: 'none' }, ghost: { background: T.glass, color: T.textSec, border: `1px solid ${T.glassBorder}` }, danger: { background: "transparent", color: T.danger, border: `1px solid ${T.danger}33` }, teal: { background: "transparent", color: "#14b8a6", border: `1px solid #14b8a633` }, warn: { background: "transparent", color: "#f59e0b", border: `1px solid #f59e0b33` } };
  return <button className="anim-btn" onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...vars[variant], opacity: disabled ? 0.45 : 1, ...sx }}>{children}</button>;
};
const Card = ({ children, style: sx = {}, delay = 0, onClick }) => <div className="anim-card anim-card-wrap" onClick={onClick}
  onMouseEnter={onClick ? e => { e.currentTarget.style.border = `1px solid ${T.accent}55`; e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.18), 0 0 0 1px ${T.accent}22`; e.currentTarget.style.transform = "translateY(-1px)"; } : undefined}
  onMouseLeave={onClick ? e => { e.currentTarget.style.border = `1px solid ${T.glassBorder}`; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = "none"; } : undefined}
  style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.glassBorder}`, padding: 24, animationDelay: `${delay}ms`, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', cursor: onClick ? "pointer" : undefined, transition: "border 0.15s, box-shadow 0.15s, transform 0.15s", ...sx }}>{children}</div>;
const InputField = ({ label, value, onChange, type = "text", placeholder }) => <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500, fontFamily: T.font }}>{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none", transition: "border 0.2s, box-shadow 0.2s", colorScheme: T.colorScheme }} onFocus={e => { e.target.style.borderColor = T.accent + "55"; e.target.style.boxShadow = `0 0 0 3px ${T.accent}15`; }} onBlur={e => { e.target.style.borderColor = T.glassBorder; e.target.style.boxShadow = "none"; }} /></div>;
const SelectField = ({ label, value, onChange, options }) => <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500, fontFamily: T.font }}>{label}</label><select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none" }}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></div>;
function CtxMenuItem({ icon, label, sub, onClick }) { return <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "12"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}><span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.textSec, lineHeight: 0 }}>{icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{label}</div>{sub && <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{sub}</div>}</div></div>; }

/** Reusable sliding-pill toggle. options=[{value,label}], value=active key */
function SlidingPill({ options, value, onChange, size = "md", style: sx = {} }) {
  const pillRef = useRef(null);
  const btnRefs = useRef({});
  const mounted = useRef(false);
  useEffect(() => {
    const btn = btnRefs.current[value];
    const pill = pillRef.current;
    if (!btn || !pill) return;
    if (!mounted.current) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      mounted.current = true;
      requestAnimationFrame(() => {
        if (pill) pill.style.transition = "transform 0.28s cubic-bezier(0.34,1.56,0.64,1), width 0.22s cubic-bezier(0.22,1,0.36,1)";
      });
    } else {
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
    }
  }, [value]);
  const pad = size === "lg" ? "12px 32px" : size === "sm" ? "6px 14px" : "8px 18px";
  const fs  = size === "lg" ? 16 : 13;
  const fw  = size === "lg" ? 800 : 700;
  return (
    <div style={{ display:"flex", background:T.bg, borderRadius:T.radiusSm, padding:3, position:"relative", isolation:"isolate", ...sx }}>
      <div ref={pillRef} style={{ position:"absolute", top:3, bottom:3, left:0, borderRadius:T.radiusXs, background:T.accent, boxShadow:`0 4px 18px ${T.accent}55`, zIndex:0, pointerEvents:"none" }} />
      {options.map(opt => {
        const isActive = value === opt.value;
        return (
          <button key={opt.value} ref={el => { btnRefs.current[opt.value] = el; }} onClick={() => onChange(opt.value)}
            style={{ position:"relative", zIndex:1, padding:pad, borderRadius:T.radiusXs, border:"none", fontSize:fs, fontWeight:isActive?fw:400, cursor:"pointer", fontFamily:T.font, background:"transparent", color:isActive?T.accentText:T.text, whiteSpace:"nowrap" }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
function ColorSlidingPill({ options, value, onChange, style: sx = {} }) {
  const pillRef = useRef(null);
  const btnRefs = useRef({});
  const mounted = useRef(false);
  const activeColor = (options.find(o => o.value === value) || options[0])?.color || "#94a3b8";
  useEffect(() => {
    const btn = btnRefs.current[value];
    const pill = pillRef.current;
    if (!btn || !pill) return;
    if (!mounted.current) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.background = activeColor;
      mounted.current = true;
      requestAnimationFrame(() => {
        if (pill) pill.style.transition = "transform 0.28s cubic-bezier(0.34,1.56,0.64,1), width 0.22s cubic-bezier(0.22,1,0.36,1), background 0.18s ease";
      });
    } else {
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.background = activeColor;
    }
  }, [value, activeColor]);
  return (
    <div style={{ display: "flex", background: T.surface, borderRadius: T.radiusSm, padding: 3, position: "relative", isolation: "isolate", border: `1px solid ${T.border}`, ...sx }}>
      <div ref={pillRef} style={{ position: "absolute", top: 3, bottom: 3, left: 0, borderRadius: T.radiusXs, background: activeColor, boxShadow: `0 2px 10px ${activeColor}55`, zIndex: 0, pointerEvents: "none" }} />
      {options.map(opt => {
        const isActive = value === opt.value;
        return (
          <button key={opt.value} ref={el => { btnRefs.current[opt.value] = el; }} onClick={() => onChange(opt.value)}
            style={{ position: "relative", zIndex: 1, padding: "5px 11px", borderRadius: T.radiusXs, border: "none", fontSize: 12, fontWeight: isActive ? 700 : 400, cursor: "pointer", fontFamily: T.font, background: "transparent", color: isActive ? "#fff" : T.textSec, whiteSpace: "nowrap", transition: "color 0.15s" }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
function MobileNav({ tabs, activeId, onChange }) {
  const pillRef = useRef(null);
  const btnRefs = useRef({});
  const mounted = useRef(false);
  useEffect(() => {
    const btn = btnRefs.current[activeId];
    const pill = pillRef.current;
    if (!btn || !pill) return;
    if (!mounted.current) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      mounted.current = true;
      requestAnimationFrame(() => {
        if (pill) pill.style.transition = "transform 0.28s cubic-bezier(0.34,1.56,0.64,1), width 0.22s cubic-bezier(0.22,1,0.36,1)";
      });
    } else {
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
    }
    btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeId]);
  return (
    <div style={{ flexShrink: 0, background: T.surface, borderBottom: `1px solid ${T.border}` }}>
      <div className="mn-wrap" style={{ display: "flex", position: "relative", isolation: "isolate" }}>
        <div ref={pillRef} style={{ position: "absolute", top: 4, bottom: 4, left: 0, borderRadius: T.radiusXs, background: T.accent + "22", zIndex: 0, pointerEvents: "none" }} />
        {tabs.map(tab => {
          const isActive = activeId === tab.id;
          return (
            <button key={tab.id} ref={el => { btnRefs.current[tab.id] = el; }} onClick={() => onChange(tab.id)}
              style={{ position: "relative", zIndex: 1, flex: 1, padding: "8px 4px", border: "none", background: "transparent", cursor: "pointer", fontFamily: T.font, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <span style={{ lineHeight: 0, position: "relative", display: "inline-block", color: isActive ? T.accent : T.textDim }}>
                {tab.icon}
                {tab.badge > 0 && <span style={{ position: "absolute", top: -4, right: -6, minWidth: 14, height: 14, borderRadius: 7, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff", padding: "0 3px", boxSizing: "border-box" }}>{tab.badge > 9 ? "9+" : tab.badge}</span>}
              </span>
              <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 400, color: isActive ? T.accent : T.textDim, whiteSpace: "nowrap" }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
const HealthIcon = ({ t, size = 14 }) => { const h = getHealth(t); const c = HEALTH_DOT[h]; return <span title={h === "ontime" ? "On time" : h === "behind" ? "Slightly behind" : h === "critical" ? "Behind schedule" : "Done"} style={{ width: size, height: size, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block", boxShadow: "0 0 " + (size) + "px " + c + "55" }} />; };
function StatusDrop({ value, onChange, size = "sm" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const c = STA_C[value] || T.textDim;
  const sz = size === "sm" ? { fontSize: 12, padding: "3px 10px" } : { fontSize: 13, padding: "5px 12px" };
  return <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
    <span onClick={e => { e.stopPropagation(); setOpen(!open); }} style={{ ...sz, borderRadius: 14, fontWeight: 600, fontFamily: T.font, background: c + "18", color: c, border: `1px solid ${c}33`, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4, userSelect: "none" }}>
      {value} <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
    </span>
    {open && <div className="anim-drop" style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 999, background: T.glass, border: `1px solid ${T.glassBorder}`, borderRadius: T.radiusSm, padding: "4px 0", boxShadow: "0 12px 40px rgba(0,0,0,0.4)", minWidth: 140 }}>
      {STATUSES.map(s => <div key={s} onClick={e => { e.stopPropagation(); onChange(s); setOpen(false); }}
        style={{ padding: "8px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: value === s ? STA_C[s] : T.text, fontWeight: value === s ? 600 : 400, background: value === s ? STA_C[s] + "12" : "transparent" }}
        onMouseEnter={e => e.currentTarget.style.background = STA_C[s] + "18"} onMouseLeave={e => e.currentTarget.style.background = value === s ? STA_C[s] + "12" : "transparent"}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: STA_C[s] }} />{s}
      </div>)}
    </div>}
  </div>;
}
function SearchSelect({ label, value, onChange, options, placeholder = "Search..." }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(""); } }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const filtered = options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()));
  const selected = options.find(o => o.value === value);
  return <div ref={ref} style={{ position: "relative", marginBottom: 16 }}>
    {label && <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 500, fontFamily: T.font }}>{label}</label>}
    <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${open ? T.accent : T.glassBorder}`, background: T.glass, cursor: "pointer", transition: "border 0.15s" }}>
      {selected ? <><div style={{ width: 10, height: 10, borderRadius: 5, background: selected.color || T.accent, flexShrink: 0 }} /><span style={{ flex: 1, fontSize: 14, color: T.text, fontWeight: 500 }}>{selected.label}</span></> : <span style={{ flex: 1, fontSize: 14, color: T.textDim }}>No client selected</span>}
      <span style={{ fontSize: 10, color: T.textDim }}>{open ? "▲" : "▼"}</span>
    </div>
    {open && <div className="anim-drop" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 999, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, boxShadow: "0 16px 48px rgba(0,0,0,0.6)", overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} autoFocus style={{ width: "100%", padding: "10px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none" }} />
      </div>
      <div style={{ maxHeight: 220, overflow: "auto" }}>
        <div onClick={() => { onChange(null); setOpen(false); setQ(""); }}
          style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: !value ? T.accent : T.textSec, fontWeight: !value ? 600 : 400, background: !value ? T.accent + "10" : "transparent" }}
          onMouseEnter={e => e.currentTarget.style.background = T.accent + "15"} onMouseLeave={e => e.currentTarget.style.background = !value ? T.accent + "10" : "transparent"}>
          <div style={{ width: 10, height: 10, borderRadius: 5, border: `2px dashed ${T.textDim}`, flexShrink: 0 }} />None
        </div>
        {filtered.length === 0 && <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 13, color: T.textDim }}>No clients match "{q}"</div>}
        {filtered.map(o => <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
          style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: value === o.value ? o.color || T.text : T.text, fontWeight: value === o.value ? 600 : 400, background: value === o.value ? (o.color || T.accent) + "12" : "transparent" }}
          onMouseEnter={e => e.currentTarget.style.background = (o.color || T.accent) + "18"} onMouseLeave={e => e.currentTarget.style.background = value === o.value ? (o.color || T.accent) + "12" : "transparent"}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: o.color || T.accent, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{o.label}</span>
          {o.sub && <span style={{ fontSize: 12, color: T.textDim }}>{o.sub}</span>}
        </div>)}
      </div>
    </div>}
  </div>;
}
function AnimatedView({ viewKey, children, style }) {
  const [k, setK] = useState(0);
  const prevRef = useRef(viewKey);
  useEffect(() => { if (prevRef.current !== viewKey) { setK(p => p + 1); prevRef.current = viewKey; } }, [viewKey]);
  return <div key={`${viewKey}-${k}`} className="anim-view-enter" style={style}>{children}</div>;
}

function autoEmail(name, domain) {
  const first = (name || "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  return first && domain ? `${first}@${domain}` : "";
}

export default function App({ auth0User, getToken, logout, orgCode, orgConfig }) {
  const [themeMode, setThemeMode] = useState(() => {
    const saved = localStorage.getItem("tq_theme");
    return (THEMES[saved] || saved === "custom") ? saved : "midnight";
  });
  const [customTheme, setCustomTheme] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tq_custom_theme") || "null") || { bg: "#1a1a2e", accent: "#e94560" }; }
    catch { return { bg: "#1a1a2e", accent: "#e94560" }; }
  });
  T = themeMode === "custom" ? buildCustomTheme(customTheme.bg, customTheme.accent) : (THEMES[themeMode] || THEMES.midnight);
  useEffect(() => { localStorage.setItem("tq_theme", themeMode); }, [themeMode]);
  useEffect(() => { localStorage.setItem("tq_custom_theme", JSON.stringify(customTheme)); }, [customTheme]);
  // Inject glow-pulse keyframe so it always matches T.accent
  useEffect(() => {
    let el = document.querySelector("style[data-traqs-glow]");
    if (!el) { el = document.createElement("style"); el.setAttribute("data-traqs-glow","1"); document.head.appendChild(el); }
    const a = T.accent;
    el.textContent = `@keyframes glow-pulse { 0%,100% { box-shadow: 0 0 12px ${a}88, 0 0 28px ${a}44; } 50% { box-shadow: 0 0 24px ${a}cc, 0 0 52px ${a}77; } }`;
  }, [T.accent]);
  // Inject date-picker CSS for dynamic custom theme color-scheme
  useEffect(() => {
    if (themeMode !== "custom") return;
    const dk = hexLum(customTheme.bg) < 0.18;
    let el = document.querySelector("style[data-traqs-custom]");
    if (!el) { el = document.createElement("style"); el.setAttribute("data-traqs-custom","1"); document.head.appendChild(el); }
    el.textContent = dk
      ? `.traqs-custom input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1) brightness(2);cursor:pointer}.traqs-custom input[type="date"]{color-scheme:dark}`
      : `.traqs-custom input[type="date"]::-webkit-calendar-picker-indicator{filter:none;cursor:pointer}.traqs-custom input[type="date"]{color-scheme:light}`;
  }, [themeMode, customTheme.bg]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState("mytasks");
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [loginStep] = useState("user"); // kept for any remaining refs
  const handleLogin = () => {};
  const handleLogout = () => logout({ logoutParams: { returnTo: window.location.origin } });
  const switchView = (v) => {
    setView(v);
    setJobSelectMode(false);    setSelJobs(new Set());
    setClientSelectMode(false); setSelClients(new Set());
    setTeamSelectMode(false);   setSelPeople(new Set());
    if (v !== "tasks") setTaskSubView("cards");
  };

  const processUpload = async () => {
    setUploadProcessing(true);
    setUploadResult(null);
    try {
      const excelFiles = uploadFiles.filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
      if (excelFiles.length === 0) {
        setUploadResult({ success: false, message: "Please upload an Excel or CSV file (.xlsx, .xls, or .csv)." });
        setUploadProcessing(false); return;
      }

      // ── Column scoring ─────────────────────────────────────────────────────
      function scoreCol(header, high, med) {
        const h = String(header || "").toLowerCase().replace(/[_.\\/\-]/g, " ").trim();
        let s = 0;
        for (const t of high) { if (h === t) s += 20; else if (h.includes(t) || t.includes(h)) s += 10; }
        for (const t of med)  { if (h === t) s += 6;  else if (h.includes(t)) s += 3; else if (t.includes(h) && h.length > 2) s += 1; }
        return s;
      }
      function detectCols(headers) {
        const FIELDS = {
          jobNumber:  { high: ["work order","wo #","job #","job number","mtx project","project number","wo number"], med: ["job","order","wo","number"] },
          title:      { high: ["job name","job title","project name","mtx project","project title","description"], med: ["title","name","project","scope","task"] },
          startDate:  { high: ["start date","begin date","planned start","date start","start date","scheduled start"], med: ["start","begin","from"] },
          endDate:    { high: ["end date","finish date","completion date","scheduled end","date end","scheduled finish"], med: ["end","finish","complete"] },
          dueDate:    { high: ["ship date","due date","required date","delivery date","target date","must ship","need by"], med: ["due","ship","delivery","deadline","required"] },
          client:     { high: ["customer name","client name","end user","sold to","bill to"], med: ["client","customer","cust","company","account"] },
          assignedTo: { high: ["assigned to","project manager","responsible party","lead tech","tech","email"], med: ["assign","engineer","pm","manager","worker","team","lead","owner"] },
          notes:      { high: ["special instructions","additional notes","job notes","comments"], med: ["note","comment","remark","memo","instruction"] },
          poNumber:   { high: ["purchase order","po #","po#","po number","po"], med: ["purchase"] },
          level:      { high: ["sh","level","lvl","lv","indent","hierarchy","tier","type"], med: [] },
          hpd:        { high: ["hours per day","hpd","hrs/day","hours/day","daily hours","h/day","hrs per day"], med: ["hours","hrs","hour"] },
        };
        const claimed = new Set();
        const map = {};
        for (const [field, { high, med }] of Object.entries(FIELDS)) {
          const ranked = headers.map((h, i) => ({ col: i, s: scoreCol(h, high, med) }))
            .filter(x => x.s > 0).sort((a, b) => b.s - a.s);
          const best = ranked.find(x => !claimed.has(x.col));
          if (best) { claimed.add(best.col); map[field] = best.col; }
        }
        return map;
      }

      // ── Value helpers ──────────────────────────────────────────────────────
      const today = new Date().toISOString().split("T")[0];
      const addDays = (d, n) => { const dt = new Date(d + "T12:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };
      function getV(row, col) { return col !== undefined ? String(row[col] ?? "").trim() : ""; }
      function parseDate(v) {
        if (!v) return "";
        if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().split("T")[0];
        const d = new Date(v);
        return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
      }
      // "401964 - Thacker pass" → { num:"401964", title:"Thacker pass" }
      // "401944" → { num:"401944", title:"" }
      function splitJobVal(v) {
        const m = v.match(/^([A-Z]{0,4}\d{3,})\s*[-–]\s*(.+)$/);
        if (m) return { num: m[1].trim(), title: m[2].trim() };
        if (/^[A-Z]{0,4}\d{4,}$/.test(v.replace(/\s/g, ""))) return { num: v.trim(), title: "" };
        return null;
      }
      // 401999-01 or 401999-01 (2) or 401999-01A
      function isPanelVal(v) { return /^[A-Z]{0,4}\d{4,}-\d+/i.test(v.replace(/\s/g, "")); }
      // Extract parent job number: 401999-01 → 401999
      function parentJobNum(v) { return v.replace(/\s*\(.*\).*$/, "").trim().replace(/-\d+[A-Z]?$/i, ""); }
      // Strip trailing "(2)" from panel title
      function cleanPanel(v) { return v.replace(/\s*\(\d+\).*$/, "").trim(); }
      const OP_NAMES = new Set(["wire","cut","layout","labels","engineering","programming","assembly","test","inspection","paint","ship","install","startup","wiring","cutting","prep","testing","punch"]);

      // ── People / clients resolver (closes over component state) ───────────
      const pendingPeople  = {};
      const pendingClients = {};
      function nameFromEmail(raw) {
        // draven@matrixpci.com → "Draven"   john.smith@co.com → "John Smith"
        const local = raw.split("@")[0];
        return local.replace(/[._\-+]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
      }
      function resolvePerson(raw) {
        if (!raw) return null;
        // Extract display name from email if needed
        const name = raw.includes("@") ? nameFromEmail(raw) : raw.trim();
        if (!name) return null;
        const lo = name.toLowerCase();
        // Exact match first
        const exact = people.find(p => p.name.toLowerCase() === lo);
        if (exact) return exact.id;
        // Partial match — e.g. "Draven" matches "Draven Doe"
        const partial = people.find(p => p.name.toLowerCase().startsWith(lo + " ") || p.name.toLowerCase() === lo);
        if (partial) return partial.id;
        // Check pending
        if (pendingPeople[lo]) return pendingPeople[lo].id;
        // Also check if already pending under a slightly different casing
        const pendingPartial = Object.values(pendingPeople).find(p => p.name.toLowerCase().startsWith(lo + " ") || p.name.toLowerCase() === lo);
        if (pendingPartial) return pendingPartial.id;
        pendingPeople[lo] = { id: uid(), name, role: "Shop", cap: 8, color: COLORS[Object.keys(pendingPeople).length % COLORS.length], timeOff: [], userRole: "user" };
        return pendingPeople[lo].id;
      }
      function resolveClient(name) {
        if (!name) return null;
        const lo = name.toLowerCase().trim();
        const ex = clients.find(c => c.name.toLowerCase() === lo);
        if (ex) return ex.id;
        if (!pendingClients[lo]) pendingClients[lo] = { id: "c" + uid(), name: name.trim(), contact: "", email: "", phone: "", color: COLORS[(clients.length + Object.keys(pendingClients).length) % COLORS.length], notes: "" };
        return pendingClients[lo].id;
      }

      // ── Parse files ────────────────────────────────────────────────────────
      const importedJobs = [];
      const jobByNum = {}; // jobNumber → job obj
      let totalJobs = 0, totalUpdated = 0;

      for (const file of excelFiles) {
        const ab = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload  = () => res(r.result);
          r.onerror = () => rej(new Error("Failed to read " + file.name));
          r.readAsArrayBuffer(file);
        });
        const wb = XLSX.read(ab, { type: "array", cellDates: true });

        for (const sheetName of wb.SheetNames) {
          const ws   = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
          const data = rows.filter(r => r.some(v => String(v).trim() !== ""));
          if (data.length < 2) continue;

          const headers  = data[0];
          const bodyRows = data.slice(1);
          const C = detectCols(headers);
          console.log("[FastTRAQS] Sheet:", sheetName, "| Headers:", headers.map((h,i)=>`${i}:${h}`).join(", "));
          console.log("[FastTRAQS] Column map:", JSON.stringify(Object.fromEntries(Object.entries(C).map(([k,v])=>[k, headers[v]]))));

          // Pre-pass: build level-value → rowType map dynamically from SH/level column
          // This avoids hardcoded conflicts (e.g. "1" meaning job vs panel)
          const levelMap = {};
          if (C.level !== undefined) {
            const seenNums = [];
            for (const r of bodyRows) {
              const v = getV(r, C.level);
              if (!v) continue;
              const n = parseFloat(v);
              if (!isNaN(n) && !seenNums.includes(n)) seenNums.push(n);
            }
            seenNums.sort((a, b) => a - b);
            // smallest → job, next → panel, rest → op
            seenNums.forEach((n, i) => {
              if (i === 0) levelMap[String(n)] = "job";
              else if (i === 1) levelMap[String(n)] = "panel";
              else levelMap[String(n)] = "op";
            });
            // Also handle string level values
            for (const r of bodyRows) {
              const v = getV(r, C.level);
              if (!v || levelMap[v]) continue;
              const lv = v.toLowerCase();
              if (["job","project","main","wbs"].includes(lv)) levelMap[v] = "job";
              else if (["panel","sub","subproject","section"].includes(lv)) levelMap[v] = "panel";
              else if (["op","operation","task","step","activity"].includes(lv)) levelMap[v] = "op";
            }
            console.log("[FastTRAQS] Level map:", levelMap);
          }

          let curJob   = null;
          let curPanel = null;

          for (const row of bodyRows) {
            const titleRaw  = getV(row, C.title);
            const jobNumRaw = getV(row, C.jobNumber);
            const mainId    = jobNumRaw || titleRaw;
            if (!mainId) continue;

            const startRaw = parseDate(getV(row, C.startDate)) || today;
            const endRaw   = parseDate(getV(row, C.endDate))   || addDays(startRaw, 14);
            const dueRaw   = parseDate(getV(row, C.dueDate))   || ""; // details only
            const personId = resolvePerson(getV(row, C.assignedTo));
            const clientId = resolveClient(getV(row, C.client));
            const notes    = getV(row, C.notes);
            const poNum    = getV(row, C.poNumber);
            const hpdRaw   = C.hpd !== undefined ? (parseFloat(getV(row, C.hpd)) || 0) : 0;

            // ── Detect row type ────────────────────────────────────────────
            let rowType = null;
            let opTitle = titleRaw || mainId; // label used when rowType="op"

            // 1. Level/SH column (most reliable when present)
            if (C.level !== undefined) {
              const lv = getV(row, C.level);
              rowType = levelMap[lv] ?? null;
            }

            // 2. Value pattern matching (runs if no level column or value not mapped)
            if (!rowType) {
              const numId = jobNumRaw || mainId;
              if (isPanelVal(numId)) {
                // Panel ID in number col — but if title is an op name, this is an op row
                // (common when panel number repeats for each op: "401988-01 | Wire")
                if (titleRaw && OP_NAMES.has(titleRaw.toLowerCase())) {
                  rowType = "op";
                  opTitle = titleRaw;
                } else {
                  rowType = "panel";
                }
              } else if (splitJobVal(numId)) {
                rowType = "job";
              } else if (OP_NAMES.has(mainId.toLowerCase())) {
                rowType = "op";
              } else if (titleRaw && OP_NAMES.has(titleRaw.toLowerCase())) {
                rowType = "op";
                opTitle = titleRaw;
              }
            }

            // 3. Context fallback — don't force everything to "job"
            if (!rowType) {
              if (curPanel) rowType = "op";      // unknown under panel → treat as op
              else if (!curJob) rowType = "job"; // very first row, no context → job
              // else: unknown row under a job with no panel — skip it
            }

            console.log(`[FastTRAQS] "${mainId}" / "${titleRaw}" → ${rowType}`);

            // ── Build objects ──────────────────────────────────────────────
            if (rowType === "job") {
              const split  = splitJobVal(mainId);
              const jNum   = split ? split.num : (jobNumRaw || mainId);
              const jTitle = split && split.title ? split.title
                           : (titleRaw && titleRaw !== jNum && !isPanelVal(titleRaw) ? titleRaw : jNum);

              const existing = tasks.find(t => t.jobNumber && t.jobNumber === jNum);
              if (existing) {
                const patch = {};
                if (dueRaw)   patch.dueDate   = dueRaw;
                if (poNum)    patch.poNumber  = poNum;
                if (clientId) patch.clientId  = clientId;
                if (notes)    patch.notes     = notes;
                if (Object.keys(patch).length) updTask(existing.id, patch);
                curJob = { ...existing, _existing: true };
                jobByNum[jNum] = curJob;
                totalUpdated++;
                curPanel = null;
              } else if (!jobByNum[jNum]) {
                curJob = { id: uid(), title: jTitle, jobNumber: jNum, start: startRaw, end: endRaw,
                  dueDate: dueRaw, pri: "Medium", status: "Not Started",
                  team: personId ? [personId] : [], color: "#3b82f6", hpd: hpdRaw,
                  notes, clientId: clientId || null, poNumber: poNum, deps: [], subs: [] };
                importedJobs.push(curJob);
                jobByNum[jNum] = curJob;
                totalJobs++;
                curPanel = null;
              } else {
                curJob = jobByNum[jNum];
                curPanel = null;
              }

            } else if (rowType === "panel") {
              const rawPanelId = cleanPanel(jobNumRaw || titleRaw);
              const pJobNum    = parentJobNum(rawPanelId);

              if (!curJob || curJob.jobNumber !== pJobNum) {
                const found = jobByNum[pJobNum] || tasks.find(t => t.jobNumber === pJobNum);
                if (found) {
                  curJob = found;
                } else {
                  curJob = { id: uid(), title: pJobNum, jobNumber: pJobNum,
                    start: startRaw, end: endRaw, dueDate: dueRaw,
                    pri: "Medium", status: "Not Started", team: [], color: "#3b82f6",
                    hpd: hpdRaw, notes: "", clientId: null, poNumber: "", deps: [], subs: [] };
                  importedJobs.push(curJob);
                  jobByNum[pJobNum] = curJob;
                  totalJobs++;
                }
              }

              curPanel = { id: uid(), title: rawPanelId, start: startRaw, end: endRaw,
                pri: "Medium", status: "Not Started",
                team: personId ? [personId] : [], hpd: hpdRaw, notes, deps: [], subs: [] };
              if (!curJob._existing) curJob.subs.push(curPanel);

            } else if (rowType === "op") {
              // If op was detected from a repeated panel ID (e.g. "401988-01 | Wire"),
              // auto-create/find the panel object so we can attach to it
              if (!curPanel && jobNumRaw && isPanelVal(jobNumRaw)) {
                const rawPanelId = cleanPanel(jobNumRaw);
                const pJobNum    = parentJobNum(rawPanelId);
                if (!curJob || curJob.jobNumber !== pJobNum) {
                  curJob = jobByNum[pJobNum] || tasks.find(t => t.jobNumber === pJobNum) || null;
                }
                if (curJob) {
                  const already = curJob.subs?.find(p => p.title === rawPanelId);
                  if (already) {
                    curPanel = already;
                  } else {
                    curPanel = { id: uid(), title: rawPanelId, start: startRaw, end: endRaw,
                      pri: "Medium", status: "Not Started", team: [], hpd: hpdRaw,
                      notes: "", deps: [], subs: [] };
                    if (!curJob._existing) curJob.subs.push(curPanel);
                  }
                }
              }
              if (curPanel) {
                curPanel.subs.push({ id: uid(), title: opTitle,
                  start: startRaw, end: endRaw, pri: "Medium", status: "Not Started",
                  team: personId ? [personId] : [], hpd: hpdRaw, notes,
                  deps: [], locked: false, subs: [] });
              }
            }
            // Unknown row type → skip (no fallback job creation)
          }
        }
      }

      const newPeopleList  = Object.values(pendingPeople);
      const newClientsList = Object.values(pendingClients);
      if (newPeopleList.length)  setPeople(prev  => [...prev, ...newPeopleList]);
      if (newClientsList.length) setClients(prev => [...prev, ...newClientsList]);
      if (importedJobs.length)   setTasks(prev   => [...prev, ...importedJobs]);

      const totalPeople  = newPeopleList.length;
      const totalClients = newClientsList.length;

      if (totalJobs === 0 && totalUpdated === 0) {
        setUploadResult({ success: false, message: "No jobs found. Make sure the file has job numbers starting with 40 (e.g. 401999 or 401999-01)." });
        setUploadProcessing(false); return;
      }

      const parts = [];
      if (totalJobs    > 0) parts.push(`Imported ${totalJobs} job${totalJobs !== 1 ? "s" : ""}`);
      if (totalUpdated > 0) parts.push(`Updated ${totalUpdated} existing`);
      if (totalPeople  > 0) parts.push(`Added ${totalPeople} team member${totalPeople !== 1 ? "s" : ""}`);
      if (totalClients > 0) parts.push(`Added ${totalClients} client${totalClients !== 1 ? "s" : ""}`);
      setUploadResult({ success: true, message: parts.join(" · ") + "." });
      setUploadText("");
      setUploadFiles([]);
    } catch (err) {
      console.error(err);
      setUploadResult({ success: false, message: "Error reading file: " + err.message });
    }
    setUploadProcessing(false);
  };
  const currentUser = loggedInUser ? loggedInUser.id : null;
  const isAdmin = loggedInUser ? loggedInUser.userRole === "admin" : false;
  const can = perm => isAdmin && (loggedInUser?.adminPerms == null || loggedInUser.adminPerms[perm] === true);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const [view, setView] = useState("schedule");
  const [taskSubView, setTaskSubView] = useState("cards"); // "cards" | "gantt"
  const [tasks, _setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [saveStatus, setSaveStatus] = useState("saved");
  const lastSaveTime = useRef(Date.now());
  const saveTimerRef = useRef(null);
  const dataRef = useRef({ tasks: null, people: null, clients: null });

  // Keep ref in sync for save functions
  useEffect(() => { dataRef.current.tasks = tasks; }, [tasks]);
  useEffect(() => { dataRef.current.people = people; }, [people]);

  // Global undo/redo history
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const skipHistory = useRef(false);
  const setTasks = useCallback((updater) => {
    _setTasks(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!skipHistory.current && next !== prev) {
        undoStack.current.push(JSON.parse(JSON.stringify(prev)));
        if (undoStack.current.length > 50) undoStack.current.shift(); // cap at 50
        redoStack.current = []; // clear redo on new action
      }
      skipHistory.current = false;
      return next;
    });
  }, []);
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    _setTasks(prev => {
      redoStack.current.push(JSON.parse(JSON.stringify(prev)));
      return undoStack.current.pop();
    });
  }, []);
  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    _setTasks(prev => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      return redoStack.current.pop();
    });
  }, []);
  // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ─── Job templates (localStorage-backed) ────────────────────────────────
  const [templates, setTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`tq_templates_${orgCode}`) || "[]"); } catch { return []; }
  });
  const persistTemplates = (newTemplates) => {
    setTemplates(newTemplates);
    localStorage.setItem(`tq_templates_${orgCode}`, JSON.stringify(newTemplates));
  };

  const [fStat, setFStat] = useState("All");
  const [fPers, setFPers] = useState([]);      // multi-select person IDs (strings); empty = All
  const [fJobNum, setFJobNum] = useState("");
  const [fRole, setFRole] = useState("All");  // filter by assigned person's role
  const [fHpd, setFHpd] = useState("All");    // filter by hours-per-day
  const [fOverloaded, setFOverloaded] = useState(false); // show only tasks with overbooked team
  const [jobSort, setJobSort] = useState("date"); // "date" | "project" | "client"
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askQ, setAskQ] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askHistory, setAskHistory] = useState([]);
  const [askExpanded, setAskExpanded] = useState(false);
  const [askBarQ, setAskBarQ] = useState("");
  const [pendingActions, setPendingActions] = useState(null); // { toolUses: [...], text: string }
  const lastSysPromptRef = useRef("");
  const askInputRef = useRef(null);
  const askBarInputRef = useRef(null);
  const askBarRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [engBlockError, setEngBlockError] = useState(null);
  const [engQueueOpen, setEngQueueOpen] = useState(true);
  const [personModal, setPersonModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [settingsUser, setSettingsUser] = useState(null);
  const [tagInputs, setTagInputs] = useState({}); // keyed by person.id
  const [saveTemplateModal, setSaveTemplateModal] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [dayDragInfo, setDayDragInfo] = useState(null);
  const [dayDragTarget, setDayDragTarget] = useState(null); // personId being hovered during team-day drag
  const [teamDayGhost, setTeamDayGhost] = useState(null); // { left, top, width, height, color, label }
  const [uploadModal, setUploadModal] = useState(false);
  const [fastTraqsPhase, setFastTraqsPhase] = useState("intro"); // "intro" | "input"
  const [fastTraqsExiting, setFastTraqsExiting] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const settingsRef = useRef(null);
  const navPillRef  = useRef(null);
  const navBtnRefs  = useRef({});
  const navPillTransitioned = useRef(false);
  // Runs after every render until pill is initialized — handles nav bar appearing after async auth
  useLayoutEffect(() => {
    if (navPillTransitioned.current) return;
    const btn = navBtnRefs.current[view];
    const pill = navPillRef.current;
    if (!btn || !pill) return;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    pill.style.width = `${btn.offsetWidth}px`;
    navPillTransitioned.current = true;
    requestAnimationFrame(() => { if (navPillRef.current) navPillRef.current.style.transition = "transform 0.44s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.38s cubic-bezier(0.22, 1, 0.36, 1)"; });
  }); // intentionally no dep array — bails immediately after first success
  // Animates pill on view change (only after initialization)
  useLayoutEffect(() => {
    if (!navPillTransitioned.current) return;
    const btn = navBtnRefs.current[view];
    const pill = navPillRef.current;
    if (!btn || !pill) return;
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    pill.style.width = `${btn.offsetWidth}px`;
  }, [view]);
  const [timeOffModal, setTimeOffModal] = useState(false);
  const [gStart, setGStart] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [gEnd, setGEnd] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  const [gMode, setGMode] = useState("month"); // day, week, month
  const [gSort, setGSort] = useState("date"); // date, project, client
  const [ganttViewMode, setGanttViewMode] = useState("linear"); // linear | calendar
  const [exp, setExp] = useState({});
  const [selBarId, setSelBarId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [quickAddSub, setQuickAddSub] = useState(null); // { type:"panel"|"op", parentId, grandParentId, title, start, end, x, y }
  const [clipboard, setClipboard] = useState(null); // { level, item }
  const [pasteConfirm, setPasteConfirm] = useState(null); // { x, y, startDate, endDate }
  const [reminderModal, setReminderModal] = useState(null);
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(null); // client id
  const [selTask, setSelTask] = useState(null);
  const [selJobs, setSelJobs] = useState(new Set());
  const [selClients, setSelClients] = useState(new Set());
  const [selPeople, setSelPeople] = useState(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(null); // { type, ids, count }
  const [clientSelectMode, setClientSelectMode] = useState(false);
  const [jobSelectMode, setJobSelectMode] = useState(false);
  const [teamSelectMode, setTeamSelectMode] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [reminderSending, setReminderSending] = useState(false);
  const [linkingFrom, setLinkingFrom] = useState(null);
  const [clients, setClients] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Load all data from S3 on mount; fall back to seed data if S3 is empty
  useEffect(() => {
    Promise.all([fetchTasks(orgCode), fetchPeople(orgCode), fetchClients(orgCode)])
      .then(([t, p, c]) => {
        _setTasks(Array.isArray(t) && t.length > 0 ? t : mkTasks());
        const resolvedPeople = Array.isArray(p) && p.length > 0 ? p : mkPeople();
        setPeople(resolvedPeople);
        setClients(Array.isArray(c) && c.length > 0 ? c : mkClients());
        // Match Auth0 user to a people record by email
        if (auth0User?.email) {
          const match = resolvedPeople.find(
            person => person.email && person.email.toLowerCase() === auth0User.email.toLowerCase()
          );
          setLoggedInUser(match || resolvedPeople[0] || null);
        } else {
          setLoggedInUser(resolvedPeople[0] || null);
        }
      })
      .catch(e => {
        console.error("Failed to load data from S3:", e);
        _setTasks(mkTasks());
        const fallbackPeople = mkPeople();
        setPeople(fallbackPeople);
        setClients(mkClients());
        setLoggedInUser(fallbackPeople[0] || null);
      })
      .finally(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep loggedInUser in sync with the live people array (e.g. after toggling isEngineer, role changes, etc.)
  useEffect(() => {
    if (!loggedInUser || people.length === 0) return;
    const updated = people.find(p => p.id === loggedInUser.id);
    if (updated && JSON.stringify(updated) !== JSON.stringify(loggedInUser)) {
      setLoggedInUser(updated);
    }
  }, [people]);

  // ─── Push notification token registration (disabled until APNs is ready) ──

  // ─── Chat & notifications state ──────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [chatThread, setChatThread] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatError, setChatError] = useState(null);
  const [chatUploading, setChatUploading] = useState(false);
  const chatFileInputRef = useRef(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const chatBottomRef = useRef(null);
  const [lastRead, setLastRead] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tq_last_read") || "{}"); } catch { return {}; }
  });
  const [groups, setGroups] = useState([]);
  const [newGroupModal, setNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupPeople, setNewGroupPeople] = useState([]);
  const [newGroupSaving, setNewGroupSaving] = useState(false);
  const [editGroupModal, setEditGroupModal] = useState(null); // { groupId, name, memberIds }
  const [quickChat, setQuickChat] = useState(null);
  const [quickChatInput, setQuickChatInput] = useState("");
  const [quickChatSending, setQuickChatSending] = useState(false);
  const quickChatBottomRef = useRef(null);
  const [pinnedGroups, setPinnedGroups] = useState(() => { try { return JSON.parse(localStorage.getItem("tq_pinned_groups") || "[]"); } catch { return []; } });
  const [groupCtxMenu, setGroupCtxMenu] = useState(null);
  const [lightboxAtt, setLightboxAtt] = useState(null);
  const [pinnedThreads, setPinnedThreads] = useState(() => { try { return JSON.parse(localStorage.getItem("tq_pinned_threads") || "[]"); } catch { return []; } });
  const [threadCtxMenu, setThreadCtxMenu] = useState(null);
  const [confirmClearChat, setConfirmClearChat] = useState(null); // { threadKey, label, isGroup, groupId }

  // Load messages + groups on mount
  useEffect(() => {
    if (!orgCode) return;
    fetchMessages(orgCode).then(setMessages).catch(() => {});
    fetchGroups(orgCode).then(setGroups).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (view !== "messages" || !orgCode) return;
    const id = setInterval(() => fetchMessages(orgCode).then(setMessages).catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [view, orgCode]);
  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const h = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [notifOpen]);
  // Scroll chat to bottom when thread or view changes, or new message arrives
  useEffect(() => {
    if (view === "messages" && chatBottomRef.current) chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [view, chatThread?.threadKey, messages.length]);
  // Scroll quick-chat to bottom when opened or new message arrives
  useEffect(() => {
    if (quickChat && quickChatBottomRef.current) quickChatBottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [quickChat?.threadKey, messages.length]);
  // Clear pending attachments when switching threads
  useEffect(() => { setChatAttachments([]); }, [chatThread?.threadKey]);

  // Sync dataRef for save functions
  useEffect(() => { dataRef.current.clients = clients; }, [clients]);

  // Auto-save system
  const doSave = useCallback(async () => {
    try {
      setSaveStatus("saving");
      const d = dataRef.current;
      await Promise.all([
        saveTasks(d.tasks, getToken, orgCode),
        savePeople(d.people, getToken, orgCode),
        saveClients(d.clients, getToken, orgCode),
      ]);
      lastSaveTime.current = Date.now();
      setTimeout(() => setSaveStatus("saved"), 600);
    } catch (e) {
      console.error("Auto-save failed:", e);
      setSaveStatus("unsaved");
    }
  }, [getToken]);

  const isInitialSave = useRef(true);
  useEffect(() => {
    if (isInitialSave.current) { isInitialSave.current = false; return; }
    setSaveStatus("unsaved");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { doSave(); }, 1000);
    return () => clearTimeout(saveTimerRef.current);
  }, [tasks, people, clients, doSave]);


  const [clientModal, setClientModal] = useState(null);
  const [fClient, setFClient] = useState("All");
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  const [selClient, setSelClient] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientCompletedExpanded, setClientCompletedExpanded] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [overlapError, setOverlapError] = useState(null); // { message, details[] }
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmMove, setConfirmMove] = useState(null); // { message, onConfirm }
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  useEffect(() => {
    const handler = e => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (askBarRef.current && !askBarRef.current.contains(e.target)) { setAskExpanded(false); setAskBarQ(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const [dropTarget, setDropTarget] = useState(null); // { personId } for team view drag
  const [rowDragId, setRowDragId] = useState(null);   // personId being row-dragged
  const [rowDragOver, setRowDragOver] = useState(null); // { type:"person"|"group", id, pos:"before"|"after" }
  const [ganttDragInfo, setGanttDragInfo] = useState(null); // { itemId, snapStart, snapEnd, hasOverlap }
  const [teamDragInfo, setTeamDragInfo] = useState(null);   // { barId, snapStart, snapEnd, targetPersonId, hasOverlap }
  const ganttRef = useRef(null);
  const ganttContainerRef = useRef(null);
  const [ganttWidth, setGanttWidth] = useState(0);
  const ganttCWRef = useRef(8);
  const teamCWRef = useRef(8);
  const ganttWheelAcc = useRef(0);
  const teamWheelAcc = useRef(0);
  useEffect(() => {
    const el = ganttContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setGanttWidth(e.contentRect.width); });
    ro.observe(el);
    setGanttWidth(el.clientWidth);
    return () => ro.disconnect();
  });

  useEffect(() => { const h = () => { setCtxMenu(null); setPtoCtx(null); setSettingsOpen(false); setFilterOpen(false); }; window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, []);
  useEffect(() => { const h = e => { if (e.key === "Escape") { setLinkingFrom(null); setCtxMenu(null); setPtoCtx(null); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  const allItems = useMemo(() => { let r = []; const tc = t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.color : T.accent; }; tasks.forEach(t => { const c = tc(t); r.push({ ...t, color: c, isSub: false, pid: null, level: 0 }); (t.subs || []).forEach(s => { r.push({ ...s, color: tc(s) || c, isSub: true, pid: t.id, level: 1 }); (s.subs || []).forEach(op => { r.push({ ...op, color: tc(op) || tc(s) || c, isSub: true, pid: s.id, grandPid: t.id, level: 2 }); }); }); }); return r; }, [tasks, people]);
  const taskColor = useCallback(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.color : T.accent; }, [people]);
  const taskOwner = useCallback(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.name.split(" ")[0] : null; }, [people]);
  const filtered = useMemo(() => tasks.filter(t => {
    if (fStat !== "All" && t.status !== fStat) return false;
    if (fPers.length > 0) {
      const pSet = new Set(fPers);
      const matchTeam = (idList) => (idList || []).some(id => pSet.has(String(id)));
      const onOp = (t.subs || []).some(panel => (panel.subs || []).some(op => matchTeam(op.team)));
      if (!matchTeam(t.team) && !onOp) return false;
    }
    if (fClient !== "All" && t.clientId !== fClient) return false;
    if (fRole !== "All") {
      const hasRole = (t.subs || []).some(panel => (panel.subs || []).some(op => { const person = people.find(x => (op.team || []).includes(x.id)); return person && person.role?.toLowerCase() === fRole.toLowerCase(); }));
      if (!hasRole) return false;
    }
    if (fHpd !== "All") {
      const hpdVal = +fHpd;
      const hasHpd = t.hpd === hpdVal || (t.subs || []).some(p => p.hpd === hpdVal || (p.subs || []).some(op => op.hpd === hpdVal));
      if (!hasHpd) return false;
    }
    if (fJobNum && !String(t.jobNumber || "").toLowerCase().includes(fJobNum.toLowerCase())) return false;
    if (fOverloaded) {
      // Inline booked-hours check (avoids referencing bookedHrs before it's defined)
      const todayStr = new Date().toISOString().slice(0, 10);
      const overloaded = (t.subs || []).some(panel => (panel.subs || []).some(op => (op.team || []).some(pid => {
        const person = people.find(x => x.id === pid); if (!person) return false;
        const pOff = (person.timeOff || []).some(to => todayStr >= to.start && todayStr <= to.end); if (pOff) return false;
        let h = 0; tasks.forEach(task => { (task.subs || []).forEach(pnl => { (pnl.subs || []).forEach(o => { if ((o.team || []).includes(pid) && todayStr >= o.start && todayStr <= o.end) h += (o.hpd || 0) / Math.max(1, (o.team || []).length); }); }); });
        return h > (person.cap || 8);
      })));
      if (!overloaded) return false;
    }
    return true;
  }).map(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); const c = p ? p.color : T.accent; return { ...t, color: c, subs: (t.subs || []).map(s => { const sp = people.find(x => x.id === (s.team || [])[0]); const sc = sp ? sp.color : c; return { ...s, color: sc, subs: (s.subs || []).map(op => { const opp = people.find(x => x.id === (op.team || [])[0]); return { ...op, color: opp ? opp.color : sc }; }) }; }) }; }), [tasks, fStat, fPers, fClient, fRole, fHpd, fJobNum, fOverloaded, people]);
  const isOff = useCallback((pid, date) => { const p = people.find(x => x.id === pid); if (!p) return false; return (p.timeOff || []).some(to => date >= to.start && date <= to.end); }, [people]);
  const getOffReason = useCallback((pid, date) => { const p = people.find(x => x.id === pid); if (!p) return null; const to = (p.timeOff || []).find(to => date >= to.start && date <= to.end); return to ? to.reason : null; }, [people]);
  const bookedHrs = useCallback((pid, date) => { if (isOff(pid, date)) return 0; let h = 0; tasks.forEach(t => { (t.subs || []).forEach(panel => { (panel.subs || []).forEach(op => { if (op.team.includes(pid) && date >= op.start && date <= op.end) h += (op.hpd || 0) / Math.max(1, op.team.length); }); }); /* Legacy: also check direct subs without ops */ if (!(t.subs || []).some(s => (s.subs || []).length > 0)) { if (t.team.includes(pid) && date >= t.start && date <= t.end) h += (t.hpd || 0) / Math.max(1, t.team.length); (t.subs || []).forEach(s => { if (s.team.includes(pid) && date >= s.start && date <= s.end) h += (s.hpd || 0) / Math.max(1, s.team.length); }); } }); return h; }, [tasks, isOff]);

  // Job-tag claim rule: tagged people exclusively own matching contexts; untagged fill unclaimed slots
  const canAssignPerson = (person, opTitle, jobTitle, jobNum, clientName) => {
    const context = `${opTitle || ""} ${jobTitle || ""} ${jobNum || ""} ${clientName || ""}`.toLowerCase();
    const personTags = person.jobTags || [];
    if (personTags.length === 0) {
      return !people.some(p => (p.jobTags || []).length > 0 &&
        (p.jobTags || []).some(t => context.includes(t.toLowerCase())));
    } else {
      return personTags.some(t => context.includes(t.toLowerCase()));
    }
  };

  // Unique roles and hpd values for filter panel
  const uniqueRoles = useMemo(() => [...new Set(people.map(p => p.role).filter(Boolean))].sort(), [people]);
  const uniqueHpd = useMemo(() => {
    const vals = new Set();
    tasks.forEach(t => { if (t.hpd) vals.add(t.hpd); (t.subs || []).forEach(p => { if (p.hpd) vals.add(p.hpd); (p.subs || []).forEach(op => { if (op.hpd) vals.add(op.hpd); }); }); });
    return [...vals].sort((a, b) => a - b);
  }, [tasks]);
  const activeFilterCount = (fRole !== "All" ? 1 : 0) + (fHpd !== "All" ? 1 : 0) + fPers.length + (fJobNum ? 1 : 0) + (fStat !== "All" ? 1 : 0) + (fClient !== "All" ? 1 : 0) + (fOverloaded ? 1 : 0);

  // Check overlaps for a set of operations against a given task list
  // opsToCheck: [{ personId, start, end, opTitle, panelTitle, excludeOpId }]
  const checkOverlapsPure = (taskList, opsToCheck) => {
    const conflicts = [];
    for (const check of opsToCheck) {
      if (!check.personId || !check.start || !check.end) continue;
      const person = people.find(x => x.id === check.personId);
      if (!person) continue;
      const cap = person.cap || 8;
      const newHpd = (check.hpd || 7.5) / Math.max(1, check.teamLength || 1);
      let d = check.start;
      while (d <= check.end) {
        if (!isOff(check.personId, d)) {
          let existingH = 0;
          for (const job of taskList) {
            for (const panel of (job.subs || [])) {
              for (const op of (panel.subs || [])) {
                if (op.id === check.excludeOpId || op.status === "Finished") continue;
                if (!(op.team || []).includes(check.personId)) continue;
                if (d >= op.start && d <= op.end)
                  existingH += (op.hpd || 7.5) / Math.max(1, op.team.length);
              }
            }
          }
          if (existingH + newHpd > cap) {
            conflicts.push({
              person: person.name, personColor: person.color,
              opTitle: `Over capacity (${Math.round((existingH + newHpd) * 10) / 10}h / ${cap}h)`,
              panelTitle: check.panelTitle || "", jobTitle: check.opTitle || "",
              start: d, end: d
            });
            break;
          }
        }
        d = addD(d, 1);
      }
      for (const to of (person.timeOff || [])) {
        if (to.start <= check.end && to.end >= check.start) {
          conflicts.push({ person: person.name, personColor: person.color, opTitle: "Time Off", panelTitle: to.reason || to.type || "PTO", jobTitle: "", start: to.start, end: to.end, isPto: true });
        }
      }
    }
    return conflicts;
  };
  const checkOverlaps = (opsToCheck) => checkOverlapsPure(tasks, opsToCheck);

  // Show overlap error if conflicts found, returns true if blocked
  const showOverlapIfAny = useCallback((conflicts) => {
    if (conflicts.length === 0) return false;
    const details = conflicts.map(c => c.isPto
      ? `${c.person} has "${c.panelTitle}" time off (${fm(c.start)} – ${fm(c.end)})`
      : `${c.person} working on "${c.opTitle} – ${c.panelTitle}" from ${c.jobTitle ? `job ${c.jobTitle}` : ""} (${fm(c.start)} – ${fm(c.end)})`
    );
    const unique = [...new Set(details)];
    setOverlapError({ message: "Overlapping Schedule Error", details: unique });
    return true;
  }, []);

  // Show locked error
  const showLockedError = useCallback((lockedOps) => {
    const details = lockedOps.map(l => `"${l.opTitle} – ${l.panelTitle}" is locked and cannot be pushed`);
    setOverlapError({ message: "Locked Job Error", details });
  }, []);

  // Preview what ops would be pushed if we move an op to new dates (pure, does NOT apply changes)
  const previewPush = (taskList, movedOpId, personId, newStart, newEnd, excludeOpIds = null) => {
    const allOps = [];
    taskList.forEach(job => {
      (job.subs || []).forEach(panel => {
        (panel.subs || []).forEach(op => {
          if (op.id !== movedOpId && op.team.includes(personId) && op.status !== "Finished") {
            if (excludeOpIds && excludeOpIds.has(op.id)) return; // skip sibling ops in same move
            allOps.push({ op, panel, job });
          }
        });
      });
    });
    const overlapping = allOps.filter(a => a.op.start <= newEnd && a.op.end >= newStart);
    if (overlapping.length === 0) return { pushes: [], blocked: false, lockedOps: [] };
    const locked = overlapping.filter(a => a.op.locked);
    if (locked.length > 0) return { pushes: [], blocked: true, lockedOps: locked.map(l => ({ opTitle: l.op.title, panelTitle: l.panel.title })) };
    overlapping.sort((a, b) => a.op.start.localeCompare(b.op.start));
    let pushDate = newEnd;
    const toPush = [...overlapping];
    const pushes = [];
    while (toPush.length > 0) {
      const item = toPush.shift();
      const opBizDays = diffBD(item.op.start, item.op.end);
      const newOpStart = addBD(pushDate, 1);
      const newOpEnd = addBD(newOpStart, opBizDays);
      if (item.op.locked) return { pushes: [], blocked: true, lockedOps: [{ opTitle: item.op.title, panelTitle: item.panel.title }] };
      const daysPushed = diffBD(item.op.start, newOpStart);
      pushes.push({ opId: item.op.id, opTitle: item.op.title, panelTitle: item.panel.title, jobTitle: item.job.title, oldStart: item.op.start, oldEnd: item.op.end, newStart: newOpStart, newEnd: newOpEnd, daysPushed, personId: item.op.team[0] });
      pushDate = newOpEnd;
      const nextOverlaps = allOps.filter(a => a.op.id !== item.op.id && !toPush.includes(a) && a.op.start <= newOpEnd && a.op.end >= newOpStart);
      nextOverlaps.forEach(n => { if (!toPush.find(x => x.op.id === n.op.id) && !pushes.find(x => x.opId === n.op.id)) toPush.push(n); });
    }
    return { pushes, blocked: false, lockedOps: [] };
  };

  // Apply pushes + move log entries to task list
  const applyPushes = (taskList, pushes, movedBy) => {
    let result = JSON.parse(JSON.stringify(taskList));
    for (const p of pushes) {
      result = result.map(job => ({ ...job, subs: (job.subs || []).map(panel => ({ ...panel, subs: (panel.subs || []).map(op => {
        if (op.id === p.opId) {
          const logEntry = { fromStart: op.start, fromEnd: op.end, toStart: p.newStart, toEnd: p.newEnd, date: TD, movedBy, reason: p.reason || "Pushed by schedule conflict" };
          return { ...op, start: p.newStart, end: p.newEnd, moveLog: [...(op.moveLog || []), logEntry] };
        }
        return op;
      }) })) }));
    }
    return recalcBounds(result, movedBy);
  };

  // Preview pull-back: when moving backward, pull subsequent same-person ops back to fill gaps
  const previewPullBack = (taskList, movedPersonIds, oldStart, newStart, excludeOpIds = null) => {
    // Only pull back when moving backward
    if (newStart >= oldStart) return [];
    const pulls = [];
    for (const personId of movedPersonIds) {
      // Gather all ops for this person, sorted by start date
      const personOps = [];
      taskList.forEach(job => {
        (job.subs || []).forEach(panel => {
          (panel.subs || []).forEach(op => {
            if (op.team.includes(personId) && op.status !== "Finished" && !(excludeOpIds && excludeOpIds.has(op.id)) && !op.locked) {
              personOps.push({ op, panel, job });
            }
          });
        });
      });
      personOps.sort((a, b) => a.op.start.localeCompare(b.op.start));
      // For each op, try to pull it back to earliest available slot after its predecessor
      for (let i = 0; i < personOps.length; i++) {
        const { op, panel, job } = personOps[i];
        const opDuration = diffBD(op.start, op.end);
        // Find the earliest start: after any predecessor for this person ends
        let earliestStart = null;
        for (let j = i - 1; j >= 0; j--) {
          const prev = pulls.find(p => p.opId === personOps[j].op.id);
          const prevEnd = prev ? prev.newEnd : personOps[j].op.end;
          if (!earliestStart || addBD(prevEnd, 1) > earliestStart) earliestStart = addBD(prevEnd, 1);
        }
        if (!earliestStart) earliestStart = op.start; // no predecessor, can't pull further back than current
        // Don't push forward, only pull back or stay
        const newOpStart = earliestStart < op.start ? nextBD(earliestStart) : op.start;
        const newOpEnd = addBD(newOpStart, opDuration);
        if (newOpStart < op.start) {
          const daysPulled = diffBD(newOpStart, op.start);
          pulls.push({ opId: op.id, opTitle: op.title, panelTitle: panel.title, jobTitle: job.title, oldStart: op.start, oldEnd: op.end, newStart: newOpStart, newEnd: newOpEnd, daysPulled, personId, reason: "Pulled back by schedule change" });
        }
      }
    }
    return pulls;
  };

  // Recalculate panel bounds from ops, recalc job bounds
  const recalcBounds = (taskList, movedBy) => {
    return taskList.map(job => {
      let panels = (job.subs || []).map(panel => {
        const ops = (panel.subs || []);
        if (ops.length === 0) return panel;
        const earliest = ops.reduce((a, b) => a.start < b.start ? a : b).start;
        const latest = ops.reduce((a, b) => a.end > b.end ? a : b).end;
        if (earliest === panel.start && latest === panel.end) return panel;
        return { ...panel, start: earliest, end: latest };
      });
      // Recalc job bounds from panels
      if (panels.length > 0) {
        const jStart = panels.reduce((a, b) => a.start < b.start ? a : b).start;
        const jEnd = panels.reduce((a, b) => a.end > b.end ? a : b).end;
        return { ...job, start: jStart, end: jEnd, subs: panels };
      }
      return { ...job, subs: panels };
    });
  };

  // State for push confirmation modal
  const [confirmPush, setConfirmPush] = useState(null); // { message, pushes, onConfirm, onCancel }


  // Toggle lock on an operation
  const toggleLock = (opId, panelId) => {
    setTasks(prev => prev.map(job => ({ ...job, subs: (job.subs || []).map(panel => {
      if (panel.id === panelId) return { ...panel, subs: (panel.subs || []).map(op => op.id === opId ? { ...op, locked: !op.locked } : op) };
      // Also check nested
      return { ...panel, subs: (panel.subs || []).map(op => op.id === opId ? { ...op, locked: !op.locked } : op) };
    }) })));
  };
  const updPerson = (id, upd) => setPeople(p => p.map(x => x.id === id ? { ...x, ...upd } : x));

  const startRowDrag = (e, personId) => {
    e.preventDefault(); e.stopPropagation();
    setRowDragId(personId);
    document.body.style.cursor = "grabbing";
    const onMove = me => {
      const el = document.elementFromPoint(me.clientX, me.clientY);
      const rowEl = el?.closest("[data-rowtype]");
      if (!rowEl) { setRowDragOver(null); return; }
      const rtype = rowEl.dataset.rowtype;
      const rid = rowEl.dataset.rowid;
      if (rtype === "person" && rid !== String(personId)) {
        const rect = rowEl.getBoundingClientRect();
        const pos = me.clientY < rect.top + rect.height / 2 ? "before" : "after";
        setRowDragOver({ type: "person", id: Number(rid), pos });
      } else if (rtype === "group") {
        setRowDragOver({ type: "group", id: rid });
      } else {
        setRowDragOver(null);
      }
    };
    const onUp = () => {
      document.body.style.cursor = "";
      setRowDragId(pid => {
        // apply drop inside setState to get latest rowDragOver via closure
        setRowDragOver(over => {
          if (over && pid != null) {
            if (over.type === "person") {
              const targetNumId = over.id;
              setPeople(prev => {
                const targetPerson = prev.find(p => p.id === targetNumId);
                if (!targetPerson) return prev;
                const dragged = { ...prev.find(p => p.id === personId), role: targetPerson.role };
                const without = prev.filter(p => p.id !== personId);
                const tIdx = without.findIndex(p => p.id === targetNumId);
                const insertAt = over.pos === "before" ? tIdx : tIdx + 1;
                const result = [...without];
                result.splice(insertAt, 0, dragged);
                return result;
              });
            } else if (over.type === "group") {
              setPeople(prev => prev.map(p => p.id === personId ? { ...p, role: over.id } : p));
            }
          }
          return null;
        });
        return null;
      });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const updTimeOff = (pid, idx, upd) => setPeople(pp => pp.map(p => p.id === pid ? { ...p, timeOff: (p.timeOff || []).map((to, i) => i === idx ? { ...to, ...upd } : to) } : p));
  const delTimeOff = (pid, idx) => setPeople(pp => pp.map(p => p.id === pid ? { ...p, timeOff: (p.timeOff || []).filter((_, i) => i !== idx) } : p));
  const [ptoCtx, setPtoCtx] = useState(null); // { x, y, bar, personId, toIdx }
  const [timeOffEdit, setTimeOffEdit] = useState(null); // { personId, idx, start, end, reason }
  const addPerson = (data) => { setPeople(p => [...p, { ...data, id: uid(), color: data.color || COLORS[p.length % COLORS.length] }]); setPersonModal(null); };
  const delPerson = (id) => { setPeople(p => p.filter(x => x.id !== id)); setTasks(p => p.map(t => ({ ...t, team: t.team.filter(x => x !== id), subs: (t.subs || []).map(s => ({ ...s, team: s.team.filter(x => x !== id) })) }))); };
  const savePerson = (ed) => {
    if (!ed.name.trim()) return;
    if (!ed.email?.trim()) return;
    // Enforce single team lead per team: clear isTeamLead from all other members of the same team
    if (ed.isTeamLead && ed.teamNumber) {
      setPeople(pp => pp.map(p => p.id !== ed.id && p.teamNumber && String(p.teamNumber) === String(ed.teamNumber) && p.isTeamLead ? { ...p, isTeamLead: false } : p));
    }
    if (ed.id && people.find(x => x.id === ed.id)) updPerson(ed.id, ed); else addPerson(ed);
    setPersonModal(null);
  };
  const updTask = (id, upd, pid = null) => {
    // Engineering block: if setting a Wire/Cut/Layout op to In Progress or Finished,
    // check that the parent panel's engineering sign-off is complete.
    if (pid && upd.status && ["In Progress", "Finished"].includes(upd.status)) {
      for (const job of tasks) {
        const panel = (job.subs || []).find(s => s.id === pid);
        if (panel) {
          const opInPanel = (panel.subs || []).some(op => op.id === id);
          if (opInPanel && panel.engineering !== undefined) {
            const e = panel.engineering || {};
            if (!(e.designed && e.verified && e.sentToPerforex)) {
              setEngBlockError(`Engineering sign-off required before shop work can begin on ${panel.title}.`);
              setTimeout(() => setEngBlockError(null), 4000);
              return;
            }
          }
          break;
        }
      }
    }
    setTasks(p => p.map(t => {
    if (pid) {
      // Level 2: updating an operation (Wire/Cut/Layout) — moves independently, no chaining
      const panelIdx = (t.subs || []).findIndex(s => s.id === pid);
      if (panelIdx >= 0) {
        const panel = t.subs[panelIdx];
        const newOps = (panel.subs || []).map(op => op.id === id ? { ...op, ...upd } : op);
        let newSubs = [...t.subs]; newSubs[panelIdx] = { ...panel, subs: newOps };
        return { ...t, subs: newSubs };
      }
      // Level 1: updating a panel — operations move with it
      if (t.id === pid) {
        const newSubs = (t.subs || []).map(s => {
          if (s.id !== id) return s;
          const updated = { ...s, ...upd };
          const ops = s.subs || [];
          if (ops.length > 0 && (upd.start || upd.end)) {
            const startDelta = upd.start ? diffD(s.start, upd.start) : 0;
            const endDelta = upd.end ? diffD(s.end, upd.end) : 0;
            // Move: both start+end shift same amount — shift all ops equally
            if (upd.start && upd.end && startDelta === endDelta && startDelta !== 0) {
              updated.subs = ops.map(op => ({ ...op, start: addD(op.start, startDelta), end: addD(op.end, startDelta) }));
            }
            // Left resize: panel start moved — shift first op's start
            else if (upd.start && !upd.end && startDelta !== 0) {
              updated.subs = ops.map((op, i) => i === 0 ? { ...op, start: addD(op.start, startDelta) } : op);
            }
            // Right resize: panel end moved — shift last op's end
            else if (upd.end && !upd.start && endDelta !== 0) {
              const last = ops.length - 1;
              updated.subs = ops.map((op, i) => i === last ? { ...op, end: addD(op.end, endDelta) } : op);
            }
          }
          return updated;
        });
        return { ...t, subs: newSubs };
      }
      return t;
    }
    // Level 0: updating a job — everything inside moves with it
    if (t.id === id) {
      const updated = { ...t, ...upd };
      if ((upd.start || upd.end) && (t.subs || []).length > 0) {
        const startDelta = upd.start ? diffD(t.start, upd.start) : 0;
        const endDelta = upd.end ? diffD(t.end, upd.end) : 0;
        // Move: shift all panels and their operations equally
        if (upd.start && upd.end && startDelta === endDelta && startDelta !== 0) {
          updated.subs = (t.subs || []).map(s => ({
            ...s, start: addD(s.start, startDelta), end: addD(s.end, startDelta),
            subs: (s.subs || []).map(op => ({ ...op, start: addD(op.start, startDelta), end: addD(op.end, startDelta) }))
          }));
        }
      }
      return updated;
    }
    return t;
  }));
  };

  const reassignTask = (taskId, fromPersonId, toPersonId, parentId = null) => {
    if (fromPersonId === toPersonId) return;
    setTasks(p => p.map(t => {
      if (parentId) {
        // Check if parentId is a panel inside this job
        const panelIdx = (t.subs || []).findIndex(s => s.id === parentId);
        if (panelIdx >= 0) {
          const newSubs = [...t.subs];
          newSubs[panelIdx] = { ...newSubs[panelIdx], subs: (newSubs[panelIdx].subs || []).map(op => op.id === taskId ? { ...op, team: op.team.map(x => x === fromPersonId ? toPersonId : x) } : op) };
          return { ...t, subs: newSubs };
        }
        // Check if parentId is this job
        if (t.id === parentId) return { ...t, subs: (t.subs || []).map(s => s.id === taskId ? { ...s, team: s.team.map(x => x === fromPersonId ? toPersonId : x) } : s) };
        return t;
      }
      if (t.id === taskId) return { ...t, team: t.team.map(x => x === fromPersonId ? toPersonId : x) };
      return t;
    }));
  };
  const delTask = (id, pid = null) => setTasks(p => { let n = pid ? p.map(t => t.id === pid ? { ...t, subs: (t.subs || []).filter(s => s.id !== id) } : t) : p.filter(t => t.id !== id); return n.map(t => ({ ...t, deps: (t.deps || []).filter(d => d !== id), subs: (t.subs || []).map(s => ({ ...s, deps: (s.deps || []).filter(d => d !== id) })) })); });
  const cascadeDeps = (movedId, delta) => setTasks(p => p.map(t => { let nt = { ...t, subs: [...(t.subs || [])] }; if ((t.deps || []).includes(movedId)) { nt.start = addD(t.start, delta); nt.end = addD(t.end, delta); nt.subs = nt.subs.map(s => ({ ...s, start: addD(s.start, delta), end: addD(s.end, delta) })); } else nt.subs = nt.subs.map(s => (s.deps || []).includes(movedId) ? { ...s, start: addD(s.start, delta), end: addD(s.end, delta) } : s); return nt; }));
  const toggleDep = (taskId, depId) => setTasks(p => p.map(t => { if (t.id === taskId) { const d = t.deps || []; return { ...t, deps: d.includes(depId) ? d.filter(x => x !== depId) : [...d, depId] }; } return { ...t, subs: (t.subs || []).map(s => { if (s.id === taskId) { const d = s.deps || []; return { ...s, deps: d.includes(depId) ? d.filter(x => x !== depId) : [...d, depId] }; } return s; }) }; }));
  const pName = id => { const p = people.find(x => x.id === id); return p ? (p.teamNumber ? `${p.teamNumber} - ${p.name.split(" ")[0]}` : p.name.split(" ")[0]) : "?"; };
  const clientName = id => { const c = clients.find(x => x.id === id); return c ? c.name : "—"; };
  const clientColor = id => { const c = clients.find(x => x.id === id); return c ? c.color : T.textDim; };
  const saveClient = (ed) => {
    if (!ed.name.trim()) return;
    if (ed.id && clients.find(c => c.id === ed.id)) setClients(p => p.map(c => c.id === ed.id ? ed : c));
    else setClients(p => [...p, { ...ed, id: "c" + Math.random().toString(36).substr(2, 6) }]);
    setClientModal(null);
  };
  const delClient = id => { setClients(p => p.filter(c => c.id !== id)); setTasks(p => p.map(t => t.clientId === id ? { ...t, clientId: null } : t)); };
  const openNew = (pid = null) => setModal({ type: "edit", data: { id: null, title: "", jobNumber: "", poNumber: "", drawingNumber: "", start: TD, end: addD(TD, 3), dueDate: "", pri: "Medium", status: "Not Started", team: [], color: T.accent, hpd: 7.5, notes: "", subs: [], deps: [], clientId: null, customOps: [] }, parentId: pid });
  const openEdit = (t, pid = null) => setModal({ type: "edit", data: { ...t }, parentId: pid });
  const openDetail = t => setModal({ type: "detail", data: t, parentId: null });

  const AI_TOOLS = [
    { name: "update_task_status", description: "Update the status of an existing task", input_schema: { type: "object", properties: { task_id: { type: "string", description: "The task ID from the context" }, status: { type: "string", enum: ["Not Started", "In Progress", "Finished", "On Hold"] } }, required: ["task_id", "status"] } },
    { name: "reschedule_task", description: "Change the start and/or end date of a task", input_schema: { type: "object", properties: { task_id: { type: "string" }, start: { type: "string", description: "New start date YYYY-MM-DD" }, end: { type: "string", description: "New end date YYYY-MM-DD" } }, required: ["task_id"] } },
    { name: "assign_person", description: "Add a team member to a task", input_schema: { type: "object", properties: { task_id: { type: "string" }, person_id: { type: "string", description: "The person ID from the context" } }, required: ["task_id", "person_id"] } },
    { name: "remove_person", description: "Remove a team member from a task", input_schema: { type: "object", properties: { task_id: { type: "string" }, person_id: { type: "string" } }, required: ["task_id", "person_id"] } },
    { name: "create_task", description: "Create a new task", input_schema: { type: "object", properties: { title: { type: "string" }, start: { type: "string", description: "YYYY-MM-DD" }, end: { type: "string", description: "YYYY-MM-DD" }, team_ids: { type: "array", items: { type: "string" } }, priority: { type: "string", enum: ["Low", "Medium", "High"] } }, required: ["title", "start", "end"] } },
  ];

  const buildAskSysPrompt = () => {
    const todayStr = TD;
    const peopleCtx = people.map(p => {
      const activeJobs = tasks.filter(t => (t.team || []).includes(p.id) && t.status !== "Finished" && t.end >= todayStr);
      const todayH = bookedHrs(p.id, todayStr);
      return `${p.name} [id:${p.id}] (${p.role}, ${p.cap}h/day cap): today=${todayH.toFixed(1)}h booked, active jobs: ${activeJobs.map(t => `"${t.title}" (${t.start}–${t.end})`).join("; ") || "none"}`;
    }).join("\n");
    const jobsCtx = tasks.filter(t => t.status !== "Finished").map(t => {
      const team = (t.team || []).map(id => people.find(p => p.id === id)?.name || id).join(", ");
      const client = t.clientId ? clients.find(c => c.id === t.clientId)?.name || "" : "";
      const ops = (t.subs || []).flatMap(panel => (panel.subs || []).map(op => {
        const opTeam = (op.team || []).map(id => people.find(p => p.id === id)?.name || id).join(", ");
        return `  ${panel.title}/${op.title}: ${op.start}–${op.end}${opTeam ? `, assigned: ${opTeam}` : ""}`;
      }));
      return `Task "${t.title}" [id:${t.id}]${t.jobNumber ? ` (#${t.jobNumber})` : ""}${client ? ` [${client}]` : ""}: status=${t.status}, dates=${t.start}–${t.end}${team ? `, team: ${team}` : ""}${ops.length > 0 ? `\n${ops.join("\n")}` : ""}`;
    }).join("\n\n");
    return `You are TRAQS AI, a scheduling assistant for a steel/metal fabrication and electrical panel shop. Today is ${todayStr}.

TEAM MEMBERS (use these IDs in tool calls):
${peopleCtx || "No team members."}

ACTIVE TASKS (use these IDs in tool calls):
${jobsCtx || "No active tasks."}

Answer scheduling questions conversationally. Be specific: name actual people, jobs, and dates. When asked to take an action (mark as finished, reschedule, assign someone, create a task), use the appropriate tool. Always confirm tool use with a brief sentence saying what you're about to do. Keep responses focused and actionable.`;
  };

  const describeAction = (name, input) => {
    const task = allItems.find(x => x.id === input.task_id) || tasks.find(x => x.id === input.task_id);
    const taskLabel = task ? `"${task.title}"` : input.task_id;
    const person = people.find(x => x.id === input.person_id);
    const personLabel = person ? person.name : input.person_id;
    switch (name) {
      case "update_task_status": return `Set ${taskLabel} → ${input.status}`;
      case "reschedule_task": return `Reschedule ${taskLabel} to ${input.start || "?"}${input.end ? ` – ${input.end}` : ""}`;
      case "assign_person": return `Add ${personLabel} to ${taskLabel}`;
      case "remove_person": return `Remove ${personLabel} from ${taskLabel}`;
      case "create_task": return `Create task "${input.title}" (${input.start} – ${input.end})`;
      default: return name;
    }
  };

  const executeConfirmedActions = async () => {
    if (!pendingActions) return;
    const { toolUses } = pendingActions;
    for (const tu of toolUses) {
      const { name, input } = tu;
      switch (name) {
        case "update_task_status": updTask(input.task_id, { status: input.status }); break;
        case "reschedule_task": updTask(input.task_id, { ...(input.start && { start: input.start }), ...(input.end && { end: input.end }) }); break;
        case "assign_person": setTasks(prev => prev.map(t => t.id === input.task_id ? { ...t, team: [...new Set([...(t.team || []), input.person_id])] } : t)); break;
        case "remove_person": setTasks(prev => prev.map(t => t.id === input.task_id ? { ...t, team: (t.team || []).filter(id => id !== input.person_id) } : t)); break;
        case "create_task": setTasks(prev => [...prev, { id: uid(), title: input.title, start: input.start, end: input.end, status: "Not Started", team: input.team_ids || [], pri: input.priority || "Medium", subs: [], deps: [], hpd: 7.5, notes: "", color: T.accent, customOps: [] }]); break;
      }
    }
    const toolResults = toolUses.map(tu => ({ type: "tool_result", tool_use_id: tu.id, content: "Action completed successfully." }));
    const toolResultMsg = { role: "user", content: toolResults };
    setAskHistory(h => [...h, toolResultMsg]);
    setPendingActions(null);
    setAskLoading(true);
    try {
      const fullHistory = [...askHistory, toolResultMsg];
      const data = await callAI({ system: lastSysPromptRef.current, messages: fullHistory.map(m => ({ role: m.role, content: m.content })), max_tokens: 512, tools: AI_TOOLS, tool_choice: { type: "auto" } }, getToken);
      setAskHistory(h => [...h, { role: "assistant", content: data.content }]);
    } catch (e) {
      setAskHistory(h => [...h, { role: "assistant", content: "Done! Actions applied successfully." }]);
    } finally {
      setAskLoading(false);
      setTimeout(() => askInputRef.current?.focus(), 50);
    }
  };

  const handleAskTraqs = async (questionOverride = null) => {
    const q = (questionOverride ?? askQ).trim();
    if (!q || askLoading) return;
    if (!questionOverride) setAskQ("");
    // Only push to history if not already added by the caller (bar submits pre-add it)
    if (!questionOverride) setAskHistory(h => [...h, { role: "user", content: q }]);
    setAskLoading(true);
    try {
      const sysPrompt = buildAskSysPrompt();
      lastSysPromptRef.current = sysPrompt;
      const history = [...askHistory, { role: "user", content: q }];
      const messages = history.map(m => ({ role: m.role, content: m.content }));
      const data = await callAI({ system: sysPrompt, messages, max_tokens: 1024, tools: AI_TOOLS, tool_choice: { type: "auto" } }, getToken);
      const toolUseBlocks = (data.content || []).filter(b => b.type === "tool_use");
      setAskHistory(h => [...h, { role: "assistant", content: data.content }]);
      if (toolUseBlocks.length > 0) {
        const textContent = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
        setPendingActions({ toolUses: toolUseBlocks, text: textContent });
      }
    } catch (e) {
      setAskHistory(h => [...h, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setAskLoading(false);
      setTimeout(() => askInputRef.current?.focus(), 50);
    }
  };
  const openDeps = id => setModal({ type: "deps", data: allItems.find(x => x.id === id), parentId: null });
  const openAvail = () => setModal({ type: "avail", data: null, parentId: null });
  const closeModal = () => { setModal(null); setAiSuggestion(null); setAiLoading(false); };
  const saveTask = (ed, parentId) => {
    if (!ed.title.trim()) return;
    // Check overlaps for all operations in this job against OTHER jobs only
    const opsToCheck = [];
    (ed.subs || []).forEach(sub => {
      if ((sub.subs || []).length > 0) {
        // Panel-style: nested ops
        (sub.subs || []).forEach(op => {
          if (op.team && op.team[0]) {
            opsToCheck.push({ personId: op.team[0], start: op.start, end: op.end, opTitle: op.title, panelTitle: sub.title || "", excludeOpId: op.id, hpd: op.hpd, teamLength: (op.team || []).length });
          }
        });
      } else if ((sub.team || []).length > 0) {
        // Flat subtask (non-panel job)
        opsToCheck.push({ personId: sub.team[0], start: sub.start, end: sub.end, opTitle: sub.title, panelTitle: "", excludeOpId: sub.id, hpd: sub.hpd, teamLength: (sub.team || []).length });
      }
    });
    // Exclude all ops from the job being edited
    const editJobOpIds = new Set();
    if (ed.id) {
      const existingJob = tasks.find(j => j.id === ed.id);
      if (existingJob) (existingJob.subs || []).forEach(p => (p.subs || []).forEach(op => editJobOpIds.add(op.id)));
    }
    const filteredTasks = ed.id ? tasks.map(j => j.id === ed.id ? { ...j, subs: [] } : j) : tasks;
    const conflicts = checkOverlapsPure(filteredTasks, opsToCheck);
    if (conflicts.length > 0) { showOverlapIfAny(conflicts); return; }
    // Generate IDs for panels and their operations
    const isGeneralTask = (ed.jobType || "panel") !== "panel";
    const withIds = { ...ed, subs: (ed.subs || []).map(panel => isGeneralTask
      ? { ...panel, id: panel.id || uid() }
      : { ...panel, id: panel.id || uid(), subs: (panel.subs || []).map(op => ({ ...op, id: op.id || uid() })) }
    ) };
    if (withIds.id) updTask(withIds.id, withIds, parentId);
    else { const nw = { ...withIds, id: uid() }; if (parentId) setTasks(p => p.map(t => t.id === parentId ? { ...t, subs: [...(t.subs || []), nw] } : t)); else setTasks(p => [...p, nw]); }
    closeModal();
  };
  const views = [{ id: "schedule", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>, label: "Schedule" }, { id: "tasks", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>, label: "Jobs" }, { id: "clients", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg>, label: "Clients" }, { id: "analytics", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>, label: "Analytics" }, { id: "messages", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, label: "Messages" }];
  const ctxDeps = ctxMenu ? (ctxMenu.item.deps || []).map(did => allItems.find(x => x.id === did)).filter(Boolean) : [];
  const ctxBlocks = ctxMenu ? allItems.filter(x => (x.deps || []).includes(ctxMenu.item.id)) : [];
  const handleCtx = (e, item, source = "gantt") => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, item, source }); };

  // Copy item from context menu into clipboard
  const copyItem = (item) => {
    const level = item.level || 0;
    let fullItem = item;
    if (level === 0) {
      fullItem = tasks.find(j => j.id === item.id) || item;
    } else if (level === 1) {
      for (const job of tasks) { const p = (job.subs || []).find(s => s.id === item.id); if (p) { fullItem = p; break; } }
    } else {
      for (const job of tasks) { for (const panel of (job.subs || [])) { const op = (panel.subs || []).find(o => o.id === item.id); if (op) { fullItem = op; break; } } }
    }
    setClipboard({ level, item: JSON.parse(JSON.stringify(fullItem)) });
    setCtxMenu(null);
  };

  // Paste clipboard item at a target start date
  const doPaste = () => {
    if (!clipboard || !pasteConfirm) return;
    const { level, item } = clipboard;
    const shift = diffD(item.start, pasteConfirm.startDate);
    const freshen = (obj) => ({
      ...obj, id: uid(),
      start: addD(obj.start, shift), end: addD(obj.end, shift),
      subs: (obj.subs || []).map(s => freshen(s)),
    });
    let jobToPaste;
    if (level === 0) {
      jobToPaste = { ...freshen(item), title: item.title + " (Copy)" };
    } else if (level === 1) {
      const panel = freshen(item);
      jobToPaste = { id: uid(), title: item.title + " (Copy)", start: panel.start, end: panel.end, status: "Not Started", pri: "Medium", team: [], color: "#3b82f6", hpd: item.hpd || 8, notes: "", subs: [panel], deps: [], clientId: null };
    } else {
      const op = freshen(item);
      const panel = { id: uid(), title: "Panel-01", start: op.start, end: op.end, status: "Not Started", pri: "Medium", team: [], hpd: item.hpd || 8, notes: "", deps: [], engineering: { designed: null, verified: null, sentToPerforex: null }, subs: [op] };
      jobToPaste = { id: uid(), title: item.title + " (Copy)", start: panel.start, end: panel.end, status: "Not Started", pri: "Medium", team: [], color: "#3b82f6", hpd: item.hpd || 8, notes: "", subs: [panel], deps: [], clientId: null };
    }
    setTasks(prev => [...prev, jobToPaste]);
    setPasteConfirm(null);
  };

  // ─── Chat helpers ─────────────────────────────────────────────────────────
  function getThreadParticipants(scope, jobId, panelId, opId, groupId) {
    if (scope === "group") {
      const group = groupId ? groups.find(g => g.id === groupId) : null;
      return group ? people.filter(p => group.memberIds.includes(p.id)) : people.filter(p => p.userRole === "admin");
    }
    const admins = people.filter(p => p.userRole === "admin");
    const workerIds = new Set();
    if (scope === "op") {
      const job = tasks.find(j => j.id === jobId);
      const panel = (job?.subs || []).find(s => s.id === panelId);
      const op = (panel?.subs || []).find(o => o.id === opId);
      (op?.team || []).forEach(id => workerIds.add(id));
    } else if (scope === "panel") {
      const job = tasks.find(j => j.id === jobId);
      const panel = (job?.subs || []).find(s => s.id === panelId);
      (panel?.subs || []).forEach(op => (op.team || []).forEach(id => workerIds.add(id)));
    } else {
      const job = tasks.find(j => j.id === jobId);
      (job?.subs || []).forEach(panel => (panel.subs || []).forEach(op => (op.team || []).forEach(id => workerIds.add(id))));
    }
    const workers = people.filter(p => workerIds.has(p.id) && !admins.find(a => a.id === p.id));
    return [...admins, ...workers];
  }

  function openChat(item) {
    let scope, jobId, panelId = null, opId = null, title;
    if (item.level === 2 || (item.isSub && item.grandPid)) {
      scope = "op"; opId = item.id; panelId = item.pid;
      let parentJob = null, parentPanel = null;
      for (const j of tasks) { for (const p of (j.subs || [])) { if ((p.subs || []).find(o => o.id === item.id)) { parentJob = j; parentPanel = p; break; } } if (parentJob) break; }
      jobId = parentJob?.id || item.grandPid;
      title = parentPanel ? `${parentPanel.title} — ${item.title}` : item.title;
    } else if (item.level === 1 || item.isSub) {
      scope = "panel"; panelId = item.id; jobId = item.pid;
      title = `${item.title}`;
    } else {
      scope = "job"; jobId = item.id;
      const job = tasks.find(j => j.id === item.id);
      const cl = job?.clientId ? clients.find(c => c.id === job.clientId) : null;
      title = cl ? `${cl.name} ${item.title}` : item.title;
    }
    const threadKey = scope === "op" ? `op:${opId}` : scope === "panel" ? `panel:${panelId}` : `job:${jobId}`;
    const participants = getThreadParticipants(scope, jobId, panelId, opId);
    setQuickChat({ threadKey, title, scope, jobId, panelId, opId, participants });
    setQuickChatInput("");
    setCtxMenu(null);
    markThreadRead(threadKey);
  }

  function markThreadRead(threadKey) {
    const updated = { ...lastRead, [threadKey]: new Date().toISOString() };
    setLastRead(updated);
    localStorage.setItem("tq_last_read", JSON.stringify(updated));
  }

  async function sendChatMessage() {
    if ((!chatInput.trim() && !chatAttachments.length) || !chatThread || !loggedInUser || chatSending) return;
    setChatSending(true);
    setChatError(null);
    const { threadKey, scope, jobId, panelId, opId, participants } = chatThread;
    try {
      const msg = await postMessage({
        threadKey, scope,
        jobId: jobId || null, panelId: panelId || null, opId: opId || null,
        text: chatInput.trim(),
        authorId: loggedInUser.id,
        authorName: loggedInUser.name,
        authorColor: loggedInUser.color,
        participantIds: (participants || []).map(p => p.id),
        attachments: chatAttachments,
      }, getToken, orgCode);
      setMessages(prev => [...prev, msg]);
      setChatInput("");
      setChatAttachments([]);
      markThreadRead(threadKey);
    } catch (e) {
      console.error("Failed to send message:", e);
      setChatError(e.message || "Failed to send — check your connection and try again.");
    } finally {
      setChatSending(false);
    }
  }

  async function sendReminder(item, note) {
    if (!loggedInUser || reminderSending) return;
    setReminderSending(true);
    let scope, jobId, panelId = null, opId = null;
    if (item.level === 2 || (item.isSub && item.grandPid)) {
      scope = "op"; opId = item.id; panelId = item.pid;
      let parentJob = null;
      for (const j of tasks) { for (const p of (j.subs || [])) { if ((p.subs || []).find(o => o.id === item.id)) { parentJob = j; break; } } if (parentJob) break; }
      jobId = parentJob?.id || item.grandPid;
    } else if (item.level === 1 || item.isSub) {
      scope = "panel"; panelId = item.id; jobId = item.pid;
    } else {
      scope = "job"; jobId = item.id;
    }
    const threadKey = scope === "op" ? `op:${opId}` : scope === "panel" ? `panel:${panelId}` : `job:${jobId}`;
    const participants = getThreadParticipants(scope, jobId, panelId, opId);
    const text = `🔔 Reminder: ${note.trim() || "Please complete this job."}`;
    try {
      const msg = await postMessage({
        threadKey, scope,
        jobId: jobId || null, panelId: panelId || null, opId: opId || null,
        text,
        authorId: loggedInUser.id,
        authorName: loggedInUser.name,
        authorColor: loggedInUser.color,
        participantIds: participants.map(p => p.id),
        attachments: [],
      }, getToken, orgCode);
      setMessages(prev => [...prev, msg]);
      setReminderModal(null);
      setReminderNote("");
    } catch (e) {
      console.error("Failed to send reminder:", e);
    } finally {
      setReminderSending(false);
    }
  }

  // Engineering sign-off
  const canSignOffEngineering = loggedInUser && (loggedInUser.userRole === "admin" || loggedInUser.isEngineer === true);
  const signOffEngineering = (jobId, panelId, step) => {
    if (!canSignOffEngineering) return;
    const record = { by: loggedInUser.id, byName: loggedInUser.name, at: new Date().toISOString() };
    setTasks(prev => {
      const next = prev.map(job =>
        job.id !== jobId ? job : {
          ...job,
          subs: (job.subs || []).map(panel =>
            panel.id !== panelId ? panel : {
              ...panel,
              engineering: { designed: null, verified: null, sentToPerforex: null, ...(panel.engineering || {}), [step]: record }
            }
          )
        }
      );
      // Fire notifications after state is updated
      const job = next.find(j => j.id === jobId);
      const panel = job?.subs?.find(p => p.id === panelId);
      if (job && panel) {
        const stepLabel = engSteps.find(s => s.key === step)?.label || step;
        const jobTeamIds = (job.subs || []).flatMap(p => (p.subs || []).flatMap(op => op.team || []));
        const allDone = !!(panel.engineering?.designed && panel.engineering?.verified && panel.engineering?.sentToPerforex);
        // Notify step sign-off
        callNotify({ type: "step", jobTitle: job.title, jobNumber: job.jobNumber || null, panelTitle: panel.title, stepLabel, jobTeamIds }, getToken, orgCode).catch(console.warn);
        // If all steps now done, also send ready-to-build notification
        if (allDone) {
          callNotify({ type: "ready", jobTitle: job.title, jobNumber: job.jobNumber || null, panelTitle: panel.title, stepLabel, jobTeamIds }, getToken, orgCode).catch(console.warn);
        }
      }
      return next;
    });
  };
  const revertEngineering = (jobId, panelId, step) => {
    if (!canSignOffEngineering) return;
    const stepOrder = ["designed", "verified", "sentToPerforex"];
    const stepIdx = stepOrder.indexOf(step);
    const toRevert = stepOrder.slice(stepIdx);
    setTasks(prev => prev.map(job =>
      job.id !== jobId ? job : {
        ...job,
        subs: (job.subs || []).map(panel =>
          panel.id !== panelId ? panel : {
            ...panel,
            engineering: { ...(panel.engineering || {}), ...Object.fromEntries(toRevert.map(s => [s, null])) }
          }
        )
      }
    ));
  };
  const engSteps = [
    { key: "designed",       label: "Designed" },
    { key: "verified",       label: "Verified" },
    { key: "sentToPerforex", label: "Sent to Perforex" },
  ];
  const isEngComplete = (panel) => {
    const e = panel.engineering || {};
    return !!(e.designed && e.verified && e.sentToPerforex);
  };

  async function sendQuickMessage() {
    if (!quickChatInput.trim() || !quickChat || !loggedInUser || quickChatSending) return;
    setQuickChatSending(true);
    const { threadKey, scope, jobId, panelId, opId, participants } = quickChat;
    try {
      const msg = await postMessage({
        threadKey, scope,
        jobId: jobId || null, panelId: panelId || null, opId: opId || null,
        text: quickChatInput.trim(),
        authorId: loggedInUser.id,
        authorName: loggedInUser.name,
        authorColor: loggedInUser.color,
        participantIds: participants.map(p => p.id),
        attachments: [],
      }, getToken, orgCode);
      setMessages(prev => [...prev, msg]);
      setQuickChatInput("");
      markThreadRead(threadKey);
    } catch (e) {
      console.error("Failed to send quick message:", e);
    } finally {
      setQuickChatSending(false);
    }
  }

  async function handleChatFileSelect(e) {
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (!files.length) return;
    setChatUploading(true);
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) { alert(`${file.name} is too large (max 8 MB).`); continue; }
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const att = await uploadAttachment(
          { filename: file.name, mimeType: file.type || "application/octet-stream", data },
          getToken, orgCode
        );
        setChatAttachments(prev => [...prev, att]);
      }
    } catch (e) {
      console.error("Attachment upload failed:", e);
      alert("Failed to upload attachment. Please try again.");
    } finally {
      setChatUploading(false);
    }
  }

  // Unread: messages where user is participant, author is not self, newer than lastRead[threadKey]
  const unreadMessages = useMemo(() => {
    if (!loggedInUser) return [];
    return messages.filter(m => {
      if (m.authorId === loggedInUser.id) return false;
      if (!m.participantIds?.includes(loggedInUser.id)) return false;
      const lr = lastRead[m.threadKey] || "1970-01-01T00:00:00Z";
      return m.timestamp > lr;
    });
  }, [messages, loggedInUser, lastRead]);

  // Group unread by threadKey for notification dropdown
  const unreadByThread = useMemo(() => {
    const map = {};
    unreadMessages.forEach(m => {
      if (!map[m.threadKey]) map[m.threadKey] = { threadKey: m.threadKey, count: 0, latest: m, scope: m.scope, jobId: m.jobId, panelId: m.panelId, opId: m.opId };
      map[m.threadKey].count++;
      if (m.timestamp > map[m.threadKey].latest.timestamp) map[m.threadKey].latest = m;
    });
    return Object.values(map).sort((a, b) => b.latest.timestamp.localeCompare(a.latest.timestamp));
  }, [unreadMessages]);

  function getThreadTitle(threadKey, scope, jobId, panelId, opId) {
    if (scope === "group" || threadKey?.startsWith("group:")) {
      const gId = threadKey?.replace("group:", "") || jobId;
      const group = groups.find(g => g.id === gId); return group ? group.name : "Group Chat";
    }
    if (scope === "job" || threadKey?.startsWith("job:")) {
      const job = tasks.find(j => j.id === jobId);
      if (!job) return "Job Chat";
      const cl = job.clientId ? clients.find(c => c.id === job.clientId) : null;
      return cl ? `${cl.name} ${job.title}` : job.title;
    }
    if (scope === "panel" || threadKey?.startsWith("panel:")) {
      for (const j of tasks) { const p = (j.subs || []).find(s => s.id === panelId); if (p) return `${p.title}`; } return "Panel Chat";
    }
    if (scope === "op" || threadKey?.startsWith("op:")) {
      for (const j of tasks) { for (const p of (j.subs || [])) { const o = (p.subs || []).find(x => x.id === opId); if (o) return `${p.title} — ${o.title}`; } } return "Operation Chat";
    }
    return "Chat";
  }

  async function saveNewGroup() {
    if (!newGroupName.trim() || newGroupSaving) return;
    if (!loggedInUser) { alert("Could not identify your user account. Please refresh and try again."); return; }
    setNewGroupSaving(true);
    const memberIds = newGroupPeople.length > 0 ? newGroupPeople : [loggedInUser.id];
    const newGroup = { id: uid(), name: newGroupName.trim(), memberIds, createdBy: loggedInUser.id, createdAt: new Date().toISOString() };
    const updated = [...(Array.isArray(groups) ? groups : []), newGroup];
    try {
      await saveGroups(updated, getToken, orgCode);
      setGroups(updated);
      setNewGroupModal(false); setNewGroupName(""); setNewGroupPeople([]);
      const participants = people.filter(p => memberIds.includes(p.id));
      const threadKey = `group:${newGroup.id}`;
      setChatThread({ threadKey, title: newGroup.name, scope: "group", groupId: newGroup.id, participants });
      markThreadRead(threadKey);
    } catch (e) {
      console.error("Failed to save group:", e);
      alert(`Failed to create group: ${e?.message || "unknown error"}. Check the browser console for details.`);
    } finally {
      setNewGroupSaving(false);
    }
  }

  async function saveEditGroup() {
    if (!editGroupModal || !editGroupModal.name.trim()) return;
    const updated = groups.map(g => g.id === editGroupModal.groupId
      ? { ...g, name: editGroupModal.name.trim(), memberIds: editGroupModal.memberIds }
      : g
    );
    try {
      await saveGroups(updated, getToken, orgCode);
      setGroups(updated);
      if (chatThread?.groupId === editGroupModal.groupId) {
        const participants = people.filter(p => editGroupModal.memberIds.includes(p.id));
        setChatThread(ct => ({ ...ct, title: editGroupModal.name.trim(), participants }));
      }
      setEditGroupModal(null);
    } catch (e) {
      console.error("Failed to update group:", e);
    }
  }

  // ─── Timeline pan handlers ────────────────────────────────────────────────
  const handleGanttPan = useCallback((e) => {
    if (e.button !== 0) return;
    const panLW = isMobile ? 140 : 280;
    const rect = ganttRef.current?.getBoundingClientRect();
    if (rect && e.clientX < rect.left + panLW) return;
    const startX = e.clientX;
    let lastShift = 0;
    const styleEl = document.createElement("style");
    styleEl.textContent = "* { cursor: grabbing !important; }";
    document.head.appendChild(styleEl);
    const onUp = () => {
      styleEl.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    const onMove = (me) => {
      if (me.buttons === 0) { onUp(); return; }
      const days = Math.round(-(me.clientX - startX) / ganttCWRef.current);
      if (days !== lastShift) {
        const delta = days - lastShift;
        lastShift = days;
        setGStart(prev => addD(prev, delta));
        setGEnd(prev => addD(prev, delta));
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [isMobile]);

  const handleTeamPan = useCallback((e) => {
    if (e.button !== 0) return;
    const panLW = isMobile ? 120 : 260;
    const rect = teamRef.current?.getBoundingClientRect();
    if (rect && e.clientX < rect.left + panLW) return;
    const startX = e.clientX;
    let lastShift = 0;
    const styleEl = document.createElement("style");
    styleEl.textContent = "* { cursor: grabbing !important; }";
    document.head.appendChild(styleEl);
    const onUp = () => {
      styleEl.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    const onMove = (me) => {
      if (me.buttons === 0) { onUp(); return; }
      const days = Math.round(-(me.clientX - startX) / teamCWRef.current);
      if (days !== lastShift) {
        const delta = days - lastShift;
        lastShift = days;
        setTStart(prev => addD(prev, delta));
        setTEnd(prev => addD(prev, delta));
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [isMobile]);

  const handleGanttWheel = useCallback((e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    ganttWheelAcc.current += e.deltaX / ganttCWRef.current;
    const days = Math.trunc(ganttWheelAcc.current);
    if (days !== 0) {
      ganttWheelAcc.current -= days;
      setGStart(prev => addD(prev, days));
      setGEnd(prev => addD(prev, days));
    }
  }, []);

  const handleTeamWheel = useCallback((e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    teamWheelAcc.current += e.deltaX / teamCWRef.current;
    const days = Math.trunc(teamWheelAcc.current);
    if (days !== 0) {
      teamWheelAcc.current -= days;
      setTStart(prev => addD(prev, days));
      setTEnd(prev => addD(prev, days));
    }
  }, []);

  // ═══════════════════ GANTT ═══════════════════
  const renderGantt = () => {
    const days = []; let c = gStart; while (c <= gEnd) { days.push(c); c = addD(c, 1); }
    const lW = isMobile ? 140 : 280;
    const avail = Math.max((ganttWidth || 1200) - lW, 200);
    const cW = isMobile ? Math.max(32, avail / Math.max(days.length, 1)) : avail / Math.max(days.length, 1);
    ganttCWRef.current = cW;
    const rH = 48, hH = gMode === "month" ? 68 : 56;
    // Build week/month group headers
    const groups = []; let gi = 0;
    days.forEach((day, i) => {
      const dt = new Date(day + "T12:00:00");
      if (gMode === "month") {
        const key = `${dt.getFullYear()}-${dt.getMonth()}`;
        if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: dt.toLocaleDateString("en-US", { month: "long", year: "numeric" }), start: i, span: 1 });
        else groups[groups.length - 1].span++;
      } else {
        const wk = new Date(dt); wk.setDate(wk.getDate() - wk.getDay());
        const key = toDS(wk);
        if (!groups.length || groups[groups.length - 1].key !== key) {
          const wkEnd = new Date(wk); wkEnd.setDate(wkEnd.getDate() + 6);
          groups.push({ key, label: `${wk.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${wkEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, start: i, span: 1 });
        } else groups[groups.length - 1].span++;
      }
    });
    const gSortedFiltered = [...filtered].filter(t => t.status !== "Finished").sort((a, b) => {
      if (gSort === "project") return String(a.jobNumber || a.title || "").localeCompare(String(b.jobNumber || b.title || ""), undefined, { numeric: true });
      if (gSort === "client") { const ca = a.clientId ? (clients.find(c => c.id === a.clientId)?.name || "") : ""; const cb = b.clientId ? (clients.find(c => c.id === b.clientId)?.name || "") : ""; return ca.localeCompare(cb) || a.start.localeCompare(b.start); }
      return a.start.localeCompare(b.start);
    });
    const rows = []; gSortedFiltered.forEach(t => { rows.push({ ...t, isSub: false, pid: null, level: 0 }); if (exp[t.id]) (t.subs || []).forEach(s => { rows.push({ ...s, isSub: true, pid: t.id, level: 1 }); if (exp[s.id]) (s.subs || []).forEach(op => rows.push({ ...op, isSub: true, pid: s.id, grandPid: t.id, level: 2, panelTitle: s.title })); }); });
    const dToX = d => diffD(gStart, d) * cW;
    const ri4 = {}; rows.forEach((r, i) => { ri4[r.id] = i; });
    const arrows = [];
    const handleDrag = (e, item, mode) => {
      if (!can("moveJobs")) { openDetail(item); return; }
      if (linkingFrom) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, os = item.start, oe = item.end;
      let moved = false, lastDx = 0, finalDx = 0;
      const origRow = ri4[item.id];
      const pidArg = item.isSub ? item.pid : null;
      const onM = me => {
        const dx = Math.round((me.clientX - sx) / cW);
        if (dx !== 0 || Math.abs(me.clientY - sy) > 8) moved = true;
        if (dx === lastDx) return; lastDx = dx; finalDx = dx;
        // Compute live + snapped ghost positions
        const rawS = mode !== "right" ? addD(os, dx) : os;
        const rawE = mode !== "left"  ? addD(oe, dx) : oe;
        const snapS = nextBD(rawS);
        const snapDelta = diffD(rawS, snapS);
        const snapE = snapDelta > 0 ? addD(rawE, snapDelta) : rawE;
        // Lightweight overlap check against other ops for same person(s)
        const personIds = new Set();
        const movingOpIds = new Set();
        if (item.level === 2) {
          (item.team || []).forEach(id => personIds.add(id));
          movingOpIds.add(item.id);
        } else if (item.level === 1) {
          (item.subs || []).forEach(op => { (op.team || []).forEach(id => personIds.add(id)); movingOpIds.add(op.id); });
        } else {
          (item.subs || []).forEach(panel => panel.subs ? panel.subs.forEach(op => { (op.team || []).forEach(id => personIds.add(id)); movingOpIds.add(op.id); }) : null);
        }
        let hasOverlap = false;
        if (personIds.size > 0) {
          outer: for (const job of tasks) {
            for (const panel of (job.subs || [])) {
              for (const op of (panel.subs || [])) {
                if (movingOpIds.has(op.id) || op.status === "Finished") continue;
                if (!(op.team || []).some(id => personIds.has(id))) continue;
                if (op.start <= snapE && op.end >= snapS) { hasOverlap = true; break outer; }
              }
            }
          }
        }
        setGanttDragInfo({ itemId: item.id, snapStart: snapS, snapEnd: snapE, hasOverlap });
        if (mode === "move") updTask(item.id, { start: rawS, end: rawE }, pidArg);
        else if (mode === "left") { if (rawS <= oe) updTask(item.id, { start: rawS }, pidArg); }
        else { if (rawE >= os) updTask(item.id, { end: rawE }, pidArg); }
      };
      const onU = me => {
        document.removeEventListener("mousemove", onM);
        document.removeEventListener("mouseup", onU);
        setGanttDragInfo(null);
        if (!moved) {
          if ((item.subs || []).length > 0) setExp(p => ({ ...p, [item.id]: !p[item.id] }));
          else openDetail(item);
          return;
        }
        const rawNewStart = mode !== "right" ? addD(os, finalDx) : os;
        const rawNewEnd = mode !== "left" ? addD(oe, finalDx) : oe;
        const newStart = nextBD(rawNewStart);
        const snapDelta = diffD(rawNewStart, newStart);
        const newEnd = snapDelta > 0 ? addD(rawNewEnd, snapDelta) : rawNewEnd;
        const movedByName = loggedInUser ? loggedInUser.name : "Admin";
        const actualDelta = diffD(os, newStart);

        // Gather all operations that would be affected (for overlap/push checks)
        const getOpsToCheck = () => {
          const ops = [];
          if (item.level === 0 || (!item.isSub && (item.subs || []).length > 0)) {
            // Job-level: all child ops shift by delta
            (item.subs || []).forEach(s => {
              (s.subs || []).forEach(op => {
                if (op.team[0]) ops.push({ personId: op.team[0], start: addD(op.start, actualDelta), end: addD(op.end, actualDelta), opId: op.id, opTitle: op.title, panelTitle: s.title, hpd: op.hpd, teamLength: (op.team || []).length });
              });
              if ((s.subs || []).length === 0 && s.team && s.team[0]) ops.push({ personId: s.team[0], start: addD(s.start, actualDelta), end: addD(s.end, actualDelta), opId: s.id, opTitle: s.title, panelTitle: item.title, hpd: s.hpd, teamLength: (s.team || []).length });
            });
          } else if (item.level === 1) {
            // Panel-level: ops within panel shift
            (item.subs || []).forEach(op => {
              if (op.team[0]) ops.push({ personId: op.team[0], start: addD(op.start, actualDelta), end: addD(op.end, actualDelta), opId: op.id, opTitle: op.title, panelTitle: item.title, hpd: op.hpd, teamLength: (op.team || []).length });
            });
          } else if (item.team && item.team[0]) {
            // Operation-level
            ops.push({ personId: item.team[0], start: newStart, end: newEnd, opId: item.id, opTitle: item.title, panelTitle: "", hpd: item.hpd, teamLength: (item.team || []).length });
          }
          return ops;
        };

        // Apply move with log entries — defined outside setTasks so onConfirm can reuse it
        const applyMoveWithLog = (tl) => {
          if (item.level === 0 || (!item.isSub && (item.subs || []).length > 0)) {
            return tl.map(t => {
              if (t.id !== item.id) return t;
              const logEntry = { fromStart: t.start, fromEnd: t.end, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Job moved" };
              const childDelta = actualDelta;
              return { ...t, start: newStart, end: newEnd, subs: (t.subs || []).map(s => ({
                ...s, start: addD(s.start, childDelta), end: addD(s.end, childDelta),
                subs: (s.subs || []).map(op => ({
                  ...op, start: addD(op.start, childDelta), end: addD(op.end, childDelta),
                  moveLog: [...(op.moveLog || []), { fromStart: op.start, fromEnd: op.end, toStart: addD(op.start, childDelta), toEnd: addD(op.end, childDelta), date: TD, movedBy: movedByName, reason: "Job moved" }]
                }))
              })), moveLog: [...(t.moveLog || []), logEntry] };
            });
          } else if (pidArg) {
            return tl.map(t => {
              if (pidArg) {
                const pi2 = (t.subs || []).findIndex(s => s.id === pidArg);
                if (pi2 >= 0) {
                  const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => {
                    if (op.id === item.id) {
                      const logEntry = { fromStart: os, fromEnd: oe, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Manual move" };
                      return { ...op, start: newStart, end: newEnd, moveLog: [...(op.moveLog || []), logEntry] };
                    }
                    return op;
                  }) };
                  return { ...t, subs: ns };
                }
                if (t.id === pidArg) {
                  return { ...t, subs: (t.subs || []).map(s => {
                    if (s.id !== item.id) return s;
                    const logEntry = { fromStart: os, fromEnd: oe, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Panel moved" };
                    const opDelta = actualDelta;
                    return { ...s, start: newStart, end: newEnd, moveLog: [...(s.moveLog || []), logEntry],
                      subs: (s.subs || []).map(op => ({
                        ...op, start: addD(op.start, opDelta), end: addD(op.end, opDelta),
                        moveLog: [...(op.moveLog || []), { fromStart: op.start, fromEnd: op.end, toStart: addD(op.start, opDelta), toEnd: addD(op.end, opDelta), date: TD, movedBy: movedByName, reason: "Panel moved" }]
                      }))
                    };
                  }) };
                }
              }
              return t;
            });
          }
          return tl;
        };

        // Capture any pending vertical reassign so onConfirm can apply it
        let pendingReassign = null;
        if (mode === "move" && item.level === 2) {
          const dy = Math.round((me.clientY - sy) / rH);
          if (dy !== 0) {
            const targetIdx = Math.max(0, Math.min(rows.length - 1, origRow + dy));
            const targetRow = rows[targetIdx];
            if (targetRow && targetRow.id !== item.id && targetRow.team && targetRow.team[0]) {
              const fromPid = (item.team || [])[0]; const toPid = targetRow.team[0];
              if (fromPid && toPid && fromPid !== toPid) pendingReassign = { id: item.id, fromPid, toPid, pidArg };
            }
          }
        }

        setTasks(prev => {
          // Revert to original positions
          const revertItem = (tList, id, origS, origE, pid) => tList.map(t => {
            if (pid) {
              const pi2 = (t.subs || []).findIndex(s => s.id === pid);
              if (pi2 >= 0) { const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => op.id === id ? { ...op, start: origS, end: origE } : op) }; return { ...t, subs: ns }; }
              if (t.id === pid) {
                // Reverting a panel: also revert child ops by reversing the delta
                return { ...t, subs: (t.subs || []).map(s => {
                  if (s.id !== id) return s;
                  const sd = diffD(s.start, origS);
                  return { ...s, start: origS, end: origE, subs: (s.subs || []).map(op => ({ ...op, start: addD(op.start, sd), end: addD(op.end, sd) })) };
                }) };
              }
              return t;
            }
            if (t.id !== id) return t;
            const updated = { ...t, start: origS, end: origE };
            if ((t.subs || []).length > 0) {
              const sd = diffD(t.start, origS); const ed = diffD(t.end, origE);
              if (sd === ed && sd !== 0) {
                updated.subs = (t.subs || []).map(s => ({ ...s, start: addD(s.start, sd), end: addD(s.end, sd), subs: (s.subs || []).map(op => ({ ...op, start: addD(op.start, sd), end: addD(op.end, sd) })) }));
              }
            }
            return updated;
          });
          const reverted = revertItem(prev, item.id, os, oe, pidArg);

          // Check locked ops
          const opsMoving = getOpsToCheck();
          let lockedFound = [];
          reverted.forEach(j => (j.subs || []).forEach(pnl => (pnl.subs || []).forEach(op => {
            if (op.locked && opsMoving.some(m => m.opId === op.id)) lockedFound.push({ opTitle: op.title, panelTitle: pnl.title });
          })));
          if (lockedFound.length > 0) { setTimeout(() => showLockedError(lockedFound), 0); return reverted; }

          // Check PTO conflicts for moving ops
          let ptoConflict = false;
          for (const mOp of opsMoving) {
            const person = people.find(x => x.id === mOp.personId);
            if (person) for (const to of (person.timeOff || [])) {
              if (to.start <= mOp.end && to.end >= mOp.start) {
                ptoConflict = true;
                setTimeout(() => showOverlapIfAny([{ person: person.name, isPto: true, panelTitle: to.reason || to.type || "PTO", start: to.start, end: to.end }]), 0);
                break;
              }
            }
            if (ptoConflict) break;
          }
          if (ptoConflict) return reverted;

          // Check for scheduling conflicts — hard block if any person is double-booked
          const conflictChecks = opsMoving.map(o => ({
            personId: o.personId, start: o.start, end: o.end,
            excludeOpId: o.opId, opTitle: o.opTitle || item.title, panelTitle: o.panelTitle || "",
            hpd: o.hpd, teamLength: o.teamLength || 1
          }));
          const schedConflicts = checkOverlapsPure(reverted, conflictChecks);
          if (schedConflicts.length > 0) {
            setTimeout(() => showOverlapIfAny(schedConflicts), 0);
            return reverted;
          }

          // No conflicts — show confirmation before committing
          setTimeout(() => setConfirmMove({
            title: "Confirm Move",
            message: `Move "${item.title}" from ${fm(os)} → ${fm(oe)} to ${fm(newStart)} → ${fm(newEnd)}?`,
            onCancel: () => setConfirmMove(null),
            onConfirm: () => {
              setConfirmMove(null);
              // For job-level drags (level 0), applyMoveWithLog already sets all bounds
              // correctly (job.start = newStart, all children shifted). Calling recalcBounds
              // would override job.start with min(op.start) which can be further than the
              // ghost position if the job's start was before its earliest operation.
              setTasks(curr => item.level === 0 ? applyMoveWithLog(curr) : recalcBounds(applyMoveWithLog(curr), movedByName));
              if (pendingReassign) reassignTask(pendingReassign.id, pendingReassign.fromPid, pendingReassign.toPid, pendingReassign.pidArg);
            }
          }), 0);
          return reverted;
        });
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    };
    // Day-view bar drag — move, left-resize (start), right-resize (end/hpd)
    const handleDayBarDrag = (e, item, mode = "move") => {
      e.preventDefault(); e.stopPropagation();
      const DHS = 5, DHE = 21, DNH = 16;
      const origHour = item.startHour ?? 8;
      const origHpd = item.hpd || 0;
      const origEnd = origHour + origHpd;
      const sx = e.clientX;
      let moved = false;
      const pid = item.isSub ? item.pid : null;
      const onM = me => {
        const dx = me.clientX - sx;
        if (Math.abs(dx) > 8) moved = true;
        if (!moved) return; // don't update task until we're truly dragging
        const deltaH = (dx / avail) * DNH;
        if (mode === "move") {
          const snapped = Math.round((origHour + deltaH) * 4) / 4;
          const clamped = Math.max(DHS, Math.min(DHE - Math.max(origHpd, 0.25), snapped));
          setDayDragInfo({ itemId: item.id, mode });
          updTask(item.id, { startHour: clamped }, pid);
        } else if (mode === "left") {
          const newStart = Math.round((origHour + deltaH) * 4) / 4;
          const clamped = Math.max(DHS, Math.min(origEnd - 0.25, newStart));
          setDayDragInfo({ itemId: item.id, mode });
          updTask(item.id, { startHour: clamped, hpd: Math.round((origEnd - clamped) * 100) / 100 }, pid);
        } else { // right
          const newEnd = Math.round((origEnd + deltaH) * 4) / 4;
          const clamped = Math.max(origHour + 0.25, Math.min(DHE, newEnd));
          setDayDragInfo({ itemId: item.id, mode });
          updTask(item.id, { hpd: Math.round((clamped - origHour) * 100) / 100 }, pid);
        }
      };
      const onU = () => {
        document.removeEventListener("mousemove", onM);
        document.removeEventListener("mouseup", onU);
        setDayDragInfo(null);
        if (!moved && mode === "move") openDetail(item);
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    };
    const tW = lW + days.length * cW, tH = hH + rows.length * rH;
    return <div>
      <div style={{ display: "flex", marginBottom: isMobile ? 10 : 20, alignItems: "center", position: "relative", minHeight: 44 }}>
        {/* Left: Today + Day/Week/Month + navigation */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn variant="ghost" size="sm" onClick={() => {
            const span = diffD(gStart, gEnd); const half = Math.floor(span / 2); setGStart(addD(TD, -half)); setGEnd(addD(TD, span - half));
          }}>Today</Btn>
          <SlidingPill
            size="sm"
            options={["day","week","month"].map(m=>({value:m,label:m.charAt(0).toUpperCase()+m.slice(1)}))}
            value={gMode}
            onChange={m => {
              setGMode(m);
              if (m==="day") { setGStart(TD); setGEnd(TD); }
              else if (m==="week") { const d=new Date(TD+"T12:00:00"); const dow=d.getDay(); const mon=addD(TD,-(dow===0?6:dow-1)); setGStart(mon); setGEnd(addD(mon,6)); }
              else { const d=new Date(TD+"T12:00:00"); const first=new Date(d.getFullYear(),d.getMonth(),1); const last=new Date(d.getFullYear(),d.getMonth()+1,0); setGStart(toDS(first)); setGEnd(toDS(last)); }
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (gMode === "month") { const d = new Date(gStart + "T12:00:00"); d.setMonth(d.getMonth() - 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setGStart(toDS(first)); setGEnd(toDS(last)); }
              else if (gMode === "day") { setGStart(addD(gStart, -1)); setGEnd(addD(gEnd, -1)); }
              else if (gMode === "week") { setGStart(addD(gStart, -7)); setGEnd(addD(gEnd, -7)); }
            }}>◀</Btn>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text, minWidth: 150, textAlign: "center" }}>{(() => {
              const s = new Date(gStart + "T12:00:00");
              if (gMode === "month") return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
              if (gMode === "day") return s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
              if (gMode === "week") { const e = new Date(gEnd + "T12:00:00"); return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`; }
              return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
            })()}</span>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (gMode === "month") { const d = new Date(gStart + "T12:00:00"); d.setMonth(d.getMonth() + 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setGStart(toDS(first)); setGEnd(toDS(last)); }
              else if (gMode === "day") { setGStart(addD(gStart, 1)); setGEnd(addD(gEnd, 1)); }
              else if (gMode === "week") { setGStart(addD(gStart, 7)); setGEnd(addD(gEnd, 7)); }
            }}>▶</Btn>
          </div>
          <div ref={filterRef} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setFilterOpen(p => !p)} title="Filters" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 9px", borderRadius: T.radiusSm, border: `1px solid ${activeFilterCount > 0 ? T.accent + "88" : T.border}`, background: activeFilterCount > 0 ? T.accent + "15" : "transparent", color: activeFilterCount > 0 ? T.accent : T.textSec, cursor: "pointer", transition: "all 0.15s", position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              {activeFilterCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: T.accent, color: T.accentText, borderRadius: 8, minWidth: 16, height: 16, fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center", padding: "0 4px" }}>{activeFilterCount}</span>}
            </button>
            {filterOpen && <div className="anim-ctx" style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 999, width: 290, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "14px 14px 10px", boxShadow: "0 16px 48px rgba(0,0,0,0.55)", fontFamily: T.font, maxHeight: "80vh", overflowY: "auto" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Sort By</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {[["date","Date"],["project","Task #"],["client","Client"]].map(([val,label]) => (
                  <button key={val} onClick={() => setGSort(val)} style={{ flex: 1, padding: "5px 4px", borderRadius: T.radiusXs, border: `1px solid ${gSort === val ? T.accent : T.border}`, background: gSort === val ? T.accent + "22" : "transparent", color: gSort === val ? T.accent : T.text, fontSize: 11, fontWeight: gSort === val ? 700 : 400, cursor: "pointer", fontFamily: T.font }}>{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Status</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {["All", "Not Started", "In Progress", "Finished", "On Hold"].map(s => <button key={s} onClick={() => setFStat(s === "All" ? "All" : s)} style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${fStat === s || (s === "All" && fStat === "All") ? T.accent : T.border}`, background: fStat === s || (s === "All" && fStat === "All") ? T.accent + "22" : "transparent", color: fStat === s || (s === "All" && fStat === "All") ? T.accent : T.text, fontSize: 11, fontWeight: fStat === s ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}>{s}</button>)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Client</div>
              <select value={fClient} onChange={e => setFClient(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: T.radiusXs, border: `1px solid ${fClient !== "All" ? T.accent : T.border}`, background: T.surface, color: fClient !== "All" ? T.accent : T.text, fontSize: 12, fontFamily: T.font, outline: "none", cursor: "pointer", marginBottom: 14 }}>
                <option value="All">All Clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>People {fPers.length > 0 && <span style={{ color: T.accent }}>({fPers.length})</span>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {people.map(p => { const active = fPers.includes(String(p.id)); return <button key={p.id} onClick={() => setFPers(prev => prev.includes(String(p.id)) ? prev.filter(x => x !== String(p.id)) : [...prev, String(p.id)])} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 20, border: `1.5px solid ${active ? p.color : T.border}`, background: active ? (p.color + "28") : "transparent", color: active ? p.color : T.textSec, fontSize: 11, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: p.color || T.accent, flexShrink: 0 }} />{p.name.split(" ")[0]}</button>; })}
                {fPers.length > 0 && <button onClick={() => setFPers([])} style={{ padding: "4px 8px", borderRadius: 20, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 10, cursor: "pointer", fontFamily: T.font }}>✕ Clear</button>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Task #</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                <input type="text" placeholder="e.g. 1042" value={fJobNum} onChange={e => setFJobNum(e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, padding: "6px 10px", borderRadius: T.radiusSm, border: `1.5px solid ${fJobNum ? T.accent : T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: T.mono, outline: "none", boxSizing: "border-box" }} />
                {fJobNum && <button onClick={() => setFJobNum("")} style={{ width: 26, height: 26, borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, lineHeight: 1 }}>×</button>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Role / Area</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {["All", ...uniqueRoles].map(r => <button key={r} onClick={() => setFRole(r)} style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${fRole === r ? T.accent : T.border}`, background: fRole === r ? T.accent : "transparent", color: fRole === r ? T.accentText : T.text, fontSize: 11, fontWeight: fRole === r ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}>{r}</button>)}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Overloaded Only</span>
                <button onClick={() => setFOverloaded(p => !p)} style={{ width: 36, height: 20, borderRadius: 10, background: fOverloaded ? T.accent : T.border, border: "none", cursor: "pointer", position: "relative", transition: "all 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: fOverloaded ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button onClick={() => { const all = {}; filtered.forEach(t => { if ((t.subs || []).length > 0) { all[t.id] = true; (t.subs || []).forEach(s => { if ((s.subs || []).length > 0) all[s.id] = true; }); } }); setExp(all); }} style={{ flex: 1, padding: "6px 0", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Expand All</button>
                <button onClick={() => setExp({})} style={{ flex: 1, padding: "6px 0", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Collapse All</button>
              </div>
              {activeFilterCount > 0 && <button onClick={() => { setFRole("All"); setFHpd("All"); setFClient("All"); setFPers([]); setFJobNum(""); setFStat("All"); setFOverloaded(false); }} style={{ width: "100%", padding: "7px 0", borderRadius: T.radiusXs, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Clear all filters</button>}
            </div>}
          </div>
        </div>
        {/* Right side: Clipboard + FAST TRAQS + New Task button */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {clipboard && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.accent}44`, background: T.accent + "12", fontSize: 12, color: T.accent, fontWeight: 600, maxWidth: 200 }}>
            <span style={{ lineHeight: 0, display: "flex" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/></svg></span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{clipboard.item.title}</span>
            <button onClick={() => setClipboard(null)} title="Clear clipboard" style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 14, padding: "0 0 0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>}
          {can("editJobs") && !jobSelectMode && <><button onClick={() => { setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadModal(true); }} style={{ background: `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`, border: `1px solid ${T.accent}55`, borderRadius: T.radiusSm, padding: "10px 22px", cursor: "pointer", display: "flex", alignItems: "center", fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.accent, animation: "glow-pulse 2.8s ease-in-out infinite", transition: "all 0.2s", letterSpacing: "0.04em" }} onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}35, ${T.accent}1a)`; }} onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`; }}>FAST TRAQS</button><Btn onClick={() => openNew()} style={{ padding: "10px 22px", fontSize: 15 }}>+ New Task</Btn></>}
        </div>
      </div>

      {tasks.length === 0
        ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "100px 24px", textAlign: "center", gap: 14 }}>
            <div style={{ marginBottom: 4, opacity: 0.45 }}><svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><polyline points="8 11 9 12 11 10"/><polyline points="8 16 9 17 11 15"/></svg></div>
            <h2 style={{ margin: 0, fontSize: 34, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>No tasks yet</h2>
            <p style={{ margin: "4px auto 0", fontSize: 16, color: T.textSec, maxWidth: 420, lineHeight: 1.75 }}>
              Create your first job, or import an existing schedule instantly with <strong style={{ color: T.accent }}>FAST TRAQS</strong>
            </p>
          </div>
        : gMode === "day" ? (() => {
        const HS = 5, HE = 21, NH = HE - HS; // 5am – 9pm, 16 hours
        const hours = Array.from({length: NH}, (_, i) => HS + i);
        const effHW = avail / NH; // stretch evenly across available width
        const fmH = h => h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
        const now = new Date();
        const nowH = now.getHours() + now.getMinutes() / 60;
        const isToday = gStart === TD;
        return (
          <div ref={ganttContainerRef} style={{width:"100%"}}>
            <div ref={ganttRef} style={{overflow:"hidden", border:`1px solid ${T.border}`, borderRadius:T.radius, background:T.surface}}>
              <div style={{display:"flex", flexDirection:"column", width:"100%"}}>
                {/* Hour header */}
                <div style={{display:"flex", borderBottom:`2px solid ${T.border}`, height:48}}>
                  <div style={{minWidth:lW,maxWidth:lW,display:"flex",alignItems:"center",padding:"0 16px",fontSize:12,color:T.textSec,fontWeight:600,borderRight:`1px solid ${T.border}`,letterSpacing:"0.04em",textTransform:"uppercase"}}>Task</div>
                  <div style={{flex:1,display:"flex"}}>
                    {hours.map(h => { const isCurH = isToday && Math.floor(nowH) === h; return <div key={h} style={{flex:1,height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:11,color:isCurH?T.accent:h<7||h>=18?T.textDim+"66":T.textDim,fontWeight:isCurH?700:400,borderRight:`1px solid ${T.bg}`,fontFamily:T.mono,background:h<7||h>=18?T.bg+"66":"transparent",gap:2}}><span style={{fontSize:11,fontWeight:isCurH?800:500}}>{fmH(h)}</span>{isCurH&&<div style={{width:4,height:4,borderRadius:2,background:T.accent}}/>}</div>; })}
                  </div>
                </div>
                {rows.length === 0 && <div style={{padding:"40px 0",textAlign:"center",color:T.textDim,fontSize:14}}>No tasks scheduled for this day</div>}
                {rows.map(r => {
                  const onDay = r.start <= gStart && r.end >= gStart;
                  const hpd = r.hpd || 0;
                  const rawBarS = r.startHour ?? 8, rawBarE = hpd > 0 ? Math.min(rawBarS + hpd, HE) : Math.min(rawBarS + 9, HE);
                  const visBarS = Math.max(rawBarS, HS), visBarE = Math.min(rawBarE, HE);
                  const barVisible = onDay && visBarE > visBarS;
                  const indent = r.level || 0;
                  return (
                    <div key={r.id} style={{display:"flex",height:rH,borderBottom:`1px solid ${T.bg}55`}}>
                      <div style={{minWidth:lW,maxWidth:lW,boxSizing:"border-box",display:"flex",alignItems:"center",gap:8,padding:"0 16px",paddingLeft:16+indent*16,borderRight:`1px solid ${T.border}`,position:"sticky",left:0,background:T.surface,zIndex:10,cursor:"pointer"}} onClick={()=>(r.subs||[]).length>0?setExp(p=>({...p,[r.id]:!p[r.id]})):openDetail(r)}>
                        <span style={{fontSize:indent===2?12:14,color:indent>0?T.textSec:T.text,fontWeight:indent>0?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{indent===2?"↳ ":""}{r.title}</span>
                        {(r.subs||[]).length>0 && <span style={{fontSize:10,color:T.textDim}}>({r.subs.length})</span>}
                        <HealthIcon t={r} size={13}/>
                      </div>
                      <div style={{flex:1,position:"relative",display:"flex"}}>
                        {hours.map(h => <div key={h} style={{flex:1,height:"100%",background:h<7||h>=18?T.bg+"55":"transparent",borderRight:`1px solid ${T.bg}22`,position:"relative"}}>
                          <div style={{position:"absolute",top:0,bottom:0,left:"50%",width:1,background:T.bg+"44",pointerEvents:"none"}}/>
                        </div>)}
                        {barVisible && <div
                          onMouseDown={e=>{ if(e.button===0) handleDayBarDrag(e,r,"move"); }}
                          onContextMenu={e=>handleCtx(e,r)}
                          style={{position:"absolute",top:5,left:`${(visBarS-HS)/NH*100}%`,width:`calc(${(visBarE-visBarS)/NH*100}% - 4px)`,height:rH-10,borderRadius:T.radiusXs,background:r.isSub?r.color+"aa":r.color,border:r.isSub?`1px solid ${r.color}`:"none",cursor:dayDragInfo?.itemId===r.id?"grabbing":"grab",display:"flex",alignItems:"center",padding:"0 18px",overflow:"hidden",boxShadow:dayDragInfo?.itemId===r.id?`0 4px 16px ${r.color}66`:`0 2px 8px ${r.color}33`,opacity:dayDragInfo&&dayDragInfo.itemId!==r.id?0.7:1,transition:"box-shadow 0.1s,opacity 0.1s"}}
                          onMouseEnter={e=>{ if(!dayDragInfo) e.currentTarget.style.filter="brightness(1.1)"; }} onMouseLeave={e=>e.currentTarget.style.filter="none"}>
                          <div onMouseDown={e=>{e.stopPropagation();handleDayBarDrag(e,r,"left");}} style={{position:"absolute",left:0,top:0,bottom:0,width:14,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5}}>
                            <div style={{width:3,height:14,borderRadius:2,background:"rgba(255,255,255,0.6)"}}/>
                          </div>
                          <span style={{fontSize:11,color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"center"}}>{hpd>0?`${hpd}h · `:""}{r.title}</span>
                          <div onMouseDown={e=>{e.stopPropagation();handleDayBarDrag(e,r,"right");}} style={{position:"absolute",right:0,top:0,bottom:0,width:14,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5}}>
                            <div style={{width:3,height:14,borderRadius:2,background:"rgba(255,255,255,0.6)"}}/>
                          </div>
                        </div>}
                        {isToday && nowH>=HS && nowH<=HE && <div style={{position:"absolute",top:0,bottom:0,left:`${(nowH-HS)/NH*100}%`,width:2,background:T.accent+"bb",zIndex:12,pointerEvents:"none"}}/>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })() : <div ref={ganttContainerRef} style={{ width: "100%" }}>
      <div ref={ganttRef} onMouseDown={handleGanttPan} onWheel={handleGanttWheel} style={{ overflowX: isMobile ? "auto" : "hidden", border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, position: "relative", cursor: "grab" }}>
        <div style={{ display: "flex", width: tW, flexDirection: "column", position: "relative" }}>
          <div style={{ borderBottom: `2px solid ${T.border}` }}>
            {/* Group header row (months or weeks) */}
            <div style={{ display: "flex" }}>
              <div style={{ minWidth: lW, maxWidth: lW, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.surface, zIndex: 15 }} />
              {groups.map(g => <div key={g.key} style={{ minWidth: g.span * cW, maxWidth: g.span * cW, height: hH / 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.text, letterSpacing: "0.03em", borderRight: `1px solid ${T.border}`, background: T.bg + "44" }}>{g.label}</div>)}
            </div>
            {/* Day number row */}
            <div style={{ display: "flex" }}>
              <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", padding: "0 20px", display: "flex", alignItems: "center", fontSize: 13, color: T.textSec, fontWeight: 600, height: hH / 2, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.surface, zIndex: 15, letterSpacing: "0.04em", textTransform: "uppercase" }}>Task</div>
              {days.map(day => { const dt = new Date(day + "T12:00:00"); const wk = [0, 6].includes(dt.getDay()); const isT = day === TD; const dayLetter = ["S","M","T","W","T","F","S"][dt.getDay()]; return <div key={day} style={{ minWidth: cW, maxWidth: cW, height: hH / 2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: gMode === "month" ? 12 : 13, fontFamily: T.mono, color: isT ? T.accent : wk ? T.textSec : T.text, fontWeight: isT ? 700 : wk ? 400 : 500, background: wk ? T.bg + "aa" : "transparent", borderRight: `1px solid ${T.bg}`, gap: 0 }}><span style={{ fontSize: 10, textTransform: "uppercase", lineHeight: 1 }}>{dayLetter}</span><span style={{ lineHeight: 1 }}>{dt.getDate()}</span></div>; })}
            </div>
          </div>
          {rows.map((r) => { const indent = r.level || 0; return <div key={r.id} style={{ display: "flex", height: rH, borderBottom: `1px solid ${T.bg}55` }}>
            <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", paddingLeft: 16 + indent * 16, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.surface, zIndex: 10, cursor: "pointer" }} onClick={() => (r.subs || []).length > 0 ? setExp(p => ({ ...p, [r.id]: !p[r.id] })) : openDetail(r)}>
              {r.level === 0 && jobSelectMode && <div onClick={e => { e.stopPropagation(); setSelJobs(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }); }} style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${selJobs.has(r.id) ? T.accent : T.border}`, background: selJobs.has(r.id) ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "all 0.15s" }}>{selJobs.has(r.id) && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5.5 4,8 8.5,2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>}
              <span style={{ fontSize: indent === 2 ? 12 : 14, color: indent > 0 ? T.textSec : T.text, fontWeight: indent > 0 ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{indent === 2 ? "↳ " : ""}{r.title}</span>
              {taskOwner(r) && <span style={{ fontSize: 11, color: r.color, fontWeight: 500, flexShrink: 0, opacity: 0.8 }}>{taskOwner(r)}</span>}
              {(r.subs || []).length > 0 && <span style={{ fontSize: 10, color: T.textDim }}>({r.subs.length})</span>}
              <HealthIcon t={r} size={13} />
            </div>
            <div style={{ flex: 1, position: "relative", display: "flex" }} onContextMenu={e => {
              e.preventDefault();
              setCtxMenu(null);
              if (!clipboard) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const dayIdx = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) / cW), days.length - 1));
              const startDate = days[dayIdx];
              const dur = Math.max(diffD(clipboard.item.start, clipboard.item.end), 0);
              setPasteConfirm({ x: e.clientX, y: e.clientY, startDate, endDate: addD(startDate, dur) });
            }}>
              {days.map(day => { const dt = new Date(day + "T12:00:00"); const wk = [0, 6].includes(dt.getDay()); const isMonStart = dt.getDate() === 1; return <div key={day} style={{ minWidth: cW, maxWidth: cW, height: "100%", background: day === TD ? T.accent + "0a" : wk ? T.bg + "aa" : "transparent", borderRight: isMonStart ? `2px solid ${T.border}` : `1px solid ${T.bg}33` }} />; })}
              {/* Drag ghost overlay — snapped destination with overlap coloring */}
              {ganttDragInfo?.itemId === r.id && (() => {
                const { snapStart, snapEnd, hasOverlap } = ganttDragInfo;
                if (snapStart > gEnd || snapEnd < gStart) return null;
                const gs = snapStart < gStart ? gStart : snapStart;
                const ge = snapEnd   > gEnd   ? gEnd   : snapEnd;
                const gx = dToX(gs), gw = Math.max(dToX(ge) + cW - gx, cW);
                const gc = hasOverlap ? "#ef4444" : T.accent;
                return <div style={{ position: "absolute", top: 3, left: gx - 2, width: gw + 4, height: rH - 6, borderRadius: T.radiusXs + 2, border: `2px solid ${gc}`, background: gc + "18", boxShadow: `0 0 24px ${gc}77, 0 0 8px ${gc}55, 0 0 48px ${gc}33`, pointerEvents: "none", zIndex: 3, animation: "ghost-fade-in 0.22s cubic-bezier(0.34,1.56,0.64,1)" }} />;
              })()}
              {r.start <= gEnd && r.end >= gStart && (() => {
                const x = dToX(r.start < gStart ? gStart : r.start), xE = dToX(r.end > gEnd ? gEnd : r.end) + cW, w = Math.max(xE - x, cW);
                const pct = r.status === "Finished" ? 100 : r.status === "In Progress" ? 50 : r.status === "Pending" ? 15 : r.status === "On Hold" ? 25 : 0;
                const hasSubs = (r.subs || []).length > 0;
                const isExp = hasSubs && exp[r.id];
                const isDragging = ganttDragInfo?.itemId === r.id;
                // Operations (level 2) use assigned person's color; jobs & panels use theme accent
                const personColor = r.level === 2 && (r.team || [])[0] ? (people.find(pp => pp.id === r.team[0]) || {}).color || T.accent : null;
                const barColor = r.level === 2 ? (personColor || T.accent) : T.accent;
                const barBg = r.level === 1 ? T.accent + "cc" : barColor;
                const barTextColor = accentText(barColor);
                return <div className="anim-gantt-bar" style={{ position: "absolute", top: 6, left: x, width: w, height: rH - 12, borderRadius: T.radiusXs, background: barBg, border: `1.5px solid ${barColor}`, cursor: can("moveJobs") ? "grab" : "pointer", display: "flex", alignItems: "center", overflow: "hidden", zIndex: r.level === 2 ? 5 : 4, boxShadow: isExp ? `0 2px 8px ${barColor}44` : "none", opacity: isDragging ? 0 : 1, transition: isDragging ? "none" : "opacity 0.15s" }}
                  onMouseDown={e => { if (e.button === 0) { e.stopPropagation(); handleDrag(e, r, "move"); } }} onContextMenu={e => handleCtx(e, r)}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "rgba(255,255,255,0.15)", borderRadius: T.radiusXs - 1 }} />
                  {can("moveJobs") && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleDrag(e, r, "left"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 16, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                  {can("moveJobs") && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleDrag(e, r, "right"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 16, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                  <span style={{ fontSize: r.level === 2 ? 11 : 12, color: barTextColor, fontWeight: 600, padding: "0 12px", position: "relative", zIndex: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5, flex: 1 }}>{hasSubs && <span style={{ fontSize: 9, opacity: 0.7, flexShrink: 0 }}>{isExp ? "▼" : "▶"}</span>}{r.level === 0 ? (r.jobNumber || r.title) : r.level === 2 ? (() => { const base = r.panelTitle && r.title.startsWith(r.panelTitle + " ") ? r.title.slice(r.panelTitle.length + 1).trim() : r.title; const owner = taskOwner(r); return owner ? `${base} — ${owner}` : base; })() : <>{r.title}{hasSubs && <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>({r.subs.length})</span>}{taskOwner(r) && <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}> · {taskOwner(r)}</span>}</>}</span>
                </div>;
              })()}
            </div>
          </div>; })}
          {/* SVG arrows */}
          <svg style={{ position: "absolute", top: 0, left: lW, width: tW - lW, height: tH, pointerEvents: "none", zIndex: 3 }}>
            <defs><marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto" fill="#f59e0b"><polygon points="0 0, 8 3, 0 6" /></marker></defs>
            {arrows.map(a => { const cp = Math.max(20, Math.min(Math.abs(a.tx - a.fx) * 0.4, 80)); const path = `M ${a.fx} ${a.fy} C ${a.fx + cp} ${a.fy}, ${a.tx - cp} ${a.ty}, ${a.tx} ${a.ty}`; return <g key={a.fid + "-" + a.tid}><path d={path} fill="none" stroke="#f59e0b22" strokeWidth="6" /><path d={path} fill="none" stroke="#f59e0baa" strokeWidth="2" markerEnd="url(#ah)" /><circle cx={a.fx} cy={a.fy} r="3.5" fill="#f59e0b" opacity="0.7" /></g>; })}
          </svg>
          {TD >= gStart && TD <= gEnd && <div style={{ position: "absolute", top: 0, bottom: 0, left: lW + diffD(gStart, TD) * cW + cW / 2, width: 2, background: T.accent + "bb", zIndex: 12, pointerEvents: "none" }} />}
        </div>
      </div>
      </div>}
    </div>;
  };

  // ═══════════════════ ANALYTICS ═══════════════════

  // ═══════════════════ TASKS ═══════════════════
  const jobSearchMatch = (t) => {
    if (!jobSearch) return true;
    const q = jobSearch.toLowerCase();
    if (t.title?.toLowerCase().includes(q)) return true;
    if (t.jobNumber && String(t.jobNumber).includes(q)) return true;
    const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
    if (client && client.name.toLowerCase().includes(q)) return true;
    return false;
  };
  const sortTasks = (arr) => {
    if (jobSort === "project") return [...arr].sort((a, b) => String(a.jobNumber || a.title).localeCompare(String(b.jobNumber || b.title), undefined, { numeric: true }));
    if (jobSort === "client") { return [...arr].sort((a, b) => { const ca = a.clientId ? (clients.find(c => c.id === a.clientId)?.name || "") : ""; const cb = b.clientId ? (clients.find(c => c.id === b.clientId)?.name || "") : ""; return ca.localeCompare(cb) || a.start.localeCompare(b.start); }); }
    return [...arr].sort((a, b) => a.start.localeCompare(b.start));
  };
  const finishedTasks = sortTasks(tasks.filter(t => t.status === "Finished" && jobSearchMatch(t)));
  const activeTasks = sortTasks(filtered.filter(t => t.status !== "Finished" && jobSearchMatch(t)));

  // Engineering Queue: incomplete panels. Engineering Finished: all steps done.
  const engQueueItems = [];
  const engFinishedItems = [];
  tasks.forEach(job => {
    (job.subs || []).forEach(panel => {
      if (panel.engineering === undefined) return;
      const e = panel.engineering || {};
      if (e.designed && e.verified && e.sentToPerforex) engFinishedItems.push({ job, panel });
      else engQueueItems.push({ job, panel });
    });
  });

  const renderTasks = () => {
    const sel = selTask ? (filtered.find(t => t.id === selTask) || tasks.find(t => t.id === selTask)) : null;
    const fresh = sel ? (allItems.find(x => x.id === sel.id) || sel) : null;
    const parent = fresh ? tasks.find(x => x.id === fresh.id) : null;

    // Gantt sub-view: render full Gantt inside Tasks tab
    if (taskSubView === "gantt") {
      return <div style={{ display: "flex", flexDirection: "column", gap: 0, paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <SlidingPill
            size="sm"
            options={[{value:"cards",label:"Cards"},{value:"gantt",label:"Gantt"}]}
            value={taskSubView}
            onChange={setTaskSubView}
          />
        </div>
        {renderGantt()}
      </div>;
    }

    return <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 6 }}>
      {/* ── Card / Gantt toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SlidingPill
          size="sm"
          options={[{value:"cards",label:"Cards"},{value:"gantt",label:"Gantt"}]}
          value={taskSubView}
          onChange={setTaskSubView}
        />
      </div>
      {/* ── Engineering Queue ── */}
      {canSignOffEngineering && engQueueItems.length > 0 && <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ lineHeight: 0, color: T.accent }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.accent }}>Engineering Queue</h3>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.accent, background: `${T.accent}20`, borderRadius: 10, padding: "2px 10px" }}>{engQueueItems.length}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {engQueueItems.map(({ job, panel }) => {
            const e = panel.engineering || {};
            const activeStep = !e.designed ? "designed" : !e.verified ? "verified" : "sentToPerforex";
            const jobClient = job.clientId ? clients.find(c => c.id === job.clientId) : null;
            return <div key={panel.id} style={{ background: T.card, border: `2px solid ${T.accent}33`, borderRadius: T.radius, padding: "18px 20px", boxShadow: `0 2px 12px ${T.accent}0f` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
                {job.jobNumber && <span style={{ color: T.accent, background: `${T.accent}15`, borderRadius: 4, padding: "1px 6px", fontFamily: T.mono }}>#{job.jobNumber}</span>}
                {jobClient && <span style={{ color: jobClient.color }}>{jobClient.name}</span>}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4, lineHeight: 1.3 }}>{job.title}</div>
              <div style={{ fontSize: 13, color: T.textSec, marginBottom: 14, fontFamily: T.mono }}>{panel.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {engSteps.map(step => {
                  const rec = e[step.key];
                  const done = !!rec;
                  const isActive = step.key === activeStep;
                  if (done) return <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: T.radiusSm, background: "#10b98110", border: "1px solid #10b98130" }}>
                    <span style={{ fontSize: 13, color: "#10b981", fontWeight: 700 }}>✓</span>
                    <span style={{ fontSize: 13, color: "#10b981", fontWeight: 600, flex: 1 }}>{step.label}</span>
                    <span style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>{rec.byName} · {new Date(rec.at).toLocaleDateString()}</span>
                    <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Undo" style={{ padding: "2px 7px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 11, color: T.textDim, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>↩ Undo</button>
                  </div>;
                  if (isActive) return <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => signOffEngineering(job.id, panel.id, step.key)} style={{ flex: 1, padding: "8px 14px", borderRadius: 14, background: T.accent, color: T.accentText, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: T.font, textAlign: "left" }}>→ Sign Off: {step.label}</button>
                  </div>;
                  return <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: T.radiusSm, opacity: 0.4 }}>
                    <span style={{ fontSize: 13, color: T.textDim }}>○</span>
                    <span style={{ fontSize: 13, color: T.textDim }}>{step.label}</span>
                  </div>;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>}

      {/* ── Finished Engineering ── */}
      {canSignOffEngineering && engFinishedItems.length > 0 && <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ lineHeight: 0, color: "#10b981" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#10b981" }}>Engineering Complete</h4>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98120", borderRadius: 10, padding: "1px 8px" }}>{engFinishedItems.length}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          {engFinishedItems.map(({ job, panel }) => {
            const e = panel.engineering || {};
            const jobClient = job.clientId ? clients.find(c => c.id === job.clientId) : null;
            return <div key={panel.id} style={{ background: T.card, border: "1px solid #10b98133", borderRadius: T.radiusSm, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginBottom: 3, display: "flex", gap: 6, alignItems: "center" }}>
                {job.jobNumber && <span style={{ fontFamily: T.mono }}>#{job.jobNumber}</span>}
                {jobClient && <span>{jobClient.name}</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 2 }}>{job.title}</div>
              <div style={{ fontSize: 12, color: T.textSec, fontFamily: T.mono, marginBottom: 10 }}>{panel.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {engSteps.map(step => {
                  const rec = e[step.key];
                  return <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#10b981", fontWeight: 700 }}>✓</span>
                    <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600, flex: 1 }}>{step.label}</span>
                    {rec && <span style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>{rec.byName} · {new Date(rec.at).toLocaleDateString()}</span>}
                    <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Undo" style={{ padding: "1px 6px", borderRadius: 5, background: "transparent", border: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>↩</button>
                  </div>;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>}

      {/* ── Jobs List + Detail ── */}
      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
      {/* Job list sidebar */}
      <div style={{ minWidth: 300, maxWidth: 300, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, position: "relative" }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Jobs</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
            <Btn size="sm" variant={jobSelectMode ? "primary" : "ghost"} onClick={() => { setJobSelectMode(m => !m); setSelJobs(new Set()); }}>{jobSelectMode ? "Done" : "Select"}</Btn>
            {jobSelectMode && <Btn size="sm" variant="ghost" onClick={() => setSelJobs(selJobs.size === activeTasks.length ? new Set() : new Set(activeTasks.map(t => t.id)))}>{selJobs.size === activeTasks.length ? "None" : "All"}</Btn>}
            <button onClick={() => setTaskFilterOpen(p => !p)} title="Filter" style={{ width: 30, height: 30, borderRadius: T.radiusXs, border: `1px solid ${activeFilterCount > 0 ? T.accent + "88" : T.border}`, background: activeFilterCount > 0 ? T.accent + "15" : T.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: activeFilterCount > 0 ? T.accent : T.textSec, position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              {activeFilterCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: T.accent, color: T.accentText, borderRadius: 8, minWidth: 14, height: 14, fontSize: 8, fontWeight: 700, lineHeight: "14px", textAlign: "center", padding: "0 3px" }}>{activeFilterCount}</span>}
            </button>
            {taskFilterOpen && <div style={{ position: "absolute", top: 36, right: 0, width: 250, background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, boxShadow: "0 8px 28px rgba(0,0,0,0.35)", zIndex: 200, padding: 12, display: "flex", flexDirection: "column", gap: 10, maxHeight: "80vh", overflowY: "auto" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {["All", "Not Started", "In Progress", "Finished", "On Hold"].map(s => <button key={s} onClick={() => setFStat(s === "All" ? "All" : s)} style={{ padding: "3px 8px", borderRadius: 8, border: `1.5px solid ${fStat === s ? T.accent : T.border}`, background: fStat === s ? T.accent + "22" : "transparent", color: fStat === s ? T.accent : T.text, fontSize: 10, fontWeight: fStat === s ? 700 : 400, cursor: "pointer", fontFamily: T.font }}>{s}</button>)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Client</div>
                <select value={fClient} onChange={e => setFClient(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: T.radiusXs, border: `1px solid ${fClient !== "All" ? T.accent : T.border}`, background: T.surface, color: fClient !== "All" ? T.accent : T.text, fontSize: 12, fontFamily: T.font, outline: "none", cursor: "pointer" }}>
                  <option value="All">All Clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>People {fPers.length > 0 && <span style={{ color: T.accent }}>({fPers.length})</span>}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {people.map(p => { const active = fPers.includes(String(p.id)); return <button key={p.id} onClick={() => setFPers(prev => prev.includes(String(p.id)) ? prev.filter(x => x !== String(p.id)) : [...prev, String(p.id)])} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, border: `1.5px solid ${active ? p.color : T.border}`, background: active ? (p.color + "28") : "transparent", color: active ? p.color : T.textSec, fontSize: 10, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: T.font }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: p.color || T.accent, flexShrink: 0 }} />{p.name.split(" ")[0]}</button>; })}
                  {fPers.length > 0 && <button onClick={() => setFPers([])} style={{ padding: "3px 7px", borderRadius: 20, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 9, cursor: "pointer", fontFamily: T.font }}>✕</button>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Task #</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="text" placeholder="e.g. 1042" value={fJobNum} onChange={e => setFJobNum(e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, padding: "6px 8px", borderRadius: T.radiusXs, border: `1px solid ${fJobNum ? T.accent : T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.mono, outline: "none", boxSizing: "border-box" }} />
                  {fJobNum && <button onClick={() => setFJobNum("")} style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, lineHeight: 1, flexShrink: 0 }}>×</button>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Sort By</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[["date","Date"],["project","Task #"],["client","Client"]].map(([val,label]) => (
                    <button key={val} onClick={() => setJobSort(val)} style={{ flex: 1, padding: "5px 4px", borderRadius: T.radiusXs, border: `1px solid ${jobSort === val ? T.accent : T.border}`, background: jobSort === val ? T.accent + "22" : "transparent", color: jobSort === val ? T.accent : T.text, fontSize: 11, fontWeight: jobSort === val ? 700 : 400, cursor: "pointer", fontFamily: T.font }}>{label}</button>
                  ))}
                </div>
              </div>
              {activeFilterCount > 0 && <button onClick={() => { setFStat("All"); setFClient("All"); setFPers([]); setFJobNum(""); setFRole("All"); setFHpd("All"); setFOverloaded(false); }} style={{ padding: "5px 8px", borderRadius: T.radiusXs, background: T.danger + "10", border: `1px solid ${T.danger}33`, fontSize: 11, color: T.danger, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Clear all filters</button>}
            </div>}
          </div>
        </div>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="Search jobs…" style={{ width: "100%", padding: "7px 28px 7px 28px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.font, outline: "none", boxSizing: "border-box" }} />
          {jobSearch && <button onClick={() => setJobSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: T.textDim, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {tasks.length === 0 && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 16px", textAlign: "center", gap: 10 }}>
            <div style={{ opacity: 0.35 }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><polyline points="8 11 9 12 11 10"/><polyline points="8 16 9 17 11 15"/></svg></div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.text }}>No tasks yet</h3>
            <p style={{ margin: "2px auto 0", fontSize: 13, color: T.textSec, lineHeight: 1.6 }}>Create a job or use FAST TRAQS to import</p>
            {can("editJobs") && <Btn size="sm" style={{ marginTop: 6 }} onClick={() => openNew()}>+ New Task</Btn>}
          </div>}
          {/* Active jobs */}
          {activeTasks.map(t => {
            const isSel = selTask === t.id;
            const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
            const health = getHealth(t);
            const healthColor = HEALTH_DOT[health];
            return <div key={t.id} onClick={() => { if (jobSelectMode) { setSelJobs(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); } else { setSelTask(isSel ? null : t.id); } }}
              style={{ background: isSel ? t.color + "18" : T.card, borderRadius: T.radiusSm, border: `1.5px solid ${jobSelectMode && selJobs.has(t.id) ? T.accent + "99" : isSel ? t.color + "66" : T.border}`, borderLeft: `4px solid ${t.color}`, padding: "10px 12px", cursor: "pointer", transition: "all 0.15s ease", boxShadow: isSel ? `0 0 16px ${t.color}15` : "none" }}
              onMouseEnter={e => { if (!isSel) { e.currentTarget.style.background = T.accent + "08"; e.currentTarget.style.borderColor = T.accent + "44"; } }}
              onMouseLeave={e => { if (!isSel) { e.currentTarget.style.background = T.card; e.currentTarget.style.borderColor = jobSelectMode && selJobs.has(t.id) ? T.accent + "99" : T.border; } }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 7, flexWrap: "wrap" }}>
                {["Pending", "In Progress", "On Hold", "Finished"].map(s => (
                  <button key={s} onClick={e => { e.stopPropagation(); updTask(t.id, { status: s }); }} style={{ padding: "2px 8px", borderRadius: 20, border: `1px solid ${t.status === s ? STA_C[s] : T.border}`, background: t.status === s ? STA_C[s] + "22" : "transparent", color: t.status === s ? STA_C[s] : T.textDim, fontSize: 11, fontWeight: t.status === s ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}>{s}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                {jobSelectMode && <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${selJobs.has(t.id) ? T.accent : T.border}`, background: selJobs.has(t.id) ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>{selJobs.has(t.id) && <svg width="8" height="8" viewBox="0 0 10 10"><polyline points="1.5,5.5 4,8 8.5,2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>}
                {!jobSelectMode && <div style={{ width: 7, height: 7, borderRadius: "50%", background: healthColor, flexShrink: 0, boxShadow: `0 0 5px ${healthColor}66` }} />}
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <Badge t={t.status} c={STA_C[t.status]} />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {t.jobNumber && <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, background: T.accent + "15", borderRadius: 4, padding: "1px 5px", fontFamily: T.mono }}>#{t.jobNumber}</span>}
                {client && <span style={{ fontSize: 11, color: client.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: client.color, display: "inline-block" }} />{client.name}</span>}
                <span style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginLeft: "auto" }}>{fm(t.start)} – {fm(t.end)}</span>
              </div>
            </div>;
          })}
          {/* Finished jobs */}
          {finishedTasks.length > 0 && <>
            <div style={{ margin: "10px 0 6px", borderTop: `1px solid ${T.border}`, position: "relative" }}>
              <span style={{ position: "absolute", top: -9, left: 0, background: T.bg, paddingRight: 8, fontSize: 10, color: T.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Finished</span>
            </div>
            {finishedTasks.map(t => {
              const isSel = selTask === t.id;
              const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
              return <div key={t.id} onClick={() => setSelTask(isSel ? null : t.id)}
                style={{ background: isSel ? "#10b98118" : T.card, borderRadius: T.radiusSm, border: `1.5px solid ${isSel ? "#10b98166" : T.border}`, borderLeft: "4px solid #10b981", padding: "9px 12px", cursor: "pointer", opacity: isSel ? 1 : 0.65, transition: "all 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; if (!isSel) e.currentTarget.style.borderColor = "#10b98144"; }}
                onMouseLeave={e => { if (!isSel) { e.currentTarget.style.opacity = "0.65"; e.currentTarget.style.borderColor = T.border; } }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 11 }}>✅</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {client && <span style={{ fontSize: 10, color: client.color, fontWeight: 600 }}>{client.name}</span>}
                  <span style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>{fm(t.end)}</span>
                </div>
              </div>;
            })}
          </>}
        </div>
      </div>

      {/* Job detail panel */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {can("editJobs") && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12, flexShrink: 0 }}>
          {fresh && <Btn variant="ghost" onClick={() => openEdit(fresh)}>Edit</Btn>}
          <Btn onClick={() => openNew()}>+ New Task</Btn>
        </div>}
        <div style={{ flex: 1, overflow: "auto" }}>
        {!fresh ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 16 }}>
            <div style={{ opacity: 0.3 }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/></svg></div>
            <div style={{ fontSize: 16, color: T.textDim }}>Select a job to view details</div>
          </div>
        ) : (
          <div>
            {/* Job header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <HealthIcon t={fresh} size={22} style={{ flexShrink: 0 }} />
                <div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{fresh.title}</h2>
                  {(fresh.jobNumber || fresh.poNumber) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {fresh.jobNumber && <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>Task # {fresh.jobNumber}</span>}
                    {fresh.poNumber && <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98115", border: "1px solid #10b98133", borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>PO # {fresh.poNumber}</span>}
                  </div>}
                </div>
              </div>
            </div>

            {/* Meta row */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
              {fresh.clientId && <Badge t={"🏢 " + clientName(fresh.clientId)} c={clientColor(fresh.clientId)} lg />}
              <span style={{ fontSize: 14, color: T.textSec, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: T.mono }}>{fm(fresh.start)}</span><span style={{ color: T.textDim }}>→</span><span style={{ fontFamily: T.mono }}>{fm(fresh.end)}</span>{fresh.hpd > 0 && <><span style={{ color: T.textDim }}> · </span>{fresh.hpd}h/day</>}
              </span>
              <ColorSlidingPill
                options={STATUSES.map(s => ({ value: s, label: s, color: STA_C[s] }))}
                value={fresh.status || "Not Started"}
                onChange={v => updTask(fresh.id, { status: v })}
              />
              <ColorSlidingPill
                options={["Low","Medium","High"].map(p => ({ value: p, label: p, color: PRI_C[p] }))}
                value={fresh.pri || "Medium"}
                onChange={v => updTask(fresh.id, { pri: v })}
              />
            </div>

            {/* Due date */}
            {fresh.dueDate && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 16px", background: fresh.dueDate < TD ? "#ef444415" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b15" : T.surface, borderRadius: T.radiusSm, border: `1px solid ${fresh.dueDate < TD ? "#ef444433" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b33" : T.border}` }}>
              <span style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>Customer Due:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: fresh.dueDate < TD ? "#ef4444" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b" : T.text, fontFamily: T.mono }}>{fm(fresh.dueDate)}</span>
              {fresh.dueDate < TD && <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>OVERDUE</span>}
            </div>}

            {/* Notes */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Notes</div>
              <textarea key={fresh.id} defaultValue={fresh.notes || ""} onBlur={e => updTask(fresh.id, { notes: e.target.value })} rows={3} placeholder="Add notes…" style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.text, fontSize: 14, padding: "12px 14px", fontFamily: T.font, resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6, transition: "border-color 0.15s" }} onFocus={e => e.target.style.borderColor = T.accent} />
            </div>

            {/* Panels and Operations */}
            {parent && (parent.subs || []).length > 0 && <div style={{ marginBottom: 20 }}>
              <h4 style={{ color: T.text, fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>Panels ({parent.subs.length})</h4>
              {parent.subs.map(panel => {
                const hasEng = panel.engineering !== undefined;
                const pEng = panel.engineering || {};
                const engAllDone = hasEng && !!(pEng.designed && pEng.verified && pEng.sentToPerforex);
                const pActiveStep = hasEng ? (!pEng.designed ? "designed" : !pEng.verified ? "verified" : "sentToPerforex") : null;
                return <div key={panel.id} style={{ background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${engAllDone ? "#10b98133" : hasEng ? T.accent + "33" : T.border}`, padding: 14, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <HealthIcon t={panel} size={14} />
                    <span style={{ flex: 1, fontSize: 14, color: T.text, fontWeight: 600, fontFamily: T.mono }}>{panel.title}</span>
                    <span style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>{fm(panel.start)} → {fm(panel.end)}</span>
                  </div>
                  {hasEng && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: T.radiusXs, marginBottom: 8, background: engAllDone ? "#10b98108" : T.accent + "08", border: `1px solid ${engAllDone ? "#10b98133" : T.accent + "22"}`, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, marginRight: 4 }}>ENG:</span>
                    {engSteps.map(step => {
                      const done = !!pEng[step.key];
                      const isActive = step.key === pActiveStep;
                      if (done) return <span key={step.key} style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>✓ <span style={{ color: T.textDim }}>{step.label}</span></span>;
                      if (isActive && canSignOffEngineering) return <button key={step.key} onClick={() => signOffEngineering(parent.id, panel.id, step.key)} style={{ padding: "3px 10px", borderRadius: 12, background: T.accent, color: T.accentText, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>;
                      if (isActive) return <span key={step.key} style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>→ {step.label}</span>;
                      return <span key={step.key} style={{ fontSize: 11, color: T.textDim, opacity: 0.4 }}>○ {step.label}</span>;
                    })}
                    {engAllDone && <span style={{ marginLeft: "auto", fontSize: 11, color: "#10b981", fontWeight: 600 }}>✓ Ready</span>}
                  </div>}
                  {(panel.subs || []).length > 0 && <div>
                    {panel.subs.map(op => { const assignee = (op.team || [])[0]; const person = assignee ? people.find(x => x.id === assignee) : null;
                      return <div key={op.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: T.radiusXs, marginBottom: 4, background: T.bg, border: `1px solid ${T.border}` }}>
                        <HealthIcon t={op} size={12} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: T.text, minWidth: 50 }}>{op.title}</span>
                        <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(op.start)}–{fm(op.end)}</span>
                        {person && <span style={{ marginLeft: "auto", fontSize: 12, color: person.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 16, height: 16, borderRadius: 6, background: person.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>{person.name[0]}</span>{person.name}</span>}
                        {!person && <span style={{ marginLeft: "auto", fontSize: 11, color: T.textDim, fontStyle: "italic" }}>Unassigned</span>}
                      </div>; })}
                  </div>}
                </div>;
              })}
            </div>}

            {/* Subtasks (non-panel) */}
            {(!parent || (parent.subs || []).length === 0) && (fresh.subs || []).length > 0 && <div style={{ marginBottom: 20 }}>
              <h4 style={{ color: T.text, fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>Subtasks ({fresh.subs.length})</h4>
              {fresh.subs.map(s => <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: T.radiusSm, marginBottom: 6, background: T.surface, border: `1px solid ${T.border}` }}>
                <HealthIcon t={s} size={13} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{s.title}</span>
                <span style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>{fm(s.start)} → {fm(s.end)}</span>
              </div>)}
            </div>}

            {/* Team */}
            {(fresh.team || []).length > 0 && <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Team</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {fresh.team.map(id => { const p = people.find(x => x.id === id); if (!p) return null; return <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: T.radiusSm, background: p.color + "15", border: `1px solid ${p.color}44` }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: T.textDim }}>{p.role}</span>
                </div>; })}
              </div>
            </div>}
          </div>
        )}
        </div>
      </div>
      </div>
    </div>;
  };

  // ═══════════════════ CLIENTS ═══════════════════
  const renderClients = () => {
    const sel = selClient ? clients.find(c => c.id === selClient) : null;
    const selTasks = selClient ? tasks.filter(t => t.clientId === selClient) : [];
    const completed = selTasks.filter(t => t.status === "Finished").length;
    const inProg = selTasks.filter(t => t.status === "In Progress").length;
    const totalHrs = selTasks.reduce((a, t) => a + (t.hpd || 0) * (diffD(t.start, t.end) + 1), 0);
    const filteredClients = clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()) || (c.contact || "").toLowerCase().includes(clientSearch.toLowerCase()));

    return <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16 }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text, flexShrink: 0 }}>Clients</h3>
          <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
            <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Search clients…" style={{ width: "100%", padding: "8px 10px 8px 30px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: T.font, outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {can("manageClients") && <Btn size="sm" variant={clientSelectMode ? "primary" : "ghost"} onClick={() => { setClientSelectMode(m => !m); setSelClients(new Set()); }}>{clientSelectMode ? "Done" : "Select"}</Btn>}
          {can("manageClients") && clientSelectMode && <Btn size="sm" variant="ghost" onClick={() => setSelClients(selClients.size === filteredClients.length ? new Set() : new Set(filteredClients.map(c => c.id)))}>{selClients.size === filteredClients.length ? "None" : "All"}</Btn>}
          {can("manageClients") && !clientSelectMode && <Btn size="sm" onClick={() => setClientModal({ id: null, name: "", contact: "", email: "", phone: "", color: COLORS[Math.floor(Math.random() * 10)], notes: "" })}>+ Add</Btn>}
        </div>
      </div>

      {/* Card grid */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {clients.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 24px", textAlign: "center", gap: 12 }}>
            <div style={{ marginBottom: 4, opacity: 0.45 }}><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg></div>
            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>No clients yet</h3>
            <p style={{ margin: "2px auto 0", fontSize: 14, color: T.textSec, maxWidth: 240, lineHeight: 1.65 }}>Add your first client to organize jobs by company</p>
            {can("manageClients") && <Btn size="sm" style={{ marginTop: 8 }} onClick={() => setClientModal({ id: null, name: "", contact: "", email: "", phone: "", color: COLORS[Math.floor(Math.random() * 10)], notes: "" })}>+ Add Client</Btn>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filteredClients.map(c => {
              const ct = tasks.filter(t => t.clientId === c.id);
              const active = ct.filter(t => t.status !== "Finished").length;
              const done = ct.filter(t => t.status === "Finished").length;
              const isSel = selClient === c.id;
              const isBulkSel = selClients.has(c.id);
              return <div key={c.id} onClick={() => clientSelectMode ? setSelClients(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; }) : setSelClient(isSel ? null : c.id)} style={{
                background: isBulkSel ? T.accent + "12" : isSel ? c.color + "18" : T.card,
                borderRadius: T.radius,
                border: `1.5px solid ${isBulkSel ? T.accent + "55" : isSel ? c.color + "66" : T.border}`,
                padding: "20px 20px 16px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: isBulkSel ? `0 0 20px ${T.accent}18` : isSel ? `0 0 20px ${c.color}18` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                  {clientSelectMode
                    ? <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${isBulkSel ? T.accent : T.border}`, background: isBulkSel ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s", marginTop: 2 }}>{isBulkSel && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5.5 4,8 8.5,2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>
                    : <div style={{ width: 42, height: 42, borderRadius: 12, background: c.color + "22", border: `2px solid ${c.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: c.color, flexShrink: 0 }}>{c.name.charAt(0)}</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{c.name}</div>
                    {c.contact && <div style={{ fontSize: 13, color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.contact}</div>}
                  </div>
                  {!clientSelectMode && can("manageClients") && <span onClick={e => { e.stopPropagation(); setClientModal({ ...c }); }} style={{ cursor: "pointer", fontSize: 12, color: T.textDim, padding: "3px 8px", borderRadius: 4, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0 }}>Edit</span>}
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                  <div style={{ flex: 1, background: T.surface, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: c.color, fontFamily: T.mono }}>{ct.length}</div>
                    <div style={{ color: T.textDim, marginTop: 1 }}>Total</div>
                  </div>
                  <div style={{ flex: 1, background: T.surface, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: "#3b82f6", fontFamily: T.mono }}>{active}</div>
                    <div style={{ color: T.textDim, marginTop: 1 }}>Active</div>
                  </div>
                  <div style={{ flex: 1, background: T.surface, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: "#10b981", fontFamily: T.mono }}>{done}</div>
                    <div style={{ color: T.textDim, marginTop: 1 }}>Done</div>
                  </div>
                </div>
              </div>;
            })}
          </div>
        )}
      </div>

      {/* Client detail slide-in panel */}
      {sel && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }} onClick={() => setSelClient(null)}>
        <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 1000, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", position: "relative" }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setSelClient(null)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, paddingRight: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: sel.color + "22", border: `2px solid ${sel.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: sel.color }}>{sel.name.charAt(0)}</div>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text }}>{sel.name}</h2>
                <div style={{ fontSize: 13, color: T.textSec, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {sel.contact && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{sel.contact}</span>}
                  {sel.email && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>{sel.email}</span>}
                  {sel.phone && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.32 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.55a16 16 0 0 0 6.06 6.06l.91-.9a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>{sel.phone}</span>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {can("manageClients") && <Btn size="sm" onClick={() => setClientModal({ ...sel })}>Edit</Btn>}
              {can("manageClients") && <Btn variant="danger" size="sm" onClick={() => { delClient(sel.id); setSelClient(null); }}>Delete</Btn>}
            </div>
          </div>

          {sel.notes && <div style={{ fontSize: 14, color: T.textSec, padding: 14, background: T.surface, borderRadius: T.radiusSm, marginBottom: 20, lineHeight: 1.6, border: `1px solid ${T.border}` }}>{sel.notes}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
            {[
              { label: "Total Jobs", val: selTasks.length, color: sel.color },
              { label: "In Progress", val: inProg, color: "#3b82f6" },
              { label: "Finished", val: completed, color: "#10b981" },
              { label: "Est. Hours", val: totalHrs, color: "#f59e0b" },
            ].map(s => <div key={s.label} style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 16px", border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: T.mono }}>{s.val}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            </div>)}
          </div>

          {(() => {
            const activeJobs = selTasks.filter(t => t.status !== "Finished");
            const completedJobs = selTasks.filter(t => t.status === "Finished");
            const renderJobCard = (t) => {
              const dur = diffD(t.start, t.end) + 1;
              const pct = t.status === "Finished" ? 100 : t.status === "In Progress" ? 50 : t.status === "Pending" ? 15 : t.status === "On Hold" ? 25 : 0;
              return <div key={t.id} style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 18px", border: `1px solid ${T.border}`, borderLeft: `4px solid ${t.color}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <HealthIcon t={t} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => openDetail(t)}>{t.title}</span>
                    {t.jobNumber && <span style={{ fontSize: 11, fontFamily: T.mono, color: T.accent, background: T.accent + "15", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>#{t.jobNumber}</span>}
                  </div>
                  <Badge t={t.status} c={STA_C[t.status]} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: T.textSec, marginBottom: 8 }}>
                  <span style={{ fontFamily: T.mono }}>{fm(t.start)} → {fm(t.end)}</span>
                  <span>{dur} day{dur !== 1 ? "s" : ""}</span>
                  {(t.subs || []).length > 0 && <span>{t.subs.length} panel{t.subs.length !== 1 ? "s" : ""}</span>}
                </div>
                <div style={{ background: T.bg, borderRadius: 4, height: 5, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", borderRadius: 4, background: t.color, width: `${pct}%`, transition: "width 0.3s" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{t.team.slice(0, 4).map(id => <Badge key={id} t={pName(id)} c={T.accent} />)}{t.team.length > 4 && <Badge t={`+${t.team.length - 4}`} c={T.textDim} />}</div>
                  {can("editJobs") && <Btn variant="ghost" size="sm" onClick={() => openEdit(t)}>Edit</Btn>}
                </div>
              </div>;
            };
            return <>
              {/* Active Jobs */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.text }}>Active Jobs ({activeJobs.length})</h4>
                {can("editJobs") && <Btn size="sm" onClick={() => { const m = { type: "edit", data: { id: null, title: "", start: TD, end: addD(TD, 3), pri: "Medium", status: "Not Started", team: [], color: T.accent, hpd: 7.5, notes: "", subs: [], deps: [], clientId: sel.id }, parentId: null }; setModal(m); }}>+ Add Job</Btn>}
              </div>
              {activeJobs.length === 0 && <div style={{ textAlign: "center", padding: 20, color: T.textDim, fontSize: 13, background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, marginBottom: 16 }}>No active jobs for this client.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {activeJobs.map(renderJobCard)}
              </div>
              {/* Completed Jobs Folder */}
              {completedJobs.length > 0 && <div style={{ border: `1px solid #10b98133`, borderRadius: T.radiusSm, overflow: "hidden" }}>
                <div onClick={() => setClientCompletedExpanded(p => !p)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#10b98110", cursor: "pointer", userSelect: "none" }}>
                  <span style={{ fontSize: 16 }}>{clientCompletedExpanded ? "📂" : "📁"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#10b981", flex: 1 }}>Completed Jobs</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98122", borderRadius: 10, padding: "1px 10px" }}>{completedJobs.length}</span>
                  <span style={{ fontSize: 12, color: "#10b981", opacity: 0.7 }}>{clientCompletedExpanded ? "▲" : "▼"}</span>
                </div>
                {clientCompletedExpanded && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: T.surface }}>
                  {completedJobs.map(t => <div key={t.id} style={{ background: T.card, borderRadius: T.radiusSm, padding: "12px 14px", border: `1px solid #10b98122`, borderLeft: `4px solid #10b981` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>✅</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => openDetail(t)}>{t.title}</span>
                      {t.jobNumber && <span style={{ fontSize: 11, fontFamily: T.mono, color: "#10b981", background: "#10b98115", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>#{t.jobNumber}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: T.textDim }}>
                      <span style={{ fontFamily: T.mono }}>{fm(t.start)} → {fm(t.end)}</span>
                      {t.poNumber && <span>PO: {t.poNumber}</span>}
                      {(t.subs || []).length > 0 && <span>{t.subs.length} panel{t.subs.length !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>)}
                </div>}
              </div>}
            </>;
          })()}
        </div>
      </div>}
    </div>;
  };

  // ═══════════════════ TEAM (Resource Planner) ═══════════════════
  const [tStart, setTStart] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [tEnd, setTEnd] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  const [tMode, setTMode] = useState("month");
  const [tCollapsed, setTCollapsed] = useState({});
  const [tExpanded, setTExpanded] = useState({});
  const teamRef = useRef(null);
  const teamContainerRef = useRef(null);
  const [teamWidth, setTeamWidth] = useState(1200);
  useEffect(() => {
    const el = teamContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setTeamWidth(e.contentRect.width); });
    ro.observe(el);
    setTeamWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [view]);

  const renderTeam = () => {
    const days = []; let dc = tStart; while (dc <= tEnd) { days.push(dc); dc = addD(dc, 1); }
    const lW = isMobile ? 120 : 260, rH = 42, grpH = 36;
    const tAvail = Math.max((teamWidth || 1200) - lW, 200);
    const cW = isMobile ? Math.max(28, tAvail / Math.max(days.length, 1)) : tAvail / Math.max(days.length, 1);
    teamCWRef.current = cW;
    // Group people by role
    const roles = []; const roleMap = {};
    people.forEach(p => { if (!roleMap[p.role]) { roleMap[p.role] = []; roles.push(p.role); } roleMap[p.role].push(p); });
    // Build month/week groups for header
    const hGroups = []; days.forEach((day, i) => {
      const dt = new Date(day + "T12:00:00");
      const key = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (!hGroups.length || hGroups[hGroups.length - 1].key !== key) {
        hGroups.push({ key, label: dt.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase(), start: i, span: 1 });
      } else hGroups[hGroups.length - 1].span++;
    });
    // Calc utilization per person
    const getUtil = (pid) => {
      let totalCap = 0, totalBooked = 0;
      days.forEach(day => {
        const p = people.find(x => x.id === pid);
        if (!p) return;
        if (!isOff(pid, day) && ![0, 6].includes(new Date(day + "T12:00:00").getDay())) {
          totalCap += p.cap;
          totalBooked += Math.min(p.cap, bookedHrs(pid, day));
        }
      });
      return totalCap > 0 ? Math.round((totalBooked / totalCap) * 100) : 0;
    };
    // Calc group avg util
    const grpUtil = (role) => {
      const pp = roleMap[role]; if (!pp.length) return 0;
      return Math.round(pp.reduce((s, p) => s + getUtil(p.id), 0) / pp.length);
    };
    // Get tasks for a person within visible range — parent tasks only
    const getPersonBars = (pid) => {
      const bars = [];
      // PTO bars
      const person = people.find(x => x.id === pid);
      if (person) (person.timeOff || []).forEach((to, i) => {
        if (to.end < tStart || to.start > tEnd) return;
        const s = to.start < tStart ? tStart : to.start;
        const e = to.end > tEnd ? tEnd : to.end;
        const ptoColor = to.type === "UTO" ? "#f59e0b" : "#10b981";
        bars.push({ type: "pto", id: "pto-" + pid + "-" + i, start: s, end: e, title: to.reason || (to.type || "PTO"), color: ptoColor, task: null, subs: [], hasSubs: false, personId: pid, toIdx: i, fullStart: to.start, fullEnd: to.end, ptoType: to.type || "PTO" });
      });
      // Operation bars (level 2: Wire/Cut/Layout assigned to this person)
      tasks.forEach(job => {
        if ((job.jobType || "panel") === "panel") {
          (job.subs || []).forEach(panel => {
            (panel.subs || []).forEach(op => {
              if (!op.team.includes(pid)) return;
              if (op.status === "Finished") return;
              if (op.end < tStart || op.start > tEnd) return;
              const s = op.start < tStart ? tStart : op.start;
              const e = op.end > tEnd ? tEnd : op.end;
              const cl = job.clientId ? clients.find(x => x.id === job.clientId) : null;
              const tc = (() => { const p0 = (op.team || [])[0]; const pp = people.find(x => x.id === p0); return pp ? pp.color : T.accent; })();
              bars.push({ type: "task", id: op.id, start: s, end: e, title: `${panel.title} · ${op.title}`, color: tc, clientName: cl ? cl.name : null, jobNumber: job.jobNumber || null, status: op.status, task: { ...op, color: tc, isSub: true, pid: panel.id, grandPid: job.id, jobTitle: job.title, jobNumber: job.jobNumber || null, poNumber: job.poNumber || null, panelTitle: panel.title, level: 2 }, subs: [], hasSubs: false });
            });
          });
        } else {
          // General task: flat subtasks assigned directly to people
          (job.subs || []).forEach(sub => {
            if (!(sub.team || []).includes(pid)) return;
            if (sub.status === "Finished") return;
            if (!sub.start || !sub.end || sub.end < tStart || sub.start > tEnd) return;
            const s = sub.start < tStart ? tStart : sub.start;
            const e = sub.end > tEnd ? tEnd : sub.end;
            const cl = job.clientId ? clients.find(x => x.id === job.clientId) : null;
            const tc = (() => { const p0 = (sub.team || [])[0]; const pp = people.find(x => x.id === p0); return pp ? pp.color : T.accent; })();
            bars.push({ type: "task", id: sub.id, start: s, end: e, title: `${job.title} · ${sub.title}`, color: tc, clientName: cl ? cl.name : null, jobNumber: job.jobNumber || null, status: sub.status, task: { ...sub, color: tc, isSub: true, pid: job.id, jobTitle: job.title, jobNumber: job.jobNumber || null, level: 1 }, subs: [], hasSubs: false });
          });
        }
      });
      // Engineering task chips for engineers — one chip per panel with pending eng steps
      if (person && person.isEngineer) {
        tasks.forEach(job => {
          (job.subs || []).forEach(panel => {
            if (panel.engineering === undefined) return; // not a panel job
            const e = panel.engineering || {};
            const allDone = !!(e.designed && e.verified && e.sentToPerforex);
            // Position chip on wire start date (first op start), fallback to panel start
            const wireOp = (panel.subs || []).find(op => op.title === "Wire");
            const chipDate = wireOp ? wireOp.start : panel.start;
            if (chipDate < tStart || chipDate > tEnd) return;
            const activeStep = !e.designed ? "Designed" : !e.verified ? "Verified" : "Perforex";
            bars.push({
              type: "eng-chip",
              id: `eng-${job.id}-${panel.id}`,
              start: chipDate, end: chipDate,
              title: `${panel.title} · ${activeStep}`,
              color: allDone ? "#10b981" : "#3b82f6",
              allDone,
              activeStep,
              panelTitle: panel.title,
              jobId: job.id,
              panelId: panel.id,
              task: { ...job, isSub: false },
              subs: [], hasSubs: false,
            });
          });
        });
      }
      bars.sort((a, b) => {
        if (a.type !== "task" || b.type !== "task") return 0;
        if (gSort === "project") return String(a.jobNumber || "").localeCompare(String(b.jobNumber || ""), undefined, { numeric: true });
        if (gSort === "client") return (a.clientName || "").localeCompare(b.clientName || "") || a.start.localeCompare(b.start);
        return a.start.localeCompare(b.start);
      });
      return bars;
    };
    // Build flat row list with subtask expansion
    const rowList = []; roles.forEach(role => {
      if (fRole !== "All" && role?.toLowerCase() !== fRole.toLowerCase()) return;
      rowList.push({ type: "group", role, util: grpUtil(role) });
      if (!tCollapsed[role]) roleMap[role].forEach(p => {
        if (fPers.length > 0 && !fPers.includes(String(p.id))) return;
        const bars = getPersonBars(p.id);
        rowList.push({ type: "person", person: p, util: getUtil(p.id), bars });
      });
    });
    const subH = 34;
    const tW = lW + days.length * cW;
    const totalH = rowList.reduce((s, r) => s + (r.type === "group" ? grpH : rH), 0) + 56;
    // Team day-view bar drag
    // rawBarS/rawBarE: actual visual start/end hours from barPositions (may differ from barTask.startHour/hpd when auto-stacked)
    const handleTeamDayBarDrag = (e, barTask, mode = "move", fromPersonId = null, rawBarS = null, rawBarE = null) => {
      if (!barTask) return;
      e.preventDefault(); e.stopPropagation();
      const DHS = 5, DHE = 21, DNH = 16;
      const origHour = rawBarS ?? (barTask.startHour ?? 8);
      const origHpd = rawBarE != null ? (rawBarE - origHour) : (barTask.hpd || 0);
      const origEnd = origHour + origHpd;
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const pid = barTask.isSub ? barTask.pid : null;
      // Measure the timeline area (right side of the row) at drag start
      const timelineEl = e.currentTarget.parentElement; // position:relative flex div
      const rowRect = timelineEl.getBoundingClientRect();
      const timelineLeft = rowRect.left;
      const timelineWidth = Math.max(rowRect.width, 1);
      // Compute where within the bar we grabbed (in hours)
      const cursorHourAtStart = DHS + (sx - timelineLeft) / timelineWidth * DNH;
      const grabOffsetHours = mode === "move" ? Math.max(0, Math.min(origHpd, cursorHourAtStart - origHour)) : 0;
      const grabOffsetPx = grabOffsetHours / DNH * timelineWidth;
      const barH = rH - 8;
      // Use actual visual duration (origHpd from rawBarE-rawBarS, or 2h fallback for no-hours bars)
      const visualDuration = origHpd > 0 ? origHpd : 2;
      const barW = Math.max(32, visualDuration / DNH * timelineWidth - 4);
      // Helper: which person row is under a given clientY
      const getPersonAtY = (clientY) => {
        const el = teamContainerRef.current; if (!el) return null;
        const rect = el.getBoundingClientRect();
        let relY = clientY - rect.top - 48; // 48 = hour header height
        for (const row of rowList) {
          const h = row.type === "group" ? grpH : rH;
          if (relY < h) return row.type === "person" ? row.person : null;
          relY -= h;
        }
        return null;
      };
      const onM = me => {
        const dx = me.clientX - sx;
        if (Math.abs(dx) > 8 || Math.abs(me.clientY - sy) > 10) moved = true;
        if (!moved) return;
        setDayDragInfo({ itemId: barTask.id, mode });
        if (mode === "move") {
          // Compute drop hour for tooltip
          const dropHour = Math.max(DHS, Math.min(DHE - origHpd, (DHS + (me.clientX - grabOffsetPx - timelineLeft) / timelineWidth * DNH)));
          const dropH = Math.floor(dropHour), dropM = Math.round((dropHour % 1) * 60);
          const dropLabel = `${dropH > 12 ? dropH - 12 : dropH === 0 ? 12 : dropH}:${String(dropM).padStart(2,"0")} ${dropH >= 12 ? "PM" : "AM"}`;
          setTeamDayGhost({ left: me.clientX - grabOffsetPx, top: me.clientY - barH / 2, width: barW, height: barH, color: barTask.color, label: `${barTask.title || ""}`, time: dropLabel });
          const target = getPersonAtY(me.clientY);
          setDayDragTarget(target && target.id !== fromPersonId ? target.id : null);
        } else if (mode === "left") {
          const cursorHour = DHS + (me.clientX - timelineLeft) / timelineWidth * DNH;
          const newStart = Math.round(cursorHour * 4) / 4;
          const clamped = Math.max(DHS, Math.min(origEnd - 0.25, newStart));
          updTask(barTask.id, { startHour: clamped, hpd: Math.round((origEnd - clamped) * 100) / 100 }, pid);
        } else {
          const cursorHour = DHS + (me.clientX - timelineLeft) / timelineWidth * DNH;
          const newEnd = Math.round(cursorHour * 4) / 4;
          const clamped = Math.max(origHour + 0.25, Math.min(DHE, newEnd));
          updTask(barTask.id, { hpd: Math.round((clamped - origHour) * 100) / 100 }, pid);
        }
      };
      const onU = (me) => {
        document.removeEventListener("mousemove", onM);
        document.removeEventListener("mouseup", onU);
        if (moved && mode === "move") {
          // Apply ghost's final position to the real task
          const cursorHour = DHS + (me.clientX - timelineLeft) / timelineWidth * DNH;
          const newStart = Math.round((cursorHour - grabOffsetHours) * 4) / 4;
          const clamped = Math.max(DHS, Math.min(DHE - Math.max(origHpd, 0.25), newStart));
          updTask(barTask.id, { startHour: clamped }, pid);
          const target = getPersonAtY(me.clientY);
          if (fromPersonId && target && target.id !== fromPersonId) reassignTask(barTask.id, fromPersonId, target.id, pid);
        }
        setTeamDayGhost(null);
        setDayDragInfo(null);
        setDayDragTarget(null);
        if (!moved && mode === "move") openDetail(barTask);
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    };

    return <div>
      {/* Top nav */}
      <div style={{ display: "flex", gap: isMobile ? 6 : 12, marginBottom: isMobile ? 10 : 20, alignItems: "center", flexWrap: "wrap", position: "relative", minHeight: 44, justifyContent: isAdmin ? "flex-start" : "center" }}>
        {isAdmin && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn variant="primary" size="sm" onClick={() => setPersonModal({ id: null, name: "", role: "", email: "", cap: 8, color: COLORS[Math.floor(Math.random() * COLORS.length)], teamNumber: null, isTeamLead: false, isEngineer: false, userRole: "user" })}>+ Add Member</Btn>
          <Btn size="sm" variant={teamSelectMode ? "primary" : "ghost"} style={!teamSelectMode ? { background: "transparent" } : {}} onClick={() => { setTeamSelectMode(m => !m); setSelPeople(new Set()); }}>{teamSelectMode ? "Done" : "Select"}</Btn>
          {teamSelectMode && <Btn size="sm" variant="ghost" onClick={() => setSelPeople(selPeople.size === people.length ? new Set() : new Set(people.map(p => p.id)))}>{selPeople.size === people.length ? "None" : "All"}</Btn>}
        <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setFilterOpen(p => !p)} title="Filters" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 9px", borderRadius: T.radiusSm, border: `1px solid ${activeFilterCount > 0 ? T.accent + "88" : T.border}`, background: activeFilterCount > 0 ? T.accent + "15" : "transparent", color: activeFilterCount > 0 ? T.accent : T.textSec, cursor: "pointer", transition: "all 0.15s", position: "relative" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            {activeFilterCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: T.accent, color: T.accentText, borderRadius: 8, minWidth: 16, height: 16, fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center", padding: "0 4px" }}>{activeFilterCount}</span>}
          </button>
          {filterOpen && <div className="anim-ctx" style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 999, width: 290, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "14px 14px 10px", boxShadow: "0 16px 48px rgba(0,0,0,0.55)", fontFamily: T.font, maxHeight: "80vh", overflowY: "auto" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Sort By</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {[["date","Date"],["project","Task #"],["client","Client"]].map(([val,label]) => (
                  <button key={val} onClick={() => setGSort(val)} style={{ flex: 1, padding: "5px 4px", borderRadius: T.radiusXs, border: `1px solid ${gSort === val ? T.accent : T.border}`, background: gSort === val ? T.accent + "22" : "transparent", color: gSort === val ? T.accent : T.text, fontSize: 11, fontWeight: gSort === val ? 700 : 400, cursor: "pointer", fontFamily: T.font }}>{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Status</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {["All", "Not Started", "In Progress", "Finished", "On Hold"].map(s => <button key={s} onClick={() => setFStat(s === "All" ? "All" : s)} style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${fStat === s ? T.accent : T.border}`, background: fStat === s ? T.accent + "22" : "transparent", color: fStat === s ? T.accent : T.text, fontSize: 11, fontWeight: fStat === s ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}>{s}</button>)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>People {fPers.length > 0 && <span style={{ color: T.accent }}>({fPers.length})</span>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {people.map(p => { const active = fPers.includes(String(p.id)); return <button key={p.id} onClick={() => setFPers(prev => prev.includes(String(p.id)) ? prev.filter(x => x !== String(p.id)) : [...prev, String(p.id)])} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 20, border: `1.5px solid ${active ? p.color : T.border}`, background: active ? (p.color + "28") : "transparent", color: active ? p.color : T.textSec, fontSize: 11, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: p.color || T.accent, flexShrink: 0 }} />{p.name.split(" ")[0]}</button>; })}
                {fPers.length > 0 && <button onClick={() => setFPers([])} style={{ padding: "4px 8px", borderRadius: 20, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 10, cursor: "pointer", fontFamily: T.font }}>✕ Clear</button>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Task #</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                <input type="text" placeholder="e.g. 1042" value={fJobNum} onChange={e => setFJobNum(e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, padding: "6px 10px", borderRadius: T.radiusSm, border: `1.5px solid ${fJobNum ? T.accent : T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: T.mono, outline: "none", boxSizing: "border-box" }} />
                {fJobNum && <button onClick={() => setFJobNum("")} style={{ width: 26, height: 26, borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, lineHeight: 1 }}>×</button>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Role / Area</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {["All", ...uniqueRoles].map(r => <button key={r} onClick={() => setFRole(r)} style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${fRole === r ? T.accent : T.border}`, background: fRole === r ? T.accent : "transparent", color: fRole === r ? T.accentText : T.text, fontSize: 11, fontWeight: fRole === r ? 700 : 400, cursor: "pointer", fontFamily: T.font, transition: "all 0.12s" }}>{r}</button>)}
              </div>
              {activeFilterCount > 0 && <button onClick={() => { setFRole("All"); setFHpd("All"); setFClient("All"); setFPers([]); setFJobNum(""); setFStat("All"); setFOverloaded(false); }} style={{ width: "100%", padding: "7px 0", borderRadius: T.radiusXs, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Clear all filters</button>}
            </div>}
          </div>
        </div>}
        <div style={{ position: isAdmin ? "absolute" : "relative", left: isAdmin ? "50%" : "auto", transform: isAdmin ? "translateX(-50%)" : "none", display: "flex", gap: 12, alignItems: "center" }}>
          <Btn variant="ghost" size="sm" onClick={() => {
            if (tMode === "day") { setTStart(TD); setTEnd(TD); }
            else { const span = diffD(tStart, tEnd); const half = Math.floor(span / 2); setTStart(addD(TD, -half)); setTEnd(addD(TD, span - half)); }
          }}>Today</Btn>
          <SlidingPill
            options={["day","week","month"].map(m=>({value:m,label:m.charAt(0).toUpperCase()+m.slice(1)}))}
            value={tMode}
            onChange={m => {
              setTMode(m);
              if (m==="day") { setTStart(TD); setTEnd(TD); }
              else if (m==="week") { const d=new Date(TD+"T12:00:00"); const dow=d.getDay(); const mon=addD(TD,-(dow===0?6:dow-1)); setTStart(mon); setTEnd(addD(mon,6)); }
              else { const d=new Date(TD+"T12:00:00"); const first=new Date(d.getFullYear(),d.getMonth(),1); const last=new Date(d.getFullYear(),d.getMonth()+1,0); setTStart(toDS(first)); setTEnd(toDS(last)); }
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (tMode === "day") { setTStart(addD(tStart, -1)); setTEnd(addD(tEnd, -1)); }
              else if (tMode === "week") { setTStart(addD(tStart, -7)); setTEnd(addD(tEnd, -7)); }
              else { const d = new Date(tStart + "T12:00:00"); d.setMonth(d.getMonth() - 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setTStart(toDS(first)); setTEnd(toDS(last)); }
            }}>◀</Btn>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 180, textAlign: "center" }}>{(() => {
              const s = new Date(tStart + "T12:00:00");
              if (tMode === "day") return s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
              if (tMode === "week") { const e = new Date(tEnd + "T12:00:00"); return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`; }
              return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
            })()}</span>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (tMode === "day") { setTStart(addD(tStart, 1)); setTEnd(addD(tEnd, 1)); }
              else if (tMode === "week") { setTStart(addD(tStart, 7)); setTEnd(addD(tEnd, 7)); }
              else { const d = new Date(tStart + "T12:00:00"); d.setMonth(d.getMonth() + 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setTStart(toDS(first)); setTEnd(toDS(last)); }
            }}>▶</Btn>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {clipboard && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.accent}44`, background: T.accent + "12", fontSize: 12, color: T.accent, fontWeight: 600, maxWidth: 200 }}>
            <span style={{ lineHeight: 0, display: "flex" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/></svg></span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{clipboard.item.title}</span>
            <button onClick={() => setClipboard(null)} title="Clear clipboard" style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 14, padding: "0 0 0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>}
          {can("editJobs") && <><button onClick={() => { setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadModal(true); }} style={{ background: `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`, border: `1px solid ${T.accent}55`, borderRadius: T.radiusSm, padding: "10px 22px", cursor: "pointer", display: "flex", alignItems: "center", fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.accent, animation: "glow-pulse 2.8s ease-in-out infinite", transition: "all 0.2s", letterSpacing: "0.04em" }} onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}35, ${T.accent}1a)`; }} onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`; }}>FAST TRAQS</button><Btn onClick={() => openNew()} style={{ padding: "10px 22px", fontSize: 15 }}>+ New Task</Btn></>}
        </div>
      </div>

      {people.length === 0 && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "100px 24px", textAlign: "center", gap: 14 }}>
        <div style={{ marginBottom: 4, opacity: 0.45 }}><svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <h2 style={{ margin: 0, fontSize: 34, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>No team members yet</h2>
        <p style={{ margin: "4px auto 0", fontSize: 16, color: T.textSec, maxWidth: 400, lineHeight: 1.75 }}>
          Add your first team member to start scheduling and assigning jobs
        </p>
        {isAdmin && <Btn style={{ marginTop: 8 }} onClick={() => setPersonModal({ id: null, name: "", role: "", email: "", cap: 8, color: COLORS[Math.floor(Math.random() * COLORS.length)], teamNumber: null, isTeamLead: false, isEngineer: false, userRole: "user" })}>+ Add Member</Btn>}
      </div>}
      {/* Hourly day view */}
      {people.length > 0 && tMode === "day" && (() => {
        const HS = 5, HE = 21, NH = HE - HS; // 5am – 9pm, 16 hours
        const hours = Array.from({length: NH}, (_, i) => HS + i);
        const fmH = h => h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
        const now = new Date();
        const nowH = now.getHours() + now.getMinutes() / 60;
        const isToday = tStart === TD;
        return (
          <div ref={teamContainerRef} style={{width:"100%"}}>
            <div style={{overflow:"hidden", border:`1px solid ${T.border}`, borderRadius:T.radius, background:T.surface}}>
              <div style={{display:"flex", flexDirection:"column", width:"100%"}}>
                {/* Hour header */}
                <div style={{display:"flex", borderBottom:`2px solid ${T.border}`, height:48}}>
                  <div style={{minWidth:lW,maxWidth:lW,borderRight:`1px solid ${T.border}`,background:T.surface,height:48,display:"flex",alignItems:"center",padding:"0 16px",fontSize:12,color:T.textSec,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",flexShrink:0}}>Person</div>
                  <div style={{flex:1,display:"flex"}}>
                    {hours.map(h => { const isCurH = isToday && Math.floor(nowH) === h; return <div key={h} style={{flex:1,height:48,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:11,color:isCurH?T.accent:h<7||h>=18?T.textDim+"66":T.textDim,fontWeight:isCurH?700:400,borderRight:`1px solid ${T.bg}`,fontFamily:T.mono,background:h<7||h>=18?T.bg+"66":"transparent",gap:2}}><span style={{fontSize:11,fontWeight:isCurH?800:500}}>{fmH(h)}</span>{isCurH&&<div style={{width:4,height:4,borderRadius:2,background:T.accent}}/>}</div>; })}
                  </div>
                </div>
                {/* Rows */}
                {rowList.map(row => {
                  if (row.type === "group") {
                    const isC = tCollapsed[row.role];
                    const utilC = row.util > 60 ? "#10b981" : row.util > 30 ? "#f59e0b" : T.textDim;
                    return <div key={row.role} style={{display:"flex",height:grpH,borderBottom:`1px solid ${T.border}`,background:T.bg+"66"}}>
                      <div style={{minWidth:lW,maxWidth:lW,boxSizing:"border-box",display:"flex",alignItems:"center",gap:10,padding:"0 16px",borderRight:`1px solid ${T.border}`,background:T.bg+"cc",cursor:"pointer",flexShrink:0}} onClick={()=>setTCollapsed(p=>({...p,[row.role]:!p[row.role]}))}>
                        <span style={{fontSize:11,color:T.textSec,width:14}}>{isC?"▶":"▼"}</span>
                        <span style={{fontSize:14,fontWeight:700,color:T.text,flex:1}}>{row.role}</span>
                        <span style={{fontSize:13,fontWeight:700,color:utilC,fontFamily:T.mono}}>{row.util}%</span>
                      </div>
                      <div style={{flex:1,display:"flex"}}>
                        {hours.map(h => <div key={h} style={{flex:1,height:"100%",background:h<7||h>=18?T.bg+"cc":T.bg+"44",borderRight:`1px solid ${T.bg}33`}}/>)}
                      </div>
                    </div>;
                  }
                  const p = row.person;
                  const todayBars = row.bars.filter(b => b.type !== "eng-chip" && b.start <= tStart && b.end >= tStart);
                  const pOff = isOff(p.id, tStart);
                  const offType = pOff ? ((p.timeOff||[]).find(to=>tStart>=to.start&&tStart<=to.end)||{}).type||"PTO" : null;
                  const offR = pOff ? getOffReason(p.id, tStart) : null;
                  const offColor = offType === "UTO" ? "#f59e0b" : "#10b981";
                  // Stack bars sequentially from 7am; use startHour if manually positioned
                  let cumH = 7;
                  const barPositions = todayBars.map(bar => {
                    const hpd = bar.task?.hpd || 0;
                    const hasManual = bar.task?.startHour != null;
                    const rawS = hasManual ? bar.task.startHour : cumH;
                    const rawE = hpd > 0 ? Math.min(rawS + hpd, HE) : Math.min(rawS + 2, HE);
                    if (!hasManual) cumH = rawE;
                    return { bar, rawS, rawE, hpd };
                  });
                  const utilC = row.util > 60 ? "#10b981" : row.util > 30 ? "#f59e0b" : T.textDim;
                  const isDropTarget = dayDragTarget === p.id;
                  return <div key={p.id} style={{display:"flex",height:rH,borderBottom:`1px solid ${T.bg}55`,background:isDropTarget?T.accent+"18":"transparent",outline:isDropTarget?`2px dashed ${T.accent}88`:"none",transition:"background 0.1s"}}>
                    <div style={{minWidth:lW,maxWidth:lW,boxSizing:"border-box",display:"flex",alignItems:"center",gap:8,padding:"0 10px 0 8px",borderRight:`1px solid ${T.border}`,background:T.surface,flexShrink:0}}>
                      <div style={{width:28,height:28,borderRadius:14,background:p.color+"22",border:`1.5px solid ${p.color}55`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:p.color,flexShrink:0}}>{p.teamNumber ? String(p.teamNumber).charAt(0).toUpperCase() : p.name.charAt(0).toUpperCase()}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name.split(" ")[0]}</div>
                        <div style={{fontSize:11,color:T.textDim}}>{p.role} · {p.cap}h</div>
                      </div>
                      <span style={{fontSize:12,fontWeight:700,color:utilC,fontFamily:T.mono,flexShrink:0}}>{row.util}%</span>
                    </div>
                    <div style={{flex:1,position:"relative",display:"flex"}}>
                      {hours.map(h => <div key={h} style={{flex:1,height:"100%",background:pOff?offColor+"12":h<7||h>=18?T.bg+"55":isToday&&Math.floor(nowH)===h?T.accent+"0a":"transparent",borderRight:`1px solid ${T.bg}22`,position:"relative"}}>
                        {pOff && <div style={{position:"absolute",inset:0,background:`repeating-linear-gradient(135deg,${offColor}12,${offColor}12 4px,transparent 4px,transparent 8px)`,pointerEvents:"none"}}/>}
                        <div style={{position:"absolute",top:0,bottom:0,left:"50%",width:1,background:T.bg+"55",pointerEvents:"none"}}/>
                      </div>)}
                      {!pOff && barPositions.map(({bar, rawS, rawE, hpd}) => {
                        const visS = Math.max(rawS, HS), visE = Math.min(rawE, HE);
                        if (visE <= visS) return null;
                        const isDraggingThis = dayDragInfo?.itemId === bar.task?.id;
                        return <div key={bar.id}
                          onMouseDown={e=>{ if(e.button===0) handleTeamDayBarDrag(e, bar.task, "move", p.id, rawS, rawE); }}
                          onContextMenu={e=>bar.task&&handleCtx(e,bar.task,"team")}
                          style={{position:"absolute",top:4,left:`${(visS-HS)/NH*100}%`,width:`calc(${(visE-visS)/NH*100}% - 4px)`,height:rH-8,borderRadius:T.radiusXs,background:bar.color,cursor:isDraggingThis?"grabbing":"grab",display:"flex",alignItems:"center",padding:"0 16px",overflow:"hidden",boxShadow:isDraggingThis&&dayDragInfo?.mode==="move"?`0 0 0 2px ${bar.color}88`:`0 2px 8px ${bar.color}33`,opacity:isDraggingThis&&dayDragInfo?.mode==="move"?0.3:dayDragInfo&&!isDraggingThis?0.7:1,transition:"box-shadow 0.1s,opacity 0.1s"}}
                          onMouseEnter={e=>{ if(!dayDragInfo) e.currentTarget.style.filter="brightness(1.1)"; }} onMouseLeave={e=>e.currentTarget.style.filter="none"}>
                          <div onMouseDown={e=>{e.stopPropagation();handleTeamDayBarDrag(e,bar.task,"left",p.id);}} style={{position:"absolute",left:0,top:0,bottom:0,width:12,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5}}>
                            <div style={{width:3,height:12,borderRadius:2,background:"rgba(255,255,255,0.6)"}}/>
                          </div>
                          <span style={{fontSize:10,color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"center"}}>{hpd > 0 ? `${hpd}h · ` : ""}{bar.task?.title || bar.title}</span>
                          <div onMouseDown={e=>{e.stopPropagation();handleTeamDayBarDrag(e,bar.task,"right",p.id);}} style={{position:"absolute",right:0,top:0,bottom:0,width:12,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5}}>
                            <div style={{width:3,height:12,borderRadius:2,background:"rgba(255,255,255,0.6)"}}/>
                          </div>
                        </div>;
                      })}
                      {pOff && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                        <span style={{fontSize:12,color:offColor,fontWeight:600,background:T.surface+"cc",padding:"2px 8px",borderRadius:4}}>{offType}{offR?` · ${offR}`:""}</span>
                      </div>}
                      {isToday && nowH>=HS && nowH<=HE && <div style={{position:"absolute",top:0,bottom:0,left:`${(nowH-HS)/NH*100}%`,width:2,background:T.accent+"bb",zIndex:12,pointerEvents:"none"}}/>}
                    </div>
                  </div>;
                })}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Resource timeline grid */}
      {people.length > 0 && tMode !== "day" && <div ref={teamContainerRef} style={{ width: "100%" }}>
      <div ref={teamRef} onMouseDown={handleTeamPan} onWheel={handleTeamWheel} style={{ overflow: isMobile ? "auto" : "hidden", border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, position: "relative", cursor: "grab" }}>
        <div style={{ display: "flex", flexDirection: "column", position: "relative", width: "100%" }}>
          {/* Dual header: week groups + day numbers */}
          <div style={{ borderBottom: `2px solid ${T.border}` }}>
            <div style={{ display: "flex" }}>
              <div style={{ minWidth: lW, maxWidth: lW, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.surface, zIndex: 15, height: 28 }} />
              <div style={{ display: "flex", flex: 1 }}>{hGroups.map(g => <div key={g.key} style={{ flex: g.span, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: "0.06em", borderRight: `1px solid ${T.border}`, background: T.bg + "44" }}>{g.label}</div>)}</div>
            </div>
            <div style={{ display: "flex" }}>
              <div style={{ minWidth: lW, maxWidth: lW, height: 28, borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.surface, zIndex: 15 }} />
              <div style={{ display: "flex", flex: 1 }}>{days.map(day => { const dt = new Date(day + "T12:00:00"); const wk = [0, 6].includes(dt.getDay()); const isT = day === TD; const dayLetter = ["S","M","T","W","T","F","S"][dt.getDay()]; return <div key={day} style={{ flex: 1, height: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 12, fontFamily: T.mono, color: isT ? T.accent : wk ? T.textDim + "66" : T.textDim, fontWeight: isT ? 700 : 400, background: wk ? T.bg + "aa" : "transparent", borderRight: `1px solid ${T.bg}`, gap: 0 }}><span style={{ fontSize: 9, opacity: 0.7, lineHeight: 1 }}>{dayLetter}</span><span style={{ lineHeight: 1 }}>{dt.getDate()}</span></div>; })}</div>
            </div>
          </div>
          {/* Rows */}
          {rowList.map((row, ri) => {
            if (row.type === "group") {
              const isC = tCollapsed[row.role];
              const utilC = row.util > 60 ? "#10b981" : row.util > 30 ? "#f59e0b" : T.textDim;
              const isGroupDrop = rowDragId != null && rowDragOver?.type === "group" && rowDragOver.id === row.role;
              return <div key={row.role} data-rowtype="group" data-rowid={row.role} style={{ display: "flex", height: grpH, borderBottom: `1px solid ${T.border}`, background: isGroupDrop ? T.accent + "18" : T.bg + "66", outline: isGroupDrop ? `2px dashed ${T.accent}66` : "none", transition: "background 0.1s" }}>
                <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: isGroupDrop ? T.accent + "18" : T.bg + "cc", zIndex: 10, cursor: "pointer", transition: "background 0.1s" }} onClick={() => setTCollapsed(p => ({ ...p, [row.role]: !p[row.role] }))}>
                  <span style={{ fontSize: 11, color: T.textSec, width: 14 }}>{isC ? "▶" : "▼"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>{row.role}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: utilC, fontFamily: T.mono }}>{row.util}%</span>
                </div>
                <div style={{ flex: 1, display: "flex" }}>{days.map(day => { const wk = [0, 6].includes(new Date(day + "T12:00:00").getDay()); return <div key={day} style={{ flex: 1, height: "100%", background: wk ? T.bg + "cc" : T.bg + "44", borderRight: `1px solid ${T.bg}33` }} />; })}</div>
              </div>;
            }
            if (row.type === "subtask") {
              // Subtask row
              const sub = row.sub;
              const parentBar = row.parentBar;
              const nDays = days.length;
              const sx = (diffD(tStart, sub.start < tStart ? tStart : sub.start) / nDays * 100) + "%";
              const sw = (Math.max(diffD(sub.start < tStart ? tStart : sub.start, sub.end > tEnd ? tEnd : sub.end) + 1, 1) / nDays * 100) + "%";
              return <div key={`sub-${row.person.id}-${sub.id}`} style={{ display: "flex", height: subH, borderBottom: `1px solid ${T.bg}33`, background: T.bg + "22" }}>
                <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, padding: "0 16px 0 56px", borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: T.bg + "33", zIndex: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: sub.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.title}</span>
                </div>
                <div style={{ flex: 1, position: "relative", display: "flex" }}>
                  {days.map(day => { const wk = [0, 6].includes(new Date(day + "T12:00:00").getDay()); return <div key={day} style={{ flex: 1, height: "100%", background: wk ? T.bg + "88" : "transparent", borderRight: `1px solid ${T.bg}22` }} />; })}
                  {sub.start <= tEnd && sub.end >= tStart && <div
                    title={sub.title}
                    onContextMenu={e => handleCtx(e, { ...sub, isSub: true, pid: row.parentTaskId }, "team")}
                    onMouseDown={e => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      const startX = e.clientX; const os = sub.start, oe = sub.end; let moved = false, lastDx = 0;
                      const onM = me => { const dx = Math.round((me.clientX - startX) / cW); if (dx !== 0) moved = true; if (dx !== lastDx) { lastDx = dx; updTask(sub.id, { start: addD(os, dx), end: addD(oe, dx) }, row.parentTaskId); } };
                      const onU = () => { document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
                      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                    }}
                    style={{ position: "absolute", top: 3, left: `calc(${sx} + 2px)`, width: `calc(${sw} - 4px)`, height: subH - 6, borderRadius: 4, background: sub.color, border: `1px solid ${sub.color}`, cursor: "grab", display: "flex", alignItems: "center", padding: "0 8px", overflow: "hidden", zIndex: 4 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 5 }} onMouseDown={e => {
                      e.stopPropagation(); e.preventDefault(); const startX = e.clientX; const os = sub.start; let lastDx = 0;
                      const onM = me => { const dx = Math.round((me.clientX - startX) / cW); if (dx === lastDx) return; lastDx = dx; const ns = addD(os, dx); if (ns <= sub.end) updTask(sub.id, { start: ns }, row.parentTaskId); };
                      const onU = () => { document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
                      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                    }} />
                    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 5 }} onMouseDown={e => {
                      e.stopPropagation(); e.preventDefault(); const startX = e.clientX; const oe = sub.end; let lastDx = 0;
                      const onM = me => { const dx = Math.round((me.clientX - startX) / cW); if (dx === lastDx) return; lastDx = dx; const ne = addD(oe, dx); if (ne >= sub.start) updTask(sub.id, { end: ne }, row.parentTaskId); };
                      const onU = () => { document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
                      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                    }} />
                    <span style={{ fontSize: 10, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative", zIndex: 3, opacity: 0.9 }}>{sub.title}</span>
                  </div>}
                </div>
              </div>;
            }
            // Person row
            const p = row.person;
            const bars = row.bars;
            const utilC = row.util > 60 ? "#10b981" : row.util > 30 ? "#f59e0b" : T.textDim;
            const isDrop = dropTarget === p.id;
            const isBeingDragged = rowDragId === p.id;
            const isDragBefore = rowDragOver?.type === "person" && rowDragOver.id === p.id && rowDragOver.pos === "before";
            const isDragAfter  = rowDragOver?.type === "person" && rowDragOver.id === p.id && rowDragOver.pos === "after";
            return <div key={p.id} data-rowtype="person" data-rowid={p.id} onClick={teamSelectMode ? () => setSelPeople(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; }) : undefined} style={{ display: "flex", height: rH, borderBottom: `1px solid ${isDrop ? T.accent : T.bg + "55"}`, position: "relative", background: teamSelectMode && selPeople.has(p.id) ? T.accent + "18" : isDrop ? T.accent + "08" : "transparent", opacity: isBeingDragged ? 0.35 : 1, transition: "background 0.15s, border-color 0.15s, opacity 0.1s", cursor: teamSelectMode ? "pointer" : "default" }}>
              {/* Insertion line indicators */}
              {isDragBefore && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: T.accent, zIndex: 20, borderRadius: 1, boxShadow: `0 0 6px ${T.accent}` }} />}
              {isDragAfter  && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: T.accent, zIndex: 20, borderRadius: 1, boxShadow: `0 0 6px ${T.accent}` }} />}
              <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 8px", borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: teamSelectMode && selPeople.has(p.id) ? T.accent + "15" : isDrop ? T.accent + "0c" : T.surface, zIndex: 10, transition: "background 0.15s" }}>
                {/* Drag handle */}
                <div onMouseDown={e => startRowDrag(e, p.id)} style={{ cursor: "grab", color: T.textDim, fontSize: 14, padding: "4px 2px", flexShrink: 0, lineHeight: 1, userSelect: "none", opacity: 0.5 }} title="Drag to reorder">⠿</div>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: p.color + "22", border: `1.5px solid ${p.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: p.color, flexShrink: 0 }}>{p.teamNumber ? (isNaN(String(p.teamNumber)) ? String(p.teamNumber).charAt(0).toUpperCase() : String(p.teamNumber)) : p.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>{p.role} · {p.cap}h{p.isTeamLead ? <span style={{ color: "#10b981", marginLeft: 4 }}>★ Lead</span> : ""}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: utilC, fontFamily: T.mono, flexShrink: 0 }}>{row.util}%</span>
                {teamSelectMode && <div className="select-bubble-in" style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${selPeople.has(p.id) ? T.accent : T.border}`, background: selPeople.has(p.id) ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, pointerEvents: "none", transition: "border-color 0.15s, background 0.15s", animationDelay: `${ri * 25}ms` }}>{selPeople.has(p.id) && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5.5 4,8 8.5,2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>}
                {!teamSelectMode && can("manageTeam") && <Btn variant="ghost" size="sm" style={{ padding: "4px 6px", fontSize: 11 }} onClick={() => setPersonModal({ ...p })}>Edit</Btn>}
              </div>
              <div style={{ flex: 1, position: "relative", display: "flex" }}>
                {days.map(day => { const dt = new Date(day + "T12:00:00"); const wk = [0, 6].includes(dt.getDay()); const pOff = isOff(p.id, day); const offR = pOff ? getOffReason(p.id, day) : null; const offType = pOff ? ((p.timeOff || []).find(to => day >= to.start && day <= to.end) || {}).type || "PTO" : null; const offColor = offType === "UTO" ? "#f59e0b" : "#10b981"; return <div key={day} title={pOff ? `${offType}: ${offR}` : ""} style={{ flex: 1, height: "100%", background: pOff ? offColor + "12" : day === TD ? T.accent + "08" : wk ? T.bg + "aa" : "transparent", borderRight: `1px solid ${T.bg}33`, position: "relative" }}>{pOff && <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(135deg, ${offColor}12, ${offColor}12 4px, transparent 4px, transparent 8px)`, pointerEvents: "none" }} />}</div>; })}
                {/* Ghost: shows snapped drop position while card follows cursor */}
                {teamDragInfo && teamDragInfo.targetPersonId === p.id && (() => {
                  const { snapStart, snapEnd, hasOverlap, barColor } = teamDragInfo;
                  const nDays = days.length;
                  const snapX = (diffD(tStart, snapStart) / nDays * 100);
                  const gw = (Math.max(diffD(snapStart, snapEnd) + 1, 1) / nDays * 100) + "%";
                  const gc = hasOverlap ? "#ef4444" : barColor || T.accent;
                  return <div key="team-ghost" style={{ position: "absolute", top: 4, left: `calc(${snapX}% + 2px)`, width: `calc(${gw} - 4px)`, height: rH - 8, borderRadius: 20, border: `2px dashed ${gc}`, background: gc + "18", boxShadow: `0 0 16px ${gc}66`, pointerEvents: "none", zIndex: 35 }} />;
                })()}
                {/* Task/PTO bars */}
                {bars.map(bar => {
                  const nDays = days.length;
                  const x = (diffD(tStart, bar.start) / nDays * 100) + "%";
                  const w = (Math.max(diffD(bar.start, bar.end) + 1, 1) / nDays * 100) + "%";
                  // Engineering chip — render as compact pill, opens job detail
                  if (bar.type === "eng-chip") {
                    const chipJob = tasks.find(j => j.id === bar.jobId);
                    return <div key={bar.id}
                      onClick={() => { if (chipJob) openDetail(chipJob); }}
                      title={`${bar.panelTitle} · ${bar.activeStep}${bar.allDone ? " ✓ Done" : ""}`}
                      style={{ position: "absolute", top: 4, left: `calc(${x} + 2px)`, width: "auto", minWidth: 80, maxWidth: 160, height: rH - 8, borderRadius: 20, background: bar.allDone ? "#10b981" : "#3b82f6", border: `1.5px solid ${bar.allDone ? "#10b98166" : "#3b82f666"}`, cursor: "pointer", display: "flex", alignItems: "center", padding: "0 10px", zIndex: 4, boxShadow: `0 2px 8px ${bar.color}44`, overflow: "hidden" }}
                      onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; }} onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
                      <span style={{ fontSize: 10, color: "#fff", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bar.panelTitle}</span>
                      {!bar.allDone && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.75)", marginLeft: 4, whiteSpace: "nowrap" }}>· {bar.activeStep}</span>}
                      {bar.allDone && <span style={{ fontSize: 10, marginLeft: 4 }}>✓</span>}
                    </div>;
                  }
                  const isPto = bar.type === "pto";
                  const isExp = false;
                  const handleTeamDrag = (e) => {
                    if (!can("moveJobs")) { if (!isPto && bar.task) openDetail(bar.task); return; }
                    if (isPto) {
                      // PTO drag
                      e.preventDefault();
                      const sx = e.clientX;
                      const pid = bar.personId, idx = bar.toIdx;
                      const pp = people.find(x => x.id === pid);
                      if (!pp) return;
                      const pto = (pp.timeOff || [])[idx];
                      if (!pto) return;
                      const os = pto.start, oe = pto.end;
                      let moved = false, lastDx = 0;
                      const onM = me => {
                        const rawDx = (me.clientX - sx) / cW;
                        const dx = rawDx >= 0 ? Math.floor(rawDx) : Math.ceil(rawDx);
                        if (Math.abs(dx) > 0) moved = true;
                        if (dx !== lastDx) { lastDx = dx; updTimeOff(pid, idx, { start: addD(os, dx), end: addD(oe, dx) }); }
                      };
                      const onU = () => { document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
                      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                      return;
                    }
                    if (!bar.task) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const sx = e.clientX, sy = e.clientY;
                    const os = bar.task.start, oe = bar.task.end;
                    const taskPid = bar.task.pid || null;
                    const origPerson = p.id;
                    let moved = false, lastDropPid = null;
                    const gridEl = teamRef.current;
                    // Measure actual rendered column width from the grid area div so drop
                    // snaps to exactly where the bar visually is, regardless of cW state lag.
                    const gridAreaEl = e.currentTarget?.parentElement;
                    const liveCW = gridAreaEl ? gridAreaEl.getBoundingClientRect().width / days.length : cW;
                    const onM = me => {
                      const pxDx = me.clientX - sx;
                      const pxDy = me.clientY - sy;
                      if (Math.abs(pxDx) > 2 || Math.abs(pxDy) > 8) moved = true;
                      // Detect target row for reassign
                      if (gridEl) {
                        const personRows = gridEl.querySelectorAll("[data-rowtype='person']");
                        let found = null;
                        personRows.forEach(el => {
                          const rect = el.getBoundingClientRect();
                          if (me.clientY >= rect.top && me.clientY <= rect.bottom) found = el.getAttribute("data-rowid");
                        });
                        if (found !== null) { const pObj = people.find(x => String(x.id) === found); if (pObj) found = pObj.id; }
                        if (found !== lastDropPid) { lastDropPid = found; setDropTarget(found); }
                      }
                      // Use live-measured column width so overlap preview matches actual render
                      const dx = Math.round(pxDx / liveCW);
                      const snapS = addD(os, dx);
                      const snapE = addD(oe, dx);
                      const targetPid = lastDropPid || origPerson;
                      const movingTaskId = bar.task?.id;
                      const newHpd = (bar.task?.hpd || 7.5) / Math.max(1, (bar.task?.team || []).length);
                      const personCap = (people.find(x => x.id === targetPid) || {}).cap || 8;
                      let hasOverlap = false;
                      let chk = snapS;
                      while (chk <= snapE) {
                        let dayH = 0;
                        for (const job of tasks) {
                          for (const panel of (job.subs || [])) {
                            for (const op of (panel.subs || [])) {
                              if (op.id === movingTaskId || op.status === "Finished") continue;
                              if (!(op.team || []).includes(targetPid)) continue;
                              if (chk >= op.start && chk <= op.end)
                                dayH += (op.hpd || 7.5) / Math.max(1, op.team.length);
                            }
                          }
                        }
                        if (dayH + newHpd > personCap) { hasOverlap = true; break; }
                        chk = addD(chk, 1);
                      }
                      setTeamDragInfo({ barId: bar.id, snapStart: snapS, snapEnd: snapE, origStart: os, origEnd: oe, targetPersonId: targetPid, hasOverlap, cursorX: me.clientX, cursorY: me.clientY, taskTitle: bar.task?.title || "", barColor: bar.color || T.accent, translateX: pxDx, translateY: pxDy });
                    };
                    const onU = me => {
                      document.removeEventListener("mousemove", onM);
                      document.removeEventListener("mouseup", onU);
                      setDropTarget(null); setTeamDragInfo(null);
                      if (!moved) { if (bar.task) openDetail(bar.task); return; }
                      const finalDx = Math.round((me.clientX - sx) / liveCW);
                      const newStart = addD(os, finalDx);
                      const newEnd = addD(oe, finalDx);
                      const dropPerson = lastDropPid || origPerson;
                      const dropConflicts = checkOverlapsPure(tasks, [{ personId: dropPerson, start: newStart, end: newEnd, excludeOpId: bar.task.id, hpd: bar.task?.hpd, teamLength: (bar.task?.team || []).length, opTitle: bar.task?.title, panelTitle: bar.task?.panelTitle }]);
                      if (showOverlapIfAny(dropConflicts)) return;
                      updTask(bar.task.id, { start: newStart, end: newEnd }, taskPid);
                      // Expand visible range if needed (functional update = always reads current state)
                      setTStart(prev => newStart < prev ? newStart : prev);
                      setTEnd(prev => newEnd > prev ? newEnd : prev);
                      // Handle reassign to different person
                      const isReassign = !!(lastDropPid && lastDropPid !== origPerson);
                      if (isReassign) reassignTask(bar.task.id, origPerson, lastDropPid, taskPid);
                    };
                    document.addEventListener("mousemove", onM);
                    document.addEventListener("mouseup", onU);
                  };
                  const handleTeamResize = (e, side) => {
                    if (!can("moveJobs")) return;
                    if (isPto) {
                      e.preventDefault(); e.stopPropagation();
                      const sx = e.clientX;
                      const pid = bar.personId, idx = bar.toIdx;
                      const pp = people.find(x => x.id === pid);
                      if (!pp) return;
                      const pto = (pp.timeOff || [])[idx];
                      if (!pto) return;
                      const os = pto.start, oe = pto.end; let lastDx = 0;
                      const onM = me => {
                        const rawDx2 = (me.clientX - sx) / cW;
                        const dx = rawDx2 >= 0 ? Math.floor(rawDx2) : Math.ceil(rawDx2);
                        if (dx === lastDx) return; lastDx = dx;
                        if (side === "left") { const ns = addD(os, dx); if (ns <= oe) updTimeOff(pid, idx, { start: ns }); }
                        else { const ne = addD(oe, dx); if (ne >= os) updTimeOff(pid, idx, { end: ne }); }
                      };
                      const onU = () => { document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
                      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                      return;
                    }
                    if (!bar.task) return;
                    e.preventDefault(); e.stopPropagation();
                    const sx = e.clientX, os = bar.task.start, oe = bar.task.end; let lastDx = 0;
                    const taskPid2 = bar.task.pid || null;
                    const onM = me => {
                      const rawDx3 = (me.clientX - sx) / cW;
                      const dx = rawDx3 >= 0 ? Math.floor(rawDx3) : Math.ceil(rawDx3);
                      if (dx === lastDx) return; lastDx = dx;
                      if (side === "left") { const ns = addD(os, dx); if (ns <= oe) updTask(bar.task.id, { start: ns }, taskPid2); }
                      else { const ne = addD(oe, dx); if (ne >= os) updTask(bar.task.id, { end: ne }, taskPid2); }
                    };
                    const onU = () => {
                      document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU);
                      const personId = bar.task.team[0];
                      if (!personId) return;
                      const newStart = side === "left" ? nextBD(addD(os, lastDx)) : os;
                      const newEnd = side === "right" ? nextBD(addD(oe, lastDx)) : oe;
                      const movedByName = loggedInUser ? loggedInUser.name : "Admin";
                      setTasks(prev => {
                        let reverted = prev.map(t => {
                          if (taskPid2) {
                            const pi2 = (t.subs || []).findIndex(s => s.id === taskPid2);
                            if (pi2 >= 0) { const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => op.id === bar.task.id ? { ...op, start: os, end: oe } : op) }; return { ...t, subs: ns }; }
                          }
                          return t;
                        });
                        let isLocked = false;
                        reverted.forEach(j => (j.subs || []).forEach(pnl => (pnl.subs || []).forEach(op => { if (op.id === bar.task.id && op.locked) isLocked = true; })));
                        if (isLocked) { setTimeout(() => showLockedError([{ opTitle: bar.task.title, panelTitle: bar.task.panelTitle || "" }]), 0); return reverted; }
                        const applyResize = (tl) => tl.map(t => {
                          if (taskPid2) {
                            const pi2 = (t.subs || []).findIndex(s => s.id === taskPid2);
                            if (pi2 >= 0) { const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => {
                              if (op.id === bar.task.id) {
                                const logEntry = { fromStart: os, fromEnd: oe, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Manual resize" };
                                return { ...op, start: newStart, end: newEnd, moveLog: [...(op.moveLog || []), logEntry] };
                              }
                              return op;
                            }) }; return { ...t, subs: ns }; }
                          }
                          return t;
                        });
                        const { pushes, blocked, lockedOps } = previewPush(reverted, bar.task.id, personId, newStart, newEnd);
                        if (blocked) { setTimeout(() => showLockedError(lockedOps), 0); return reverted; }
                        if (pushes.length > 0) {
                          const revertedSnapshot = JSON.parse(JSON.stringify(reverted));
                          const finalState = applyPushes(applyResize(reverted), pushes, movedByName);
                          const finalStateSingle = recalcBounds(applyResize(reverted), movedByName);
                          setTimeout(() => {
                            setConfirmPush({
                              pushes, people,
                              onConfirm: () => { setTasks(finalState); setConfirmPush(null); },
                              onConfirmSingle: () => { setTasks(finalStateSingle); setConfirmPush(null); },
                              onCancel: () => { setTasks(revertedSnapshot); setConfirmPush(null); },
                            });
                          }, 0);
                          return reverted;
                        }
                        return recalcBounds(applyResize(reverted), movedByName);
                      });
                    };
                    document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
                  };
                  const barLocked = !isPto && bar.task && bar.task.locked;
                  const hasMoveLog = !isPto && bar.task && (bar.task.moveLog || []).length > 0;
                  const bc = bar.color;
                  const isDraggingThis = teamDragInfo?.barId === bar.id;
                  const dragTx = isDraggingThis ? (teamDragInfo.translateX || 0) : 0;
                  const dragTy = isDraggingThis ? (teamDragInfo.translateY || 0) : 0;
                  const dragOverlap = isDraggingThis && teamDragInfo.hasOverlap;
                  return <div key={bar.id} title={bar.title + (bar.clientName ? ` (${bar.clientName})` : "") + (barLocked ? " 🔒 Locked" : "") + (hasMoveLog ? " 📋 Has schedule changes" : "")}
                    onMouseDown={e => { if (e.button === 0) { e.stopPropagation(); handleTeamDrag(e); } }}
                    onContextMenu={e => { if (isPto && can("manageTeam")) { e.preventDefault(); setPtoCtx({ x: e.clientX, y: e.clientY, bar, personId: bar.personId, toIdx: bar.toIdx }); } else if (!isPto && bar.task) handleCtx(e, bar.task, "team"); }}
                    style={{ position: "absolute", top: 4, left: `calc(${x} + 2px)`, width: `calc(${w} - 4px)`, height: rH - 8, borderRadius: T.radiusXs, background: isPto ? `repeating-linear-gradient(135deg, ${bc}33, ${bc}33 4px, ${bc}18 4px, ${bc}18 8px)` : bc, border: dragOverlap ? `2px solid #ef4444` : barLocked ? `2px solid rgba(255,255,255,0.7)` : `1.5px solid ${isPto ? bc + "55" : bc}`, cursor: isPto ? (can("manageTeam") ? "grab" : "default") : barLocked ? "not-allowed" : can("moveJobs") ? "grab" : "pointer", display: "flex", alignItems: "center", padding: "0 12px", overflow: "hidden", zIndex: isDraggingThis ? 40 : isPto ? 3 : 4, transform: (dragTx || dragTy) ? `translateX(${dragTx}px) translateY(${dragTy}px)` : undefined, boxShadow: isDraggingThis ? (dragOverlap ? `0 0 24px #ef444488, 0 4px 16px #ef444444` : `0 0 24px ${bc}88, 0 4px 16px ${bc}44`) : barLocked ? `0 0 8px rgba(255,255,255,0.15)` : isExp ? `0 2px 8px ${bc}44` : "none" }}
                    onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; }} onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
                    {can("moveJobs") && !barLocked && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleTeamResize(e, "left"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 14, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                    {can("moveJobs") && !barLocked && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleTeamResize(e, "right"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 14, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                    {barLocked && <span style={{ marginRight: 4, flexShrink: 0, position: "relative", zIndex: 3, opacity: 0.9, lineHeight: 0 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>}
                    {hasMoveLog && <span style={{ width: 6, height: 6, borderRadius: 3, background: "#f59e0b", flexShrink: 0, position: "relative", zIndex: 3, boxShadow: "0 0 4px #f59e0b66" }} title="Schedule was changed" />}
                    <span style={{ fontSize: 11, color: isPto ? bar.color : "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative", zIndex: 3, flex: 1 }}>{isPto ? `${bar.ptoType === "UTO" ? "📋" : "🏖️"} ${bar.title}` : `${bar.task?.title || bar.title} - ${p.name.split(" ")[0]}`}</span>
                    {!isPto && bar.task?.hpd > 0 && <span style={{ flexShrink: 0, marginLeft: 6, fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.85)", fontFamily: T.mono }}>{bar.task.hpd}h</span>}
                  </div>;
                })}
              </div>
            </div>;
          })}
          {/* Today line */}
          {TD >= tStart && TD <= tEnd && <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${lW}px + (100% - ${lW}px) * ${(diffD(tStart, TD) + 0.5) / days.length})`, width: 2, background: T.accent + "bb", zIndex: 12, pointerEvents: "none" }} />}
        </div>
      </div>
      </div>}
    {teamDragInfo && teamDragInfo.taskTitle && <div style={{ position: "fixed", left: teamDragInfo.cursorX + 16, top: teamDragInfo.cursorY - 36, background: "rgba(10,10,20,0.92)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8, pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", border: `1px solid ${T.accent}66`, backdropFilter: "blur(4px)" }}>{teamDragInfo.taskTitle}</div>}
    </div>;
  };
  const renderAnalytics = () => { const tot = tasks.length; const bySt = STATUSES.map(s => ({ n: s, c: tasks.filter(t => t.status === s).length })); const byPr = PRIORITIES.map(p => ({ n: p, c: tasks.filter(t => t.pri === p).length })); const cr = tot ? Math.round(tasks.filter(t => t.status === "Finished").length / tot * 100) : 0; const tl = people.map(p => ({ n: p.name.split(" ")[0], h: bookedHrs(p.id, TD), cap: p.cap })).sort((a, b) => b.h - a.h).slice(0, 12); const mx = Math.max(...tl.map(t => Math.max(t.h, t.cap)), 1);
    return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
      <Card delay={0}><h4 style={{ color: T.textSec, margin: "0 0 20px", fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Completion Rate</h4><div style={{ fontSize: 64, fontWeight: 700, color: "#10b981", textAlign: "center", fontFamily: T.mono, lineHeight: 1.1 }}>{cr}%</div><div style={{ textAlign: "center", fontSize: 15, color: T.textSec, marginTop: 8 }}>{tasks.filter(t => t.status === "Finished").length} of {tot} tasks</div></Card>
      <Card delay={50}><h4 style={{ color: T.textSec, margin: "0 0 20px", fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>By Status</h4>{bySt.map(s => <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={{ width: 12, height: 12, borderRadius: 6, background: STA_C[s.n] }} /><span style={{ flex: 1, fontSize: 15, color: T.textSec }}>{s.n}</span><span style={{ fontSize: 18, color: T.text, fontWeight: 700, fontFamily: T.mono }}>{s.c}</span></div>)}</Card>
      <Card delay={100}><h4 style={{ color: T.textSec, margin: "0 0 20px", fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>By Priority</h4>{byPr.map(p => <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={{ width: 12, height: 12, borderRadius: 6, background: PRI_C[p.n] }} /><span style={{ flex: 1, fontSize: 15, color: T.textSec }}>{p.n}</span><span style={{ fontSize: 18, color: T.text, fontWeight: 700, fontFamily: T.mono }}>{p.c}</span></div>)}</Card>
      <Card delay={150} style={{ gridColumn: "1 / -1" }}><h4 style={{ color: T.textSec, margin: "0 0 20px", fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Team Workload Today</h4><div style={{ display: "flex", alignItems: "end", gap: 8, height: 180, padding: "0 8px" }}>{tl.map(t => <div key={t.n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}><span style={{ fontSize: 12, fontFamily: T.mono, color: t.h > t.cap ? T.danger : T.textSec, fontWeight: 600 }}>{t.h.toFixed(1)}</span><div style={{ width: "100%", background: T.bg, borderRadius: 4, position: "relative", height: Math.max((Math.max(t.h, t.cap) / mx) * 130, 6) }}><div style={{ position: "absolute", bottom: 0, width: "100%", borderRadius: 4, background: t.h > t.cap ? T.danger : t.h / t.cap > 0.7 ? "#f59e0b" : T.accent, height: Math.max((t.h / mx) * 130, 3) }} /></div><span style={{ fontSize: 11, color: T.textDim, textAlign: "center", fontWeight: 500 }}>{t.n}</span></div>)}</div></Card>
    </div>; };

  // ═══════════════════ CALENDAR ═══════════════════
  const [calM, setCalM] = useState(NOW.getMonth()); const [calY, setCalY] = useState(NOW.getFullYear());
  const [mobileSelDay, setMobileSelDay] = useState(TD);
  const [mobileExp, setMobileExp] = useState({});

  const renderMobileCal = () => {
    const fd = new Date(calY, calM, 1).getDay();
    const dim = new Date(calY, calM + 1, 0).getDate();
    const cells = []; for (let i = 0; i < fd; i++) cells.push(null); for (let i = 1; i <= dim; i++) cells.push(i);
    const selDS = mobileSelDay;
    const dayParents = tasks.filter(t => selDS >= t.start && selDS <= t.end);
    const selDt = new Date(selDS + "T12:00:00");
    const dayLabel = selDt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    return <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Month nav */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: "12px 0 8px" }}>
        <button onClick={() => { if (calM === 0) { setCalM(11); setCalY(y => y - 1); } else setCalM(m => m - 1); }} style={{ background: "none", border: "none", fontSize: 18, color: T.textSec, cursor: "pointer", padding: "4px 12px" }}>◀</button>
        <span style={{ color: T.text, fontWeight: 700, fontSize: 18, minWidth: 180, textAlign: "center" }}>{new Date(calY, calM).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
        <button onClick={() => { if (calM === 11) { setCalM(0); setCalY(y => y + 1); } else setCalM(m => m + 1); }} style={{ background: "none", border: "none", fontSize: 18, color: T.textSec, cursor: "pointer", padding: "4px 12px" }}>▶</button>
      </div>
      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 4px" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, color: T.textDim, padding: "6px 0", fontWeight: 600 }}>{d}</div>)}
      </div>
      {/* Month grid - compact */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, padding: "0 4px", marginBottom: 8 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const ds = toDS(new Date(calY, calM, day));
          const isT = ds === TD;
          const isSel = ds === selDS;
          const hasTasks = allItems.some(t => ds >= t.start && ds <= t.end);
          return <div key={i} onClick={() => setMobileSelDay(ds)} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0", cursor: "pointer", borderRadius: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 17, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: isT || isSel ? 700 : 400, color: isSel ? T.accentText : isT ? T.accent : T.text, background: isSel ? T.accent : isT ? T.accent + "15" : "transparent", transition: "all 0.15s" }}>{day}</div>
            {hasTasks && !isSel && <div style={{ width: 5, height: 5, borderRadius: 3, background: T.accent, marginTop: 2 }} />}
            {!hasTasks && <div style={{ width: 5, height: 5, marginTop: 2 }} />}
          </div>;
        })}
      </div>
      {/* Selected day header */}
      <div style={{ padding: "10px 16px 6px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{dayLabel}</span>
        {can("editJobs") && <button onClick={() => openNew()} style={{ height: 36, display: "flex", alignItems: "center", padding: "0 14px", background: T.accent, border: "none", color: T.accentText, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, flexShrink: 0, whiteSpace: "nowrap" }}>+ New</button>}
      </div>
      {/* Day schedule */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 8px 16px" }}>
        {dayParents.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: T.textDim, fontSize: 14 }}>No tasks scheduled</div>}
        {dayParents.map(t => {
          const owner = people.find(p => p.id === (t.team || [])[0]);
          const cl = t.clientId ? clients.find(c => c.id === t.clientId) : null;
          const subs = (t.subs || []).filter(s => selDS >= s.start && selDS <= s.end);
          const hasSubs = (t.subs || []).length > 0;
          const isExp = mobileExp[t.id];
          return <div key={t.id} style={{ marginBottom: 6 }}>
            <div onClick={() => { if (hasSubs) { setMobileExp(p => ({ ...p, [t.id]: !p[t.id] })); } else { openDetail(t); } }} style={{ display: "flex", gap: 12, padding: "12px 14px", background: T.card, borderRadius: isExp ? `${T.radiusSm}px ${T.radiusSm}px 0 0` : T.radiusSm, border: `1px solid ${T.border}`, borderBottom: isExp ? "none" : `1px solid ${T.border}`, cursor: "pointer", alignItems: "center" }}>
              <div style={{ width: 4, height: 40, borderRadius: 2, background: owner ? owner.color : T.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {hasSubs && <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>{isExp ? "▼" : "▶"}</span>}
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {owner && <span>{owner.name}</span>}
                  {cl && <span>· {cl.name}</span>}
                  <span>· {fm(t.start)} → {fm(t.end)}</span>
                </div>
                {hasSubs && <div style={{ fontSize: 11, color: T.accent, marginTop: 3 }}>{t.subs.length} subtask{t.subs.length > 1 ? "s" : ""}{subs.length < t.subs.length ? ` (${subs.length} today)` : ""}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <HealthIcon t={t} size={10} />
                {!hasSubs && <span style={{ fontSize: 10, color: T.textDim }}>view</span>}
              </div>
            </div>
            {/* Expanded subtasks */}
            {isExp && <div style={{ background: T.bg + "88", border: `1px solid ${T.border}`, borderTop: "none", borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`, padding: "4px 0" }}>
              {(t.subs || []).map(s => {
                const isActive = selDS >= s.start && selDS <= s.end;
                return <div key={s.id} onClick={() => openDetail(s)} style={{ display: "flex", gap: 10, padding: "10px 14px 10px 32px", cursor: "pointer", alignItems: "center", opacity: isActive ? 1 : 0.45 }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: owner ? owner.color : T.accent, flexShrink: 0, opacity: isActive ? 1 : 0.5 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: isActive ? T.text : T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{fm(s.start)} → {fm(s.end)}{!isActive ? " · not today" : ""}</div>
                  </div>
                  <HealthIcon t={s} size={8} />
                </div>;
              })}
              <div onClick={() => openDetail(t)} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 14px", cursor: "pointer", gap: 6 }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>View Full Project</span>
              </div>
            </div>}
          </div>;
        })}
      </div>
    </div>;
  };

  const renderMyTasks = () => {
    const curPerson = people.find(p => p.id === currentUser);
    // Get parent tasks assigned to current user
    const myParents = tasks.filter(t => (t.team || []).includes(currentUser));
    const todayTasks = myParents.filter(t => TD >= t.start && TD <= t.end);
    const upcoming = myParents.filter(t => t.start > TD).sort((a, b) => a.start.localeCompare(b.start));
    const overdue = myParents.filter(t => t.end < TD && t.status !== "Finished");

    const renderTaskCard = (t, opts = {}) => {
      const cl = t.clientId ? clients.find(c => c.id === t.clientId) : null;
      const hasSubs = (t.subs || []).length > 0;
      const isExp = mobileExp["my_" + t.id];
      const cardBg = opts.bg || T.card;
      const cardBorder = opts.border || T.border;
      return <div key={t.id} style={{ marginBottom: 6 }}>
        <div onClick={() => { if (hasSubs) { setMobileExp(p => ({ ...p, ["my_" + t.id]: !p["my_" + t.id] })); } else { openDetail(t); } }} style={{ display: "flex", gap: 12, padding: "12px 14px", background: cardBg, borderRadius: isExp ? `${T.radiusSm}px ${T.radiusSm}px 0 0` : T.radiusSm, border: `1px solid ${cardBorder}`, borderBottom: isExp ? "none" : `1px solid ${cardBorder}`, cursor: "pointer", alignItems: "center" }}>
          <div style={{ width: 4, height: 40, borderRadius: 2, background: opts.barColor || (curPerson ? curPerson.color : T.accent), flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {hasSubs && <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>{isExp ? "▼" : "▶"}</span>}
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
            </div>
            <div style={{ fontSize: 12, color: opts.dateColor || T.textDim, marginTop: 2 }}>{opts.prefix || ""}{cl ? cl.name + " · " : ""}{fm(t.start)} → {fm(t.end)}</div>
            {hasSubs && <div style={{ fontSize: 11, color: T.accent, marginTop: 3 }}>{t.subs.length} subtask{t.subs.length > 1 ? "s" : ""}</div>}
          </div>
          <HealthIcon t={t} size={10} />
        </div>
        {isExp && <div style={{ background: T.bg + "88", border: `1px solid ${cardBorder}`, borderTop: "none", borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`, padding: "4px 0" }}>
          {(t.subs || []).map(s => <div key={s.id} onClick={() => openDetail(s)} style={{ display: "flex", gap: 10, padding: "10px 14px 10px 32px", cursor: "pointer", alignItems: "center" }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: curPerson ? curPerson.color : T.accent, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{fm(s.start)} → {fm(s.end)}</div>
            </div>
            <HealthIcon t={s} size={8} />
          </div>)}
          <div onClick={() => openDetail(t)} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 14px", cursor: "pointer" }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>View Full Project</span>
          </div>
        </div>}
      </div>;
    };

    return <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
      <div style={{ padding: "12px 12px 6px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Today · {todayTasks.length} job{todayTasks.length !== 1 ? "s" : ""}</div>
        {todayTasks.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", color: T.textDim, fontSize: 13 }}>Nothing scheduled today</div>}
        {todayTasks.map(t => renderTaskCard(t))}
      </div>
      {overdue.length > 0 && <div style={{ padding: "8px 12px 6px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.danger, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Overdue · {overdue.length}</div>
        {overdue.map(t => renderTaskCard(t, { bg: T.danger + "08", border: T.danger + "22", barColor: T.danger, dateColor: T.danger, prefix: "Due " }))}
      </div>}
      {upcoming.length > 0 && <div style={{ padding: "8px 12px 6px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Upcoming · {upcoming.length}</div>
        {upcoming.slice(0, 20).map(t => renderTaskCard(t))}
      </div>}
    </div>;
  };

  const renderMobileApp = () => {
    const mobileView = view === "schedule" ? "home" : view;

    const renderMobileHome = () => <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Toggle + New Task row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", flexShrink: 0 }}>
        <SlidingPill
          options={[{value:"mytasks",label:"My Tasks"},{value:"viewall",label:"View All"}]}
          value={mobileTab}
          onChange={setMobileTab}
        />
        {can("editJobs") && <button onClick={() => openNew()} style={{ height: 36, display: "flex", alignItems: "center", padding: "0 14px", background: T.accent, border: "none", color: T.accentText, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, flexShrink: 0, whiteSpace: "nowrap" }}>+ New</button>}
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", paddingBottom: 88 }}>
        {mobileTab === "viewall" ? renderMobileCal() : renderMyTasks()}
      </div>
    </div>;

    const renderMobileTaskRow = (t) => {
      const owner = people.find(p => p.id === (t.team || [])[0]);
      const cl = t.clientId ? clients.find(c => c.id === t.clientId) : null;
      const hasSubs = (t.subs || []).length > 0;
      const isExp = mobileExp["t_" + t.id];
      return <div key={t.id} style={{ marginBottom: 6 }}>
        <div onClick={() => { if (hasSubs) setMobileExp(p => ({ ...p, ["t_" + t.id]: !p["t_" + t.id] })); else openDetail(t); }} style={{ display: "flex", gap: 10, padding: "11px 12px", background: T.card, borderRadius: isExp ? `${T.radiusSm}px ${T.radiusSm}px 0 0` : T.radiusSm, border: `1px solid ${T.border}`, borderBottom: isExp ? "none" : undefined, cursor: "pointer", alignItems: "flex-start" }}>
          <div style={{ width: 4, alignSelf: "stretch", minHeight: 36, borderRadius: 2, background: t.color || (owner ? owner.color : T.accent), flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              {hasSubs && <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>{isExp ? "▼" : "▶"}</span>}
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{t.title}</span>
              <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: (STA_C[t.status] || T.accent) + "22", color: STA_C[t.status] || T.accent, fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>{t.status}</span>
            </div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {owner && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 6, height: 6, borderRadius: 3, background: owner.color, flexShrink: 0 }} />{owner.name}</span>}
              {cl && <span>· {cl.name}</span>}
              <span style={{ fontFamily: T.mono }}>{fm(t.start)} → {fm(t.end)}</span>
            </div>
            {hasSubs && <div style={{ fontSize: 11, color: T.accent, marginTop: 2 }}>{t.subs.length} subtask{t.subs.length > 1 ? "s" : ""}</div>}
          </div>
          {can("editJobs") && <div style={{ display: "flex", gap: 5, flexShrink: 0, alignItems: "center", paddingTop: 2 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => openEdit(t)} style={{ background: T.accent + "18", border: "none", borderRadius: 6, padding: "5px 9px", fontSize: 11, color: T.accent, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Edit</button>
            <button onClick={() => setConfirmDelete({ title: t.title, id: t.id, pid: null })} style={{ background: T.danger + "18", border: "none", borderRadius: 6, padding: "5px 7px", fontSize: 11, color: T.danger, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✕</button>
          </div>}
        </div>
        {isExp && <div style={{ background: T.bg + "88", border: `1px solid ${T.border}`, borderTop: "none", borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`, padding: "4px 0" }}>
          {(t.subs || []).map(s => <div key={s.id} onClick={() => openDetail(s)} style={{ display: "flex", gap: 10, padding: "10px 14px 10px 30px", cursor: "pointer", alignItems: "center" }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 7, height: 7, borderRadius: 4, background: owner ? owner.color : T.accent, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{fm(s.start)} → {fm(s.end)}</div>
            </div>
            <HealthIcon t={s} size={8} />
          </div>)}
          <div onClick={() => openDetail(t)} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 14px", cursor: "pointer" }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>View Full Project</span>
          </div>
        </div>}
      </div>;
    };

    const renderMobileTasks = () => {
      const active = filtered.filter(t => t.status !== "Finished");
      const finished = filtered.filter(t => t.status === "Finished");
      const mobileEngOpen = mobileExp["eng_queue"];
      return <div style={{ padding: "8px 12px 88px", overflow: "auto", flex: 1 }}>
        {/* Engineering Queue */}
        {engQueueItems.length > 0 && <div style={{ marginBottom: 12 }}>
          <div onClick={() => setMobileExp(p => ({ ...p, eng_queue: !p.eng_queue }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: `${T.accent}15`, borderRadius: T.radiusSm, border: `1px solid ${T.accent}30`, cursor: "pointer", marginBottom: mobileEngOpen ? 6 : 0 }}>
            <span style={{ fontSize: 14 }}>🔧</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.accent, flex: 1 }}>Engineering Queue</span>
            <span style={{ fontSize: 12, color: T.accent, fontWeight: 700, background: `${T.accent}20`, borderRadius: 10, padding: "1px 8px" }}>{engQueueItems.length}</span>
            <span style={{ fontSize: 11, color: T.textDim, marginLeft: 4 }}>{mobileEngOpen ? "▲" : "▼"}</span>
          </div>
          {mobileEngOpen && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {engQueueItems.map(({ job, panel }) => {
              const e = panel.engineering || {};
              const activeStep = !e.designed ? "designed" : !e.verified ? "verified" : "sentToPerforex";
              return <div key={panel.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.accent}`, borderRadius: T.radiusSm, padding: "11px 13px" }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 3, fontFamily: T.mono }}>{job.jobNumber ? `#${job.jobNumber} · ` : ""}{job.title}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>{panel.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {engSteps.map(step => {
                    const done = !!e[step.key];
                    const isActive = step.key === activeStep;
                    if (done) return <span key={step.key} style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>✓ {step.label}{canSignOffEngineering && <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Revert" style={{ marginLeft: 2, padding: "1px 5px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 9, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>}</span>;
                    if (isActive && canSignOffEngineering) return <button key={step.key} onClick={() => signOffEngineering(job.id, panel.id, step.key)} style={{ padding: "5px 13px", borderRadius: 14, background: T.accent, color: T.accentText, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>;
                    if (isActive) return <span key={step.key} style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>→ {step.label}</span>;
                    return <span key={step.key} style={{ fontSize: 11, color: T.textDim, opacity: 0.5 }}>○ {step.label}</span>;
                  })}
                </div>
              </div>;
            })}
          </div>}
        </div>}
        {/* Active jobs */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "4px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active · {active.length}</div>
          {can("editJobs") && <button onClick={() => openNew()} style={{ height: 36, display: "flex", alignItems: "center", padding: "0 14px", background: T.accent, border: "none", color: T.accentText, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, flexShrink: 0, whiteSpace: "nowrap" }}>+ New Task</button>}
        </div>
        {active.map(t => renderMobileTaskRow(t))}
        {finished.length > 0 && <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 16, marginBottom: 8, padding: "4px 0" }}>Finished · {finished.length}</div>
          {finished.map(t => <div key={t.id} style={{ display: "flex", gap: 10, padding: "10px 12px", marginBottom: 4, background: T.card, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, alignItems: "center", opacity: 0.65 }}>
            <div onClick={() => openDetail(t)} style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0, cursor: "pointer" }}>
              <span style={{ fontSize: 14 }}>✅</span>
              <span style={{ flex: 1, fontSize: 14, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
              <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, flexShrink: 0 }}>{fm(t.end)}</span>
            </div>
            {can("editJobs") && <button onClick={() => setConfirmDelete({ title: t.title, id: t.id, pid: null })} style={{ background: T.danger + "18", border: "none", borderRadius: 6, padding: "5px 7px", fontSize: 11, color: T.danger, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>✕</button>}
          </div>)}
        </>}
      </div>;
    };

    const renderMobileClients = () => <div style={{ padding: "8px 12px 88px", overflow: "auto", flex: 1 }}>
      {can("editJobs") && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button onClick={() => setClientModal({ id: null, name: "", contact: "", email: "", phone: "", notes: "", color: COLORS[Math.floor(Math.random() * COLORS.length)] })} style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Add Client</button>
      </div>}
      {clients.map(c => {
        const cTasks = tasks.filter(t => t.clientId === c.id);
        const active = cTasks.filter(t => t.status !== "Finished").length;
        const isExp = mobileExp["c_" + c.id];
        return <div key={c.id} style={{ marginBottom: 6 }}>
          <div onClick={() => setMobileExp(p => ({ ...p, ["c_" + c.id]: !p["c_" + c.id] }))} style={{ display: "flex", gap: 12, padding: "13px 14px", background: T.card, borderRadius: isExp ? `${T.radiusSm}px ${T.radiusSm}px 0 0` : T.radiusSm, border: `1px solid ${T.border}`, borderBottom: isExp ? "none" : undefined, cursor: "pointer", alignItems: "center" }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: c.color, flexShrink: 0, boxShadow: `0 0 6px ${c.color}66` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{c.name}</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{c.contact || "No contact"}{c.email ? " · " + c.email : ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginRight: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{cTasks.length}</div>
              <div style={{ fontSize: 10, color: active > 0 ? T.accent : T.textDim }}>{active} active</div>
            </div>
            <span style={{ fontSize: 12, color: T.textDim }}>{isExp ? "▲" : "▼"}</span>
          </div>
          {isExp && <div style={{ background: T.bg + "88", border: `1px solid ${T.border}`, borderTop: "none", borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`, padding: "12px 14px" }}>
            {c.contact && <div style={{ fontSize: 13, color: T.textSec, marginBottom: 4 }}>👤 {c.contact}</div>}
            {c.email && <div style={{ fontSize: 13, color: T.textSec, marginBottom: 4 }}>✉ {c.email}</div>}
            {c.phone && <div style={{ fontSize: 13, color: T.textSec, marginBottom: 8 }}>📞 {c.phone}</div>}
            {can("editJobs") && <button onClick={() => setClientModal({ ...c })} style={{ background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 8, padding: "6px 14px", fontSize: 12, color: T.accent, fontWeight: 600, cursor: "pointer", fontFamily: T.font, marginBottom: 10 }}>Edit Client</button>}
            {cTasks.length > 0 && <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", marginBottom: 6 }}>Jobs · {cTasks.length}</div>
              {cTasks.map(t => <div key={t.id} onClick={() => openDetail(t)} style={{ padding: "8px 10px", marginBottom: 4, background: T.bg, borderRadius: 6, cursor: "pointer", fontSize: 13, color: T.text, display: "flex", alignItems: "center", gap: 8 }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = T.bg}>
                <HealthIcon t={t} size={8} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(t.start)}</span>
              </div>)}
            </>}
          </div>}
        </div>;
      })}
    </div>;

    const renderMobileTeam = () => <div style={{ padding: "8px 12px 88px", overflow: "auto", flex: 1 }}>
      {can("editJobs") && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button onClick={() => setPersonModal({ id: null, name: "", role: "", email: "", cap: 8, color: COLORS[Math.floor(Math.random() * COLORS.length)], teamNumber: null, isTeamLead: false, isEngineer: false, userRole: "user" })} style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Add Person</button>
      </div>}
      {people.map(p => {
        const isExp = mobileExp["p_" + p.id];
        const pActiveTasks = allItems.filter(t => (t.team || []).includes(p.id) && t.status !== "Finished");
        const currentTasks = pActiveTasks.filter(t => TD >= t.start && TD <= t.end);
        const upcoming = pActiveTasks.filter(t => t.start > TD).slice(0, 5);
        const bookedH = bookedHrs(p.id, TD);
        const pctLoad = p.cap > 0 ? Math.min(bookedH / p.cap * 100, 100) : 0;
        return <div key={p.id} style={{ marginBottom: 6 }}>
          <div onClick={() => setMobileExp(prev => ({ ...prev, ["p_" + p.id]: !prev["p_" + p.id] }))} style={{ display: "flex", gap: 12, padding: "12px 14px", background: T.card, borderRadius: isExp ? `${T.radiusSm}px ${T.radiusSm}px 0 0` : T.radiusSm, border: `1px solid ${T.border}`, borderBottom: isExp ? "none" : undefined, cursor: "pointer", alignItems: "center" }}>
            <div style={{ width: 38, height: 38, borderRadius: 19, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{p.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{p.name}</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>{p.role}{p.cap ? ` · ${p.cap}h/day` : ""}</div>
              <div style={{ marginTop: 5, background: T.bg, borderRadius: 3, height: 4, overflow: "hidden", width: "65%" }}>
                <div style={{ height: "100%", borderRadius: 3, background: bookedH > p.cap ? T.danger : pctLoad > 70 ? "#f59e0b" : T.accent, width: pctLoad + "%", transition: "width 0.3s" }} />
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: currentTasks.length > 0 ? T.accent : T.textDim, fontFamily: T.mono }}>{currentTasks.length}</div>
              <div style={{ fontSize: 10, color: T.textDim }}>today</div>
            </div>
            <span style={{ fontSize: 12, color: T.textDim, marginLeft: 4 }}>{isExp ? "▲" : "▼"}</span>
            {teamSelectMode && <div onClick={e => { e.stopPropagation(); setSelPeople(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; }); }} style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${selPeople.has(p.id) ? T.accent : T.border}`, background: selPeople.has(p.id) ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "all 0.15s" }}>{selPeople.has(p.id) && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5.5 4,8 8.5,2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>}
          </div>
          {isExp && <div style={{ background: T.bg + "88", border: `1px solid ${T.border}`, borderTop: "none", borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`, padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{currentTasks.length}</div>
                <div style={{ fontSize: 10, color: T.textDim }}>current</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{upcoming.length}</div>
                <div style={{ fontSize: 10, color: T.textDim }}>upcoming</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: bookedH > p.cap ? T.danger : T.text, fontFamily: T.mono }}>{bookedH.toFixed(1)}h</div>
                <div style={{ fontSize: 10, color: T.textDim }}>booked today</div>
              </div>
            </div>
            {currentTasks.length > 0 && <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Working On</div>
              {currentTasks.map(t => <div key={t.id} onClick={() => openDetail(t)} style={{ padding: "7px 10px", marginBottom: 4, background: T.card, borderRadius: 6, cursor: "pointer", fontSize: 13, color: T.text, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${T.border}` }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = T.card}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(t.end)}</span>
              </div>)}
            </>}
            {upcoming.length > 0 && <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 8, marginBottom: 5 }}>Up Next</div>
              {upcoming.map(t => <div key={t.id} onClick={() => openDetail(t)} style={{ padding: "7px 10px", marginBottom: 4, background: T.card, borderRadius: 6, cursor: "pointer", fontSize: 13, color: T.text, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${T.border}`, opacity: 0.72 }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = T.card}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: T.textDim, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(t.start)}</span>
              </div>)}
            </>}
            {currentTasks.length === 0 && upcoming.length === 0 && <div style={{ fontSize: 13, color: T.textDim, textAlign: "center", padding: "8px 0" }}>No active assignments</div>}
            {can("editJobs") && <div style={{ marginTop: 10 }}>
              <button onClick={() => setPersonModal({ ...p })} style={{ background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 8, padding: "6px 14px", fontSize: 12, color: T.accent, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Edit Person</button>
            </div>}
          </div>}
        </div>;
      })}
    </div>;

    const renderMobileAnalytics = () => {
      const bySt = ["Not Started", "Pending", "In Progress", "On Hold", "Finished"].map(s => ({ n: s, c: allItems.filter(x => x.status === s).length }));
      const totalTasks = tasks.length;
      const totalSubs = allItems.length - tasks.length;
      const avgHpd = tasks.length > 0 ? (tasks.reduce((a, t) => a + (t.hpd || 0), 0) / tasks.length).toFixed(1) : 0;
      return <div style={{ padding: "8px 12px 88px", overflow: "auto", flex: 1 }}>
        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
          {[{ label: "Jobs", val: totalTasks }, { label: "Subtasks", val: totalSubs }, { label: "Avg h/d", val: avgHpd }].map(s => <div key={s.label} style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 10px", textAlign: "center", border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{s.val}</div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{s.label}</div>
          </div>)}
        </div>
        {/* Status breakdown */}
        <div style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 16px", border: `1px solid ${T.border}`, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>By Status</div>
          {bySt.map(s => <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: STA_C[s.n], flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 14, color: T.textSec }}>{s.n}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{s.c}</span>
          </div>)}
        </div>
        {/* Team workload */}
        <div style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 16px", border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Team Workload</div>
          {people.map(p => {
            const pTasks = allItems.filter(t => (t.team || []).includes(p.id) && TD >= t.start && TD <= t.end);
            const hrs = pTasks.reduce((a, t) => a + (t.hpd || 0), 0);
            const pct = Math.min(hrs / p.cap * 100, 100);
            return <div key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: hrs > p.cap ? T.danger : T.textDim, fontFamily: T.mono, fontWeight: 600 }}>{hrs}h / {p.cap}h</span>
              </div>
              <div style={{ background: T.bg, borderRadius: 3, height: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, background: hrs > p.cap ? T.danger : pct > 70 ? "#f59e0b" : T.accent, width: pct + "%", transition: "width 0.3s" }} />
              </div>
            </div>;
          })}
        </div>
      </div>;
    };

    return <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Mobile header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 14, background: loggedInUser.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{loggedInUser.name[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{loggedInUser.name}</div>
          <div style={{ fontSize: 10, color: isAdmin ? T.accent : T.textDim }}>{isAdmin ? "Admin" : "Crew"}</div>
        </div>
        {can("editJobs") && <button onClick={() => { setFastTraqsPhase("input"); setFastTraqsExiting(false); setUploadModal(true); }} style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: T.accent + "18", border: `1px solid ${T.accent}66`, borderRadius: 10, cursor: "pointer", flexShrink: 0, animation: "glow-pulse 2.8s ease-in-out infinite" }} title="Fast TRAQS">
          <svg width="17" height="17" viewBox="0 0 24 24" fill={T.accent}><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
        </button>}
        <button onClick={e => { e.stopPropagation(); setNotifOpen(p => !p); }} style={{ position: "relative", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: notifOpen ? T.accent + "15" : T.bg, border: `1px solid ${notifOpen ? T.accent + "44" : T.border}`, borderRadius: 10, cursor: "pointer", flexShrink: 0, transition: "all 0.2s" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={notifOpen ? T.accent : T.textSec} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          {unreadByThread.length > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 12, height: 12, borderRadius: 6, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#fff" }}>{unreadMessages.length > 9 ? "9+" : unreadMessages.length}</span>}
        </button>
        <button onClick={e => { e.stopPropagation(); setSettingsOpen(p => !p); }} style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: settingsOpen ? T.accent + "15" : T.bg, border: `1px solid ${settingsOpen ? T.accent + "44" : T.border}`, borderRadius: 10, cursor: "pointer", flexShrink: 0, transition: "all 0.2s" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={settingsOpen ? T.accent : T.textSec} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.3s", transform: settingsOpen ? "rotate(90deg)" : "none" }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      {/* Search bar */}
      <div style={{ padding: "8px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div ref={searchRef} style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: T.radiusSm, border: `1px solid ${searchOpen ? T.accent : T.border}`, background: T.bg, transition: "border 0.15s" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={searchQ} onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }} onFocus={() => { if (searchQ) setSearchOpen(true); }} placeholder="Search..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 14, fontFamily: T.font }} />
            {searchQ && <span onClick={() => { setSearchQ(""); setSearchOpen(false); }} style={{ cursor: "pointer", fontSize: 11, color: T.textDim, padding: "2px 6px", borderRadius: 4, background: T.border + "44" }}>✕</span>}
          </div>
          {searchOpen && searchQ.length > 0 && (() => {
            const q = searchQ.toLowerCase();
            const jobResults = allItems.filter(t => t.title.toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q));
            const clientResults = clients.filter(c => c.name.toLowerCase().includes(q) || (c.contact || "").toLowerCase().includes(q));
            const personResults = people.filter(p => p.name.toLowerCase().includes(q));
            const hasResults = jobResults.length > 0 || clientResults.length > 0 || personResults.length > 0;
            return <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 9999, background: T.glass, border: `1px solid ${T.glassBorder}`, borderRadius: T.radiusSm, boxShadow: "0 8px 32px rgba(0,0,0,0.3)", maxHeight: 300, overflow: "auto" }}>
              {!hasResults && <div style={{ padding: "20px 12px", textAlign: "center", color: T.textDim, fontSize: 13 }}>No results</div>}
              {personResults.slice(0, 4).map(p => <div key={p.id} onClick={() => { setSearchQ(""); setSearchOpen(false); switchView("schedule"); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text, borderBottom: `1px solid ${T.border}22` }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
              </div>)}
              {clientResults.slice(0, 4).map(c => <div key={c.id} onClick={() => { setSearchQ(""); setSearchOpen(false); switchView("clients"); setMobileExp(p => ({ ...p, ["c_" + c.id]: true })); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text, borderBottom: `1px solid ${T.border}22` }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: c.color }} />
                <span style={{ fontWeight: 500 }}>{c.name}</span>
              </div>)}
              {jobResults.slice(0, 6).map(t => <div key={t.id} onClick={() => { setSearchQ(""); setSearchOpen(false); openDetail(t); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text, borderBottom: `1px solid ${T.border}22` }}>
                <HealthIcon t={t} size={8} />
                <span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
              </div>)}
            </div>;
          })()}
        </div>
      </div>
      {/* Top nav */}
      <MobileNav
        tabs={[
          { id: "home",     icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>, label: "Home" },
          { id: "tasks",    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>, label: "Jobs" },
          { id: "schedule", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: "Schedule" },
          { id: "clients",  icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><line x1="10" y1="6" x2="14" y2="6"/><line x1="10" y1="10" x2="14" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/><line x1="10" y1="18" x2="14" y2="18"/></svg>, label: "Clients" },
          { id: "messages", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, label: "Chat", badge: unreadMessages.length },
        ]}
        activeId={mobileView}
        onChange={id => setView(id === "home" ? "schedule" : id)}
      />
      {/* Animated content */}
      <AnimatedView viewKey={mobileView} style={{ flex: 1, minHeight: 0, overflow: mobileView === "messages" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
        {mobileView === "home" && renderMobileHome()}
        {mobileView === "tasks" && renderMobileTasks()}
        {mobileView === "clients" && renderMobileClients()}
        {mobileView === "schedule" && renderMobileTeam()}
        {mobileView === "analytics" && renderMobileAnalytics()}
        {mobileView === "messages" && renderMessages()}
      </AnimatedView>
      {/* Mobile Settings Overlay */}
      {settingsOpen && <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: T.bg, display: "flex", flexDirection: "column", fontFamily: T.font }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: T.surface }}>
          <button onClick={() => setSettingsOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: T.text, padding: "0 4px", lineHeight: 1 }}>←</button>
          <span style={{ fontSize: 17, fontWeight: 700, color: T.text, flex: 1 }}>Settings</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "20px 16px" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12 }}>Theme</div>
            <div style={{ display: "flex", gap: 7 }}>
              {[
                { id: "midnight", label: "Dark",   bg: "#080d18", accent: "#3d7fff" },
                { id: "frost",    label: "White",  bg: "#f0f4f9", accent: "#0ea5e9" },
                { id: "custom",   label: "Custom", bg: customTheme.bg, accent: customTheme.accent },
              ].map(th => {
                const active = themeMode === th.id;
                return <button key={th.id} onClick={() => setThemeMode(th.id)} title={th.label}
                  style={{ flex: 1, padding: "10px 4px 8px", background: th.bg, border: `2px solid ${active ? th.accent : "transparent"}`, borderRadius: T.radiusXs, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "border 0.18s, transform 0.18s", transform: active ? "scale(1.06)" : "scale(1)" }}>
                  {th.id === "custom"
                    ? <div style={{ width: 18, height: 18, borderRadius: 9, background: "conic-gradient(#f43f5e,#f59e0b,#10b981,#3d7fff,#7c3aed,#f43f5e)", boxShadow: active ? `0 0 8px ${th.accent}88` : "none", transition: "box-shadow 0.18s" }} />
                    : <div style={{ width: 18, height: 18, borderRadius: 9, background: th.accent, boxShadow: active ? `0 0 8px ${th.accent}88` : "none", transition: "box-shadow 0.18s" }} />}
                  <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? th.accent : "#888", letterSpacing: "0.02em" }}>{th.label}</span>
                </button>;
              })}
            </div>
            {themeMode === "custom" && <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12 }}>Customize</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { key: "bg",     label: "Background", sub: "App background & surfaces" },
                  { key: "accent", label: "Accent",     sub: "Buttons, highlights & indicators" },
                ].map(({ key, label, sub }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <label style={{ position: "relative", width: 38, height: 38, borderRadius: T.radiusXs, border: `2px solid ${T.borderLight}`, overflow: "hidden", cursor: "pointer", flexShrink: 0, display: "block" }} title={`Pick ${label}`}>
                      <div style={{ width: "100%", height: "100%", background: customTheme[key] }} />
                      <input type="color" value={customTheme[key]}
                        onChange={e => setCustomTheme(p => ({ ...p, [key]: e.target.value }))}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                    </label>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
                      <div style={{ fontSize: 11, color: T.textDim }}>{sub}</div>
                    </div>
                    <div style={{ marginLeft: "auto", fontSize: 11, color: T.textDim, fontFamily: "'JetBrains Mono',monospace" }}>{customTheme[key]}</div>
                  </div>
                ))}
              </div>
            </div>}
          </div>
          <button onClick={() => { setSettingsOpen(false); switchView("analytics"); }} style={{ width: "100%", padding: "16px", background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: T.font, textAlign: "left", marginBottom: 8 }}>
            <span style={{ flexShrink: 0, lineHeight: 0, color: T.textSec }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Analytics</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>View performance & insights</div>
            </div>
            <span style={{ fontSize: 18, color: T.textDim }}>›</span>
          </button>
          {isAdmin && <button onClick={() => { setSettingsOpen(false); setUsersOpen(true); setSettingsUser(null); }} style={{ width: "100%", padding: "16px", background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: T.font, textAlign: "left", marginBottom: 8 }}>
            <span style={{ flexShrink: 0, lineHeight: 0, color: T.textSec }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Users</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>Manage permissions & access</div>
            </div>
            <span style={{ fontSize: 18, color: T.textDim }}>›</span>
          </button>}
          <button onClick={() => { setSettingsOpen(false); setConfirmLogout(true); }} style={{ width: "100%", padding: "16px", background: T.card, border: `1px solid ${T.danger}22`, borderRadius: T.radiusSm, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: T.font, textAlign: "left" }}>
            <span style={{ flexShrink: 0, lineHeight: 0, color: T.danger }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.danger }}>Log Out</div>
          </button>
        </div>
      </div>}
      {/* Mobile Notifications Dropdown */}
      {notifOpen && <>
        <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: 56, right: 12, width: "min(300px, calc(100vw - 24px))", maxHeight: "60vh", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", zIndex: 9999, overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: T.font }}>
          <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase" }}>Notifications</div>
            {unreadByThread.length > 0 && <button onClick={() => { const all = {}; messages.forEach(m => { all[m.threadKey] = new Date().toISOString(); }); setLastRead(p => ({ ...p, ...all })); localStorage.setItem("tq_last_read", JSON.stringify({ ...lastRead, ...all })); }} style={{ background: "none", border: "none", fontSize: 11, color: T.accent, cursor: "pointer", fontFamily: T.font, fontWeight: 600 }}>Mark all read</button>}
          </div>
          <div style={{ overflow: "auto" }}>
            {unreadByThread.length === 0 ? (
              <div style={{ padding: "28px 18px", textAlign: "center", color: T.textDim, fontSize: 13 }}>All caught up! 🎉</div>
            ) : unreadByThread.map(item => {
              const title = getThreadTitle(item.threadKey, item.scope, item.jobId, item.panelId, item.opId);
              return <div key={item.threadKey} onClick={() => {
                const gId = item.scope === "group" ? item.threadKey.replace("group:", "") : null;
                const participants = getThreadParticipants(item.scope, item.jobId, item.panelId, item.opId, gId);
                setChatThread({ threadKey: item.threadKey, title, scope: item.scope, jobId: item.jobId, panelId: item.panelId, opId: item.opId, groupId: gId, participants });
                setView("messages"); setNotifOpen(false); markThreadRead(item.threadKey);
              }} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}
                onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: T.accent, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                    <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0, marginLeft: 8 }}>{item.count} new</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>{item.latest.authorName}:</strong> {item.latest.text}</div>
                </div>
              </div>;
            })}
          </div>
        </div>
      </>}
      {/* Ask TRAQS FAB — always visible on mobile */}
      {!askOpen && <button onClick={() => setAskOpen(true)} title="Ask TRAQS"
        style={{ position: "fixed", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", right: 20, zIndex: 1500, width: 56, height: 56, borderRadius: 28, background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 20px ${T.accent}55, 0 2px 8px rgba(0,0,0,0.3)`, animation: "glow-pulse 2.8s ease-in-out infinite" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill={T.accentText}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
      </button>}
    </div>;
  };


  // ═══════════════════ MESSAGES VIEW ═══════════════════
  const renderMessages = () => {
    // Derive unique job/panel/op threads from messages
    const threadMap = {};
    messages.forEach(m => {
      if (!threadMap[m.threadKey]) threadMap[m.threadKey] = { threadKey: m.threadKey, scope: m.scope, jobId: m.jobId, panelId: m.panelId, opId: m.opId, latest: m };
      else if (m.timestamp > threadMap[m.threadKey].latest.timestamp) threadMap[m.threadKey].latest = m;
    });
    const jobThreads = Object.values(threadMap).filter(t => t.scope !== "group").sort((a, b) => b.latest.timestamp.localeCompare(a.latest.timestamp));

    const threadMessages = chatThread ? messages.filter(m => m.threadKey === chatThread.threadKey) : [];
    const canPost = !!(chatThread && loggedInUser);

    const grouped = [];
    threadMessages.forEach(m => {
      const day = m.timestamp.slice(0, 10);
      if (!grouped.length || grouped[grouped.length - 1].day !== day) grouped.push({ day, msgs: [m] });
      else grouped[grouped.length - 1].msgs.push(m);
    });

    const unreadCount = (tk) => {
      if (!loggedInUser) return 0;
      const lr = lastRead[tk] || "1970-01-01T00:00:00Z";
      return messages.filter(m => m.threadKey === tk && m.authorId !== loggedInUser.id && m.timestamp > lr).length;
    };

    const openThread = (threadKey, title, scope, jobId, panelId, opId, groupId) => {
      const participants = getThreadParticipants(scope, jobId, panelId, opId, groupId);
      setChatThread({ threadKey, title, scope, jobId: jobId || null, panelId: panelId || null, opId: opId || null, groupId: groupId || null, participants });
      markThreadRead(threadKey);
    };

    const renderThread = (threadKey, title, latest, unread, icon) => {
      const isActive = chatThread?.threadKey === threadKey;
      const ts = latest ? new Date(latest.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
      return <div key={threadKey} onClick={() => {
        const t = threadMap[threadKey];
        if (threadKey.startsWith("group:")) {
          const gId = threadKey.replace("group:", "");
          const g = groups.find(x => x.id === gId);
          if (g) openThread(threadKey, title, "group", null, null, null, gId);
        } else if (t) {
          openThread(threadKey, title, t.scope, t.jobId, t.panelId, t.opId, null);
        } else {
          const gId = threadKey.replace("group:", "");
          openThread(threadKey, title, "group", null, null, null, gId);
        }
      }} style={{ display: "flex", gap: 10, padding: "10px 14px", cursor: "pointer", alignItems: "flex-start", background: isActive ? T.accent + "15" : "transparent", borderLeft: `3px solid ${isActive ? T.accent : "transparent"}`, transition: "all 0.15s" }} onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = T.accent + "08"; }} onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: isActive ? T.accent + "30" : T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: isActive ? T.accent : T.textSec }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: unread ? 700 : 500, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
            {ts && <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>{ts}</span>}
          </div>
          {latest && <div style={{ fontSize: 12, color: T.textDim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {latest.authorId === loggedInUser?.id ? "You" : latest.authorName}: {latest.text || (latest.attachments?.length ? "📎 Attachment" : "")}
          </div>}
        </div>
        {unread > 0 && <div style={{ width: 20, height: 20, borderRadius: 10, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accentText, flexShrink: 0, marginTop: 8 }}>{unread > 9 ? "9+" : unread}</div>}
      </div>;
    };

    const showList = !isMobile || !chatThread;
    const showChat = !isMobile || !!chatThread;

    return <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* ─── Thread list ─── */}
      {showList && <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: T.surface }}>
        {/* Groups header */}
        <div style={{ padding: "14px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Groups</span>
          {loggedInUser && <button onClick={() => setNewGroupModal(true)} title="New group" style={{ height: 36, display: "flex", alignItems: "center", padding: "0 14px", background: T.accent, border: "none", color: T.accentText, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, flexShrink: 0, whiteSpace: "nowrap" }}>+ New Chat</button>}
        </div>
        {groups.length === 0 && <div style={{ padding: "6px 14px 10px", fontSize: 12, color: T.textDim }}>No groups yet</div>}
        {groups.slice().sort((a, b) => {
          const ap = pinnedGroups.includes(a.id) ? 0 : 1;
          const bp = pinnedGroups.includes(b.id) ? 0 : 1;
          return ap - bp || a.name.localeCompare(b.name);
        }).map(g => {
          const tk = `group:${g.id}`;
          const latest = messages.filter(m => m.threadKey === tk).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
          const isPinned = pinnedGroups.includes(g.id);
          return <div key={g.id} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setGroupCtxMenu({ x: e.clientX, y: e.clientY, groupId: g.id, groupName: g.name }); }}>
            {renderThread(tk, (isPinned ? "📌 " : "") + g.name, latest, unreadCount(tk), <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>)}
          </div>;
        })}
        {/* Job threads */}
        {jobThreads.length > 0 && <>
          <div style={{ padding: "10px 14px 6px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Job Chats</span>
          </div>
          {jobThreads.slice().sort((a, b) => {
            const ap = pinnedThreads.includes(a.threadKey) ? 0 : 1;
            const bp = pinnedThreads.includes(b.threadKey) ? 0 : 1;
            return ap - bp;
          }).map(t => {
            const title = getThreadTitle(t.threadKey, t.scope, t.jobId, t.panelId, t.opId);
            const isPinned = pinnedThreads.includes(t.threadKey);
            const icon = t.scope === "op"
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              : t.scope === "panel"
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
            return <div key={t.threadKey} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setThreadCtxMenu({ x: e.clientX, y: e.clientY, threadKey: t.threadKey, title, scope: t.scope, jobId: t.jobId, panelId: t.panelId, opId: t.opId }); }}>
              {renderThread(t.threadKey, (isPinned ? "📌 " : "") + title, t.latest, unreadCount(t.threadKey), icon)}
            </div>;
          })}
        </>}
        <div style={{ flex: 1 }} />
      </div>}

      {/* ─── Chat area ─── */}
      {showChat && <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!chatThread ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: T.textDim, gap: 12 }}>
            <div style={{ lineHeight: 0, color: T.textDim }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.textSec }}>Select a conversation</div>
            <div style={{ fontSize: 13 }}>Choose a group or job chat from the left</div>
          </div>
        ) : (<>
          {/* Chat header */}
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            {isMobile && <button onClick={() => setChatThread(null)} style={{ background: "none", border: "none", color: T.textSec, fontSize: 20, cursor: "pointer", padding: "0 6px 0 0", lineHeight: 1 }}>‹</button>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chatThread.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: T.textDim, marginRight: 2 }}>
                  {chatThread.scope === "group" ? "Members:" : "Participants:"}
                </span>
                {chatThread.participants.slice(0, 8).map(p => (
                  <div key={p.id} title={p.name} style={{ width: 20, height: 20, borderRadius: 10, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{p.name[0]}</div>
                ))}
                {chatThread.participants.length > 8 && <span style={{ fontSize: 11, color: T.textDim }}>+{chatThread.participants.length - 8}</span>}
              </div>
            </div>
          </div>
          {/* Messages */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 0" }}>
            {threadMessages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: T.textDim }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, opacity: 0.5 }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.textSec, marginBottom: 6 }}>No messages yet</div>
                <div style={{ fontSize: 12, color: T.textDim }}>{canPost ? "Be the first to send a message." : "This thread has no messages."}</div>
              </div>
            )}
            {grouped.map(({ day, msgs }) => {
              const dt = new Date(day + "T12:00:00");
              const dayLabel = day === TD ? "Today" : day === addD(TD, -1) ? "Yesterday" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return <div key={day}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", marginBottom: 4 }}>
                  <div style={{ flex: 1, height: 1, background: T.border }} />
                  <span style={{ fontSize: 11, color: T.textDim, fontWeight: 600, whiteSpace: "nowrap" }}>{dayLabel}</span>
                  <div style={{ flex: 1, height: 1, background: T.border }} />
                </div>
                {msgs.map((m, i) => {
                  const isMe = loggedInUser && m.authorId === loggedInUser.id;
                  const ts = new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return <div key={m.id} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: 10, padding: "4px 14px", alignItems: "center" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 16, background: m.authorColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{m.authorName[0]}</div>
                    <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: m.authorColor, marginLeft: isMe ? 0 : 2, marginRight: isMe ? 2 : 0 }}>{m.authorName}</span>
                      {m.text && <div style={{ background: m.authorColor, color: "#fff", padding: "10px 15px", borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px", fontSize: 15, lineHeight: 1.55, wordBreak: "break-word", border: "none" }}>
                        {m.text}
                      </div>}
                      {(m.attachments || []).map((att, ai) => (
                        att.mimeType?.startsWith("image/")
                          ? <div key={ai} onClick={() => setLightboxAtt(att)} style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}`, maxWidth: 240, cursor: "zoom-in" }}>
                              <img src={`/api/attachment?key=${encodeURIComponent(att.key)}`} alt={att.filename} style={{ display: "block", maxWidth: "100%", maxHeight: 220, objectFit: "cover" }} loading="lazy" />
                            </div>
                          : <div key={ai} onClick={() => setLightboxAtt(att)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", background: m.authorColor + "cc", border: `1px solid ${m.authorColor}`, borderRadius: 10, fontSize: 13, color: "#fff", cursor: "pointer", maxWidth: 220 }}>
                              <span style={{ fontSize: 17, flexShrink: 0 }}>{att.mimeType === "application/pdf" ? "📄" : "📎"}</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.filename}</span>
                            </div>
                      ))}
                      <span style={{ fontSize: 11, color: T.textDim, marginLeft: isMe ? 0 : 2, marginRight: isMe ? 2 : 0 }}>{ts}</span>
                    </div>
                  </div>;
                })}
              </div>;
            })}
            <div ref={chatBottomRef} />
          </div>
          {/* Input */}
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            {chatError && <div style={{ marginBottom: 8, padding: "8px 12px", background: T.danger + "15", border: `1px solid ${T.danger}33`, borderRadius: 8, fontSize: 12, color: T.danger, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span>⚠ {chatError}</span>
              <button onClick={() => setChatError(null)} style={{ background: "none", border: "none", color: T.danger, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
            </div>}
            {canPost ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {chatAttachments.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {chatAttachments.map((att, i) => (
                      <div key={att.key} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 6px", background: T.accent + "18", border: `1px solid ${T.accent}44`, borderRadius: 8, maxWidth: 180 }}>
                        <span style={{ fontSize: 14 }}>{att.mimeType.startsWith("image/") ? "🖼️" : att.mimeType === "application/pdf" ? "📄" : "📎"}</span>
                        <span style={{ fontSize: 11, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{att.filename}</span>
                        <button onClick={() => setChatAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: T.textDim, fontSize: 13, cursor: "pointer", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <input ref={chatFileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleChatFileSelect} />
                  <button onClick={() => chatFileInputRef.current?.click()} disabled={chatUploading} title="Attach file" style={{ width: 36, height: 36, borderRadius: 8, background: chatUploading ? T.accent + "15" : T.surface, border: `1px solid ${T.border}`, cursor: chatUploading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s", color: chatUploading ? T.accent : T.textDim }}>
                    {chatUploading
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    }
                  </button>
                  <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }} placeholder="Type a message… (Enter to send)" rows={2} style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "11px 14px", color: T.text, fontSize: 15, fontFamily: T.font, resize: "none", outline: "none", lineHeight: 1.5 }} />
                  <button onClick={sendChatMessage} disabled={(!chatInput.trim() && !chatAttachments.length) || chatSending || chatUploading} style={{ width: 38, height: 38, borderRadius: 10, background: (chatInput.trim() || chatAttachments.length) && !chatSending && !chatUploading ? T.accent : T.border, border: "none", cursor: (chatInput.trim() || chatAttachments.length) && !chatSending && !chatUploading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.15s" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "10px 0", fontSize: 12, color: T.textDim, background: T.surface, borderRadius: 8, border: `1px solid ${T.border}` }}>
                👁 View only — you're not a participant in this thread
              </div>
            )}
          </div>
        </>)}
      </div>}
    </div>;
  };

  // ═══════════════════ MODALS ═══════════════════
  const renderModal = () => {
    if (!modal) return null;
    const ov = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: isMobile ? "8px" : "40px 24px", overflow: "auto" };
    const bx = (wide) => ({ background: T.card, borderRadius: isMobile ? 14 : 16, padding: isMobile ? 18 : 32, maxWidth: wide ? 1000 : 600, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" });
    const cls = <button onClick={closeModal} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>;
    if (modal.type === "edit") { const [ed, setEd] = [modal.data, d => setModal(p => ({ ...p, data: typeof d === "function" ? d(p.data) : d }))];
      const addPanels = (count) => {
        const rawOps = (ed.customOps || []).filter(o => o.title && o.title.trim());
        if (!rawOps.length) return;

        const panels = [];
        const pStart = nextBD(ed.start || TD);
        const pEnd = nextBD(ed.end || addBD(TD, 9));
        const totalBD = Math.max(diffBD(pStart, pEnd) + 1, rawOps.length);
        const totalDur = rawOps.reduce((s, o) => s + Math.max(o.durationBD || 1, 1), 0);
        const scaledDurs = rawOps.map(o => Math.max(Math.round(Math.max(o.durationBD || 1, 1) * totalBD / totalDur), 1));
        scaledDurs[scaledDurs.length - 1] += totalBD - scaledDurs.reduce((s, d) => s + d, 0);

        for (let i = 0; i < count; i++) {
          const opSubs = [];
          let cursor = pStart;
          rawOps.forEach((op, oi) => {
            const opStart = cursor;
            const opEnd = addBD(opStart, scaledDurs[oi] - 1);
            opSubs.push({ id: null, title: op.title, start: opStart, end: opEnd, status: "Not Started", pri: "High", team: [], hpd: 7.5, notes: "", deps: [] });
            cursor = addBD(opEnd, 1);
          });
          const panelEnd = opSubs[opSubs.length - 1].end;
          panels.push({
            id: null, title: `${ed.title}-${String(i + 1).padStart(2, "0")}`, start: pStart, end: panelEnd,
            pri: "High", status: "Not Started", team: [], hpd: ed.hpd, notes: "", deps: [],
            engineering: { designed: null, verified: null, sentToPerforex: null },
            subs: opSubs,
          });
        }
        setEd(p => ({ ...p, subs: panels }));
      };
      // Check if a person has any overlapping operations during a date range
      const isPersonBusy = (pid, opStart, opEnd, currentPanelIdx, currentOpIdx) => {
        // Check existing saved tasks (exclude ops from the job being edited)
        for (const job of tasks) {
          if (ed.id && job.id === ed.id) continue; // skip the job we're editing
          for (const panel of (job.subs || [])) {
            for (const op of (panel.subs || [])) {
              if (op.team.includes(pid) && op.status !== "Finished" && op.start <= opEnd && op.end >= opStart) return true;
            }
          }
        }
        // Check other operations within current edit form (unsaved) — only same-person conflicts
        for (let pi = 0; pi < (ed.subs || []).length; pi++) {
          for (let oi = 0; oi < ((ed.subs[pi] || {}).subs || []).length; oi++) {
            if (pi === currentPanelIdx && oi === currentOpIdx) continue;
            const op = ed.subs[pi].subs[oi];
            if (op.team.includes(pid) && op.start <= opEnd && op.end >= opStart) return true;
          }
        }
        // Check time off
        const person = people.find(x => x.id === pid);
        if (person) for (const to of (person.timeOff || [])) {
          if (to.start <= opEnd && to.end >= opStart) return true;
        }
        return false;
      };
      const suggestSchedule = () => {
        setAiLoading(true);
        setAiSuggestion(null);
        setTimeout(() => {
          const rawOps = (ed.customOps || []).filter(o => o.title && o.title.trim());
          const opsPerPanel = Math.max(rawOps.length, 1);
          const _clientName = (clients.find(c => c.id === ed.clientId) || {}).name || "";
          const crewForOp = (opTitle) => people.filter(p => p.userRole === "user" && !p.noAutoSchedule)
            .filter(p => canAssignPerson(p, opTitle, ed.title, ed.jobNumber || "", _clientName));
          const crew = people.filter(p => p.userRole === "user" && !p.noAutoSchedule);
          const numPanels = Math.max((ed.subs || []).length, 1);
          const hasDueDate = ed.dueDate && ed.dueDate > TD;
          // Per-batch business days (how long each panel takes to complete)
          const batchBD = Math.max(3, Math.ceil(opsPerPanel * 1.5)); // reasonable default ~5 BD per panel batch

          // Helper: check if a person is free for a date range
          const isPersonFree = (pid, checkStart, checkEnd) => {
            for (const job of tasks) {
              if (ed.id && job.id === ed.id) continue;
              for (const panel of (job.subs || [])) {
                for (const op of (panel.subs || [])) {
                  if (op.team.includes(pid) && op.status !== "Finished" && op.start <= checkEnd && op.end >= checkStart) return false;
                }
              }
            }
            const person = people.find(x => x.id === pid);
            if (person) for (const to of (person.timeOff || [])) {
              if (to.start <= checkEnd && to.end >= checkStart) return false;
            }
            return true;
          };

          // Find windows: simulate batch-by-batch scheduling from each start date
          const findWindows = (deadline) => {
            const results = [];
            const maxScan = 200;
            for (let attempt = 0; attempt < maxScan && results.length < 3; attempt++) {
              const wStart = addBD(nextBD(TD), attempt);

              // Simulate scheduling all panels in batches from wStart
              let bStart = wStart;
              let panelsRemaining = numPanels;
              let totalBatches = 0;
              let firstBatchPanels = 0;
              let failed = false;

              while (panelsRemaining > 0) {
                const bEnd = addBD(bStart, batchBD - 1);
                // Per-op filtering: capacity = min free crew across all ops
                const panelsThisBatch = Math.max(Math.min(...rawOps.map(o =>
                  crewForOp(o.title).filter(p => isPersonFree(p.id, bStart, bEnd)).length
                )), 0);

                if (panelsThisBatch === 0) { failed = true; break; }

                const scheduled = Math.min(panelsThisBatch, panelsRemaining);
                if (totalBatches === 0) firstBatchPanels = scheduled;
                panelsRemaining -= scheduled;
                totalBatches++;
                bStart = addBD(bEnd, 1);
              }

              if (failed) continue;

              const totalEnd = addBD(wStart, (batchBD * totalBatches) - 1);
              const firstBatchEnd = addBD(wStart, batchBD - 1);
              const available = crew.filter(p => isPersonFree(p.id, wStart, firstBatchEnd));
              const busy = crew.filter(p => !isPersonFree(p.id, wStart, firstBatchEnd));

              const isDuplicate = results.some(s => Math.abs(diffBD(s.start, wStart)) < 2);
              if (!isDuplicate) {
                const meetsDeadline = deadline ? totalEnd <= deadline : true;
                results.push({
                  start: wStart, end: totalEnd, available, busy, meetsDeadline,
                  businessDays: batchBD, numBatches: totalBatches, panelsAtOnce: firstBatchPanels,
                  totalBD: batchBD * totalBatches,
                  staggered: totalBatches > 1
                });
              }
            }
            return results;
          };

          if (hasDueDate) {
            const windows = findWindows(ed.dueDate);
            const beforeDue = windows.filter(w => w.meetsDeadline);

            if (beforeDue.length > 0) {
              setAiSuggestion({ canMeetDue: true, dueDate: ed.dueDate, slots: beforeDue.slice(0, 3), numPanels });
            } else {
              // Can't meet deadline — find earliest regardless
              const earliest = findWindows(null);
              const newDueDate = earliest.length > 0 ? earliest[0].end : null;
              setAiSuggestion({ canMeetDue: false, dueDate: ed.dueDate, slots: earliest.slice(0, 3), numPanels, suggestedDueDate: newDueDate });
            }
          } else {
            const slots = findWindows(null);
            setAiSuggestion({ canMeetDue: null, dueDate: null, slots: slots.slice(0, 3), numPanels });
          }

          setAiLoading(false);
        }, 500);
      };

      const shopCrew = people.filter(p => p.userRole === "user");

      const loadTemplate = (tpl) => {
        setEd(p => ({ ...p, customOps: tpl.ops.map(o => ({ ...o })) }));
      };
      const deleteTemplate = (tid) => {
        persistTemplates(templates.filter(t => t.id !== tid));
      };

      return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(true), position: "relative", maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>{cls}        {/* ── Header ── */}
        <h3 style={{ margin: "0 0 20px", color: T.text, fontSize: 22, fontWeight: 700 }}>{ed.id ? "Edit" : "New Task"}</h3>

        {/* ── Task fields ── */}
        <InputField label="Task Name" value={ed.title} onChange={v => setEd(p => ({ ...p, title: v }))} />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <InputField label="Task #" value={ed.jobNumber || ""} onChange={v => setEd(p => ({ ...p, jobNumber: v }))} placeholder="e.g. 2024-001" />
          <InputField label="PO #" value={ed.poNumber || ""} onChange={v => setEd(p => ({ ...p, poNumber: v }))} placeholder="e.g. PO-8821" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <InputField label="Due Date (Customer)" value={ed.dueDate || ""} onChange={v => setEd(p => ({ ...p, dueDate: v }))} type="date" />
          <InputField label="Drawing #" value={ed.drawingNumber || ""} onChange={v => setEd(p => ({ ...p, drawingNumber: v }))} placeholder="e.g. DWG-001" />
        </div>
        <SearchSelect label="Client" value={ed.clientId} onChange={v => setEd(p => ({ ...p, clientId: v }))} options={clients.map(c => ({ value: c.id, label: c.name, color: c.color, sub: c.contact }))} placeholder="Search clients..." />

        {/* ── Ops Template ── */}
        <div style={{ marginBottom: 20 }}>
          {/* Header row: label | template dropdown + Save button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <label style={{ fontSize: 13, color: T.textSec, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Operations</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {templates.length > 0 && (
                <select defaultValue="" onChange={e => { const tpl = templates.find(t => t.id === e.target.value); if (tpl) loadTemplate(tpl); e.target.value = ""; }}
                  style={{ padding: "5px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.font, cursor: "pointer" }}>
                  <option value="" disabled>Load template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button onClick={() => { setTemplateNameInput(""); setSaveTemplateModal(true); }}
                disabled={!(ed.customOps || []).some(o => o.title?.trim())}
                style={{ padding: "5px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.accent}44`,
                  background: T.accent + "10", color: T.accent, fontSize: 12, fontWeight: 700,
                  opacity: (ed.customOps || []).some(o => o.title?.trim()) ? 1 : 0.4,
                  cursor: (ed.customOps || []).some(o => o.title?.trim()) ? "pointer" : "not-allowed", fontFamily: T.font }}>
                Save Template
              </button>
            </div>
          </div>
          {/* Op cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {(ed.customOps || []).map((op, oi) => {
              const updateOp = (patch) => { const ops = [...(ed.customOps || [])]; ops[oi] = { ...ops[oi], ...patch }; setEd(p => ({ ...p, customOps: ops })); };
              return <div key={oi} style={{ background: T.bg, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, padding: 12 }}>
                {/* Op title row */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: (op.subs || []).length ? 8 : 0 }}>
                  <input value={op.title} onChange={e => updateOp({ title: e.target.value })} placeholder="Operation name" style={{ flex: 1, padding: "7px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
                  <button onClick={() => setEd(p => ({ ...p, customOps: (p.customOps || []).filter((_, j) => j !== oi) }))} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 13, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                </div>
                {/* Nested sub-ops */}
                {(op.subs || []).map((sub, si) => <div key={si} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, paddingLeft: 16 }}>
                  <div style={{ width: 2, height: 20, background: T.border, borderRadius: 2, flexShrink: 0 }} />
                  <input value={sub.title} onChange={e => { const subs = [...(op.subs || [])]; subs[si] = { ...subs[si], title: e.target.value }; updateOp({ subs }); }} placeholder="Sub-op name" style={{ flex: 1, padding: "5px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.font, boxSizing: "border-box" }} />
                  <button onClick={() => updateOp({ subs: (op.subs || []).filter((_, j) => j !== si) })} style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 12, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                </div>)}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: (op.subs || []).length ? 4 : 8 }}>
                  <button onClick={() => updateOp({ subs: [...(op.subs || []), { id: uid(), title: "" }] })} style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Add Sub-operation</button>
                </div>
              </div>;
            })}
          </div>
          {/* Add Operation button */}
          <button onClick={() => setEd(p => ({ ...p, customOps: [...(p.customOps || []), { title: "", durationBD: 1, subs: [] }] }))} style={{ display: "block", width: "100%", padding: "18px 0", borderRadius: T.radiusSm, border: `2px dashed ${T.accent}55`, background: T.accent + "08", color: T.accent, fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: T.font, transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = T.accent + "18"; e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.accent + "08"; e.currentTarget.style.borderColor = T.accent + "55"; }}>
            + Add Operation
          </button>
        </div>

        {/* Panel count */}
        {!ed.id && <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 500 }}>Number of Panels</label>
          {!(ed.customOps || []).some(o => o.title?.trim()) && (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>⚠ Add ops above before setting panel count</div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="number" min="1" max="50" value={(ed.subs || []).length || ""} onChange={e => { const n = Math.max(1, Math.min(50, parseInt(e.target.value) || 0)); if (n > 0) addPanels(n); }} style={{ width: 96, padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 16, fontWeight: 700, fontFamily: T.mono, textAlign: "center", boxSizing: "border-box", outline: "none", transition: "border 0.2s, box-shadow 0.2s", colorScheme: T.colorScheme }}
              onFocus={e => { e.target.style.borderColor = T.accent + "55"; e.target.style.boxShadow = `0 0 0 3px ${T.accent}15`; }}
              onBlur={e => { e.target.style.borderColor = T.glassBorder; e.target.style.boxShadow = "none"; }} />
            <span style={{ fontSize: 13, color: T.textDim }}>panels for this task</span>
          </div>
        </div>}

        {/* AI Schedule Suggestion */}
        <div style={{ marginBottom: 20 }}>
          <button onClick={suggestSchedule} disabled={aiLoading || (ed.subs || []).length === 0} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 18px", borderRadius: T.radiusSm, border: "none", background: (ed.subs || []).length === 0 ? T.textDim + "33" : T.accent, color: T.accentText, fontSize: 15, fontWeight: 700, cursor: aiLoading || (ed.subs || []).length === 0 ? "not-allowed" : "pointer", fontFamily: T.font, transition: "all 0.2s", width: "100%", opacity: (ed.subs || []).length === 0 ? 0.5 : 1, boxShadow: (ed.subs || []).length > 0 ? `0 4px 14px ${T.accent}59` : "none", letterSpacing: "0.3px" }}>
            {aiLoading ? "⏳ Checking availability..." : "Check for Availability!"}
          </button>

          {aiSuggestion && <div style={{ marginTop: 12 }}>
            {/* Header message based on result */}
            {aiSuggestion.canMeetDue === true && <div style={{ padding: "12px 16px", background: "#10b98112", border: "1px solid #10b98133", borderRadius: T.radiusSm, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ lineHeight: 0, color: "#10b981" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>Yes! We can meet the {fm(aiSuggestion.dueDate)} deadline</div>
              <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>Found {aiSuggestion.slots.length} schedule option{aiSuggestion.slots.length > 1 ? "s" : ""} for {aiSuggestion.numPanels} panel{aiSuggestion.numPanels > 1 ? "s" : ""}</div></div>
            </div>}
            {aiSuggestion.canMeetDue === false && <div style={{ padding: "12px 16px", background: "#ef444412", border: "1px solid #ef444433", borderRadius: T.radiusSm, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ lineHeight: 0, color: "#ef4444" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>Cannot meet the {fm(aiSuggestion.dueDate)} deadline</div>
              </div>
              <div style={{ fontSize: 12, color: T.textSec }}>Not enough crew available before the due date for {aiSuggestion.numPanels} panel{aiSuggestion.numPanels > 1 ? "s" : ""}.</div>
              {aiSuggestion.suggestedDueDate && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: T.textSec }}>Suggested new due date:</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", fontFamily: T.mono }}>{fm(aiSuggestion.suggestedDueDate)}</span>
                <button onClick={() => setEd(p => ({ ...p, dueDate: aiSuggestion.suggestedDueDate }))} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #f59e0b44", background: "#f59e0b15", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>Update Due Date</button>
              </div>}
            </div>}
            {aiSuggestion.canMeetDue === null && <div style={{ padding: "12px 16px", background: T.accent + "12", border: `1px solid ${T.accent}33`, borderRadius: T.radiusSm, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🤖</span>
              <div style={{ fontSize: 13, color: T.textSec }}>No due date set. Here are the earliest available windows:</div>
            </div>}

            {aiSuggestion.slots.length === 0 && <div style={{ padding: 16, background: T.danger + "10", border: `1px solid ${T.danger}33`, borderRadius: T.radiusSm, color: T.danger, fontSize: 13, fontWeight: 500 }}>
              No available windows found. Consider adjusting panel count or adding team members.
            </div>}

            {aiSuggestion.slots.map((slot, si) => <div key={si} style={{ background: T.surface, border: `1px solid ${slot.meetsDeadline !== false ? T.border : "#f59e0b44"}`, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accent + "08"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = slot.meetsDeadline !== false ? T.border : "#f59e0b44"; e.currentTarget.style.background = T.surface; }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{fm(slot.start)}</span>
                  <span style={{ color: T.textDim }}>→</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{fm(slot.end)}</span>
                  <span style={{ fontSize: 11, color: T.textDim }}>({slot.totalBD || diffBD(slot.start, slot.end) + 1} days total)</span>
                  {si === 0 && slot.meetsDeadline !== false && <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "#10b98115", padding: "2px 8px", borderRadius: 10, border: "1px solid #10b98133" }}>RECOMMENDED</span>}
                  {slot.meetsDeadline === false && <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "#f59e0b15", padding: "2px 8px", borderRadius: 10, border: "1px solid #f59e0b33" }}>AFTER DUE DATE</span>}
                </div>
                <button onClick={(e) => {
                  e.stopPropagation();
                  setEd(p => {
                    const updated = { ...p };
                    const panels = p.subs || [];
                    if (panels.length > 0) {
                      const _rawOps = (p.customOps || []).filter(o => o.title && o.title.trim());
                      const opsPerPanel = Math.max(_rawOps.length, 1);
                      const bd = slot.businessDays || (diffBD(slot.start, slot.end) + 1);
                      const totalDur = _rawOps.reduce((s, o) => s + Math.max(o.durationBD || 1, 1), 0);
                      const scaledDurs = _rawOps.map(o => Math.max(Math.round(Math.max(o.durationBD || 1, 1) * bd / totalDur), 1));
                      scaledDurs[scaledDurs.length - 1] += bd - scaledDurs.reduce((s, d) => s + d, 0);

                      const _jobClientName = (clients.find(c => c.id === p.clientId) || {}).name || "";
                      const allCrew = people.filter(pp => pp.userRole === "user" && !pp.noAutoSchedule);

                      const isPersonFreeForRange = (pid, s, e) => {
                        for (const job of tasks) {
                          if (ed.id && job.id === ed.id) continue;
                          for (const pnl of (job.subs || [])) {
                            for (const op of (pnl.subs || [])) {
                              if (op.team.includes(pid) && op.status !== "Finished" && op.start <= e && op.end >= s) return false;
                            }
                          }
                        }
                        const pp = people.find(x => x.id === pid);
                        if (pp) for (const to of (pp.timeOff || [])) { if (to.start <= e && to.end >= s) return false; }
                        return true;
                      };

                      const personSchedule = [];
                      const isPersonAvail = (pid, s, e) => {
                        if (!isPersonFreeForRange(pid, s, e)) return false;
                        for (const a of personSchedule) {
                          if (a.pid === pid && a.start <= e && a.end >= s) return false;
                        }
                        return true;
                      };

                      // Build op windows from scaled durations
                      const buildOpWindows = (batchStart) => {
                        const windows = [];
                        let cursor = batchStart;
                        _rawOps.forEach((op, oi) => {
                          const s = cursor;
                          const e = addBD(s, scaledDurs[oi] - 1);
                          windows.push({ title: op.title, start: s, end: e });
                          cursor = addBD(e, 1);
                        });
                        return windows;
                      };

                      let batchStart = slot.start;
                      const newSubs = [];
                      let latestEnd = slot.start;
                      let remaining = [...panels];

                      while (remaining.length > 0) {
                        const batchPanels = [];
                        const opWindows = buildOpWindows(batchStart);
                        const batchEnd = opWindows[opWindows.length - 1].end;

                        for (let pi = 0; pi < remaining.length; pi++) {
                          const panel = remaining[pi];
                          const assignments = [];
                          let canSchedule = true;
                          for (const ow of opWindows) {
                            const avail = allCrew.filter(pp =>
                              canAssignPerson(pp, ow.title, p.title, p.jobNumber || "", _jobClientName) &&
                              isPersonAvail(pp.id, ow.start, ow.end) &&
                              !assignments.some(a => a.pid === pp.id)
                            );
                            if (avail.length > 0) {
                              assignments.push({ pid: avail[0].id, ...ow });
                            } else {
                              canSchedule = false;
                              break;
                            }
                          }

                          if (canSchedule) {
                            assignments.forEach(a => personSchedule.push({ pid: a.pid, start: a.start, end: a.end }));
                            const ops = (panel.subs || []);
                            const newOps = ops.map((op, oi) => ({
                              ...op,
                              start: assignments[oi] ? assignments[oi].start : opWindows[oi]?.start || batchStart,
                              end: assignments[oi] ? assignments[oi].end : opWindows[oi]?.end || batchStart,
                              team: assignments[oi] ? [assignments[oi].pid] : [],
                            }));
                            batchPanels.push({ panel: { ...panel, start: batchStart, end: batchEnd, subs: newOps }, idx: pi });
                            if (batchEnd > latestEnd) latestEnd = batchEnd;
                          }
                        }

                        if (batchPanels.length === 0) {
                          remaining.forEach(panel => {
                            const ops = (panel.subs || []);
                            const newOps = ops.map((op, oi) => ({ ...op, start: opWindows[oi]?.start || batchStart, end: opWindows[oi]?.end || batchStart, team: [] }));
                            newSubs.push({ ...panel, start: batchStart, end: batchEnd, subs: newOps });
                          });
                          if (batchEnd > latestEnd) latestEnd = batchEnd;
                          remaining = [];
                        } else {
                          batchPanels.forEach(bp => newSubs.push(bp.panel));
                          const assignedIdxs = new Set(batchPanels.map(bp => bp.idx));
                          remaining = remaining.filter((_, i) => !assignedIdxs.has(i));
                          const thisBatchEnd = batchPanels.reduce((mx, bp) => bp.panel.end > mx ? bp.panel.end : mx, batchStart);
                          batchStart = addBD(thisBatchEnd, 1);
                        }
                      }

                      updated.subs = newSubs;
                      updated.start = slot.start;
                      updated.end = latestEnd;
                    }
                    return updated;
                  });
                  setAiSuggestion(null);
                }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: T.accent, color: T.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font, whiteSpace: "nowrap", flexShrink: 0 }}>
                  Use This Schedule
                </button>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: slot.busy.length > 0 ? 6 : 0 }}>
                <span style={{ fontSize: 11, color: "#10b981", fontWeight: 500, marginRight: 4 }}>✓ Available ({slot.available.length}):</span>
                {slot.available.map(p => <span key={p.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: p.color + "15", color: p.color, fontWeight: 600, border: `1px solid ${p.color}33` }}>{p.name}</span>)}
              </div>
              {slot.busy.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: T.danger, fontWeight: 500, marginRight: 4 }}>✗ Busy ({slot.busy.length}):</span>
                {slot.busy.map(p => <span key={p.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: T.danger + "10", color: T.danger + "aa", fontWeight: 500, textDecoration: "line-through" }}>{p.name}</span>)}
              </div>}
              {slot.staggered && <div style={{ marginTop: 6, padding: "6px 10px", background: T.accent + "08", borderRadius: T.radiusXs, border: `1px solid ${T.accent}22`, fontSize: 11, color: T.textSec }}>
                📋 <strong style={{ color: T.text }}>{slot.panelsAtOnce} panel{slot.panelsAtOnce > 1 ? "s" : ""}</strong> at a time ({slot.businessDays} days each) × <strong style={{ color: T.text }}>{slot.numBatches} batch{slot.numBatches > 1 ? "es" : ""}</strong> — people rotate between batches
              </div>}
              {!slot.staggered && <div style={{ marginTop: 6, padding: "6px 10px", background: "#10b98108", borderRadius: T.radiusXs, border: "1px solid #10b98122", fontSize: 11, color: T.textSec }}>
                📋 All <strong style={{ color: T.text }}>{aiSuggestion.numPanels} panels</strong> run simultaneously — enough crew for everyone
              </div>}
            </div>)}
          </div>}
        </div>

        {/* Completion dates (filled by AI or manual) */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}><InputField label="Completion Start" value={ed.start} onChange={v => setEd(p => ({ ...p, start: v }))} type="date" /><InputField label="Completion End" value={ed.end} onChange={v => setEd(p => ({ ...p, end: v }))} type="date" /></div>

          {/* Panels with operations */}
          {(ed.subs || []).length > 0 && <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 600 }}>Panels & Assignments</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(ed.subs || []).map((panel, pi) => <div key={pi} style={{ background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: T.accent }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{panel.title}</span>
                  <span style={{ fontSize: 12, color: T.textDim, marginLeft: "auto" }}>{fm(panel.start)} → {fm(panel.end)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(panel.subs || []).map((op, oi) => {
                    const assignedPerson = op.team.length > 0 ? people.find(p => p.id === op.team[0]) : null;
                    const opColor = assignedPerson ? assignedPerson.color : (OP_COLORS[op.title] || ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#14b8a6"][oi % 5]);
                    const updateOp = (patch) => { const newSubs = [...ed.subs]; const newOps = [...newSubs[pi].subs]; newOps[oi] = { ...newOps[oi], ...patch }; newSubs[pi] = { ...newSubs[pi], subs: newOps }; setEd(prev => ({ ...prev, subs: newSubs })); };
                    return <div key={oi} style={{ background: assignedPerson ? assignedPerson.color + "08" : T.bg, borderRadius: T.radiusXs, border: `1px solid ${assignedPerson ? assignedPerson.color + "44" : T.border}`, padding: "8px 12px" }}>
                      {/* Op title row + hpd + delete */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: 3, background: opColor, flexShrink: 0 }} />
                        <input value={op.title} onChange={e => updateOp({ title: e.target.value })} style={{ flex: 1, minWidth: 60, padding: "4px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontWeight: 600, fontFamily: T.font, boxSizing: "border-box" }} />
                        <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, whiteSpace: "nowrap" }}>{fm(op.start)} → {fm(op.end)}</span>
                        {op.hpd > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <label style={{ fontSize: 11, color: T.textDim, whiteSpace: "nowrap" }}>hrs/day</label>
                            <input type="number" min="0" max="12" step="0.5" value={op.hpd} onChange={e => updateOp({ hpd: parseFloat(e.target.value) || 0 })} style={{ width: 56, padding: "4px 6px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.mono, textAlign: "center", boxSizing: "border-box" }} />
                          </div>
                        ) : (
                          <button onClick={() => updateOp({ hpd: 7.5 })} style={{ padding: "3px 8px", borderRadius: T.radiusXs, border: `1px dashed ${T.accent}55`, background: "transparent", color: T.accent, fontSize: 11, cursor: "pointer", fontFamily: T.font, whiteSpace: "nowrap", flexShrink: 0 }}>+ hrs</button>
                        )}
                        <button onClick={() => { const newSubs = [...ed.subs]; newSubs[pi] = { ...newSubs[pi], subs: newSubs[pi].subs.filter((_, j) => j !== oi) }; setEd(prev => ({ ...prev, subs: newSubs })); }} style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 13, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                      </div>
                      {/* Person assignment */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {shopCrew.map(p => {
                          const sel = op.team.includes(p.id);
                          const busy = !sel && isPersonBusy(p.id, op.start, op.end, pi, oi);
                          const clientName = (clients.find(c => c.id === ed.clientId) || {}).name || "";
                          const jobLocked = !sel && !canAssignPerson(p, op.title, ed.title, ed.jobNumber || "", clientName);
                          const isLead = p.isTeamLead && p.teamNumber;
                          return <button key={p.id} onClick={() => { if (busy || jobLocked) return; updateOp({ team: sel ? [] : [p.id] }); }} title={jobLocked ? "Locked to other work" : busy ? `${p.name} is busy during this period` : isLead ? `${p.name} — Team ${p.teamNumber} Lead` : p.name} style={{ padding: "4px 10px", borderRadius: 8, border: `2px solid ${sel ? p.color : jobLocked ? "#8b5cf633" : busy ? T.danger + "33" : T.border}`, background: sel ? p.color : jobLocked ? "#8b5cf608" : busy ? T.danger + "08" : "transparent", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: sel ? accentText(p.color) : jobLocked ? "#8b5cf688" : busy ? T.danger + "88" : T.textSec, fontWeight: sel ? 700 : 400, cursor: (busy || jobLocked) ? "not-allowed" : "pointer", opacity: (busy || jobLocked) ? 0.4 : 1, transition: "all 0.15s", fontFamily: T.font, whiteSpace: "nowrap", textDecoration: busy ? "line-through" : "none" }}>
                            <span style={{ width: 18, height: 18, borderRadius: 6, background: sel ? p.color + "cc" : jobLocked ? "#8b5cf615" : busy ? T.danger + "15" : p.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: sel ? accentText(p.color) : jobLocked ? "#8b5cf688" : busy ? T.danger + "88" : accentText(p.color), flexShrink: 0 }}>{p.name[0]}</span>
                            {p.name}
                            {isLead && <span style={{ lineHeight: 0, opacity: sel ? 0.85 : 0.6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>}
                            {jobLocked && <span style={{ fontSize: 10 }}>🔒</span>}
                          </button>;
                        })}
                      </div>
                    </div>;
                  })}
                  {/* Add Op button */}
                  <button onClick={() => { const newSubs = [...ed.subs]; newSubs[pi] = { ...newSubs[pi], subs: [...(newSubs[pi].subs || []), { id: null, title: "New Op", start: panel.start, end: panel.end, status: "Not Started", pri: "High", team: [], hpd: 0, notes: "", deps: [] }] }; setEd(prev => ({ ...prev, subs: newSubs })); }} style={{ marginTop: 4, padding: "5px 14px", borderRadius: T.radiusXs, border: `1px dashed ${T.accent}55`, background: T.accent + "08", color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font, width: "100%", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.accent + "18"; e.currentTarget.style.borderColor = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.accent + "08"; e.currentTarget.style.borderColor = T.accent + "55"; }}>
                    + Add Op
                  </button>
                </div>
              </div>)}
            </div>
          </div>}

        <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Notes</label><textarea value={ed.notes} onChange={e => setEd(p => ({ ...p, notes: e.target.value }))} rows={3} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 14, fontFamily: T.font, resize: "vertical", boxSizing: "border-box", outline: "none", transition: "border 0.2s, box-shadow 0.2s", colorScheme: T.colorScheme }} onFocus={e => { e.target.style.borderColor = T.accent + "55"; e.target.style.boxShadow = `0 0 0 3px ${T.accent}15`; }} onBlur={e => { e.target.style.borderColor = T.glassBorder; e.target.style.boxShadow = "none"; }} /></div>
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
          {can("editJobs") && ed.id ? <Btn variant="danger" onClick={() => setConfirmDelete({ title: ed.title, id: ed.id, pid: modal.parentId, extra: closeModal })} style={{ marginRight: "auto" }}>Delete Task</Btn> : <span />}
          <div style={{ display: "flex", gap: 12 }}><Btn variant="ghost" onClick={closeModal}>Cancel</Btn><Btn onClick={() => saveTask(ed, modal.parentId)}>Save Task</Btn></div>
        </div>
      </div></div>; }
    if (modal.type === "detail") { const t = modal.data; if (!t) return null; const fresh = allItems.find(x => x.id === t.id) || t;
      // If this is an operation (level 2), show focused operation popup
      if (fresh.level === 2 || (fresh.isSub && fresh.pid && !tasks.find(x => x.id === fresh.id))) {
        // Find parent panel and job
        let parentPanel = null, parentJob = null;
        for (const job of tasks) {
          for (const panel of (job.subs || [])) {
            const op = (panel.subs || []).find(o => o.id === fresh.id);
            if (op) { parentPanel = panel; parentJob = job; break; }
          }
          if (parentJob) break;
        }
        const opData = parentPanel ? (parentPanel.subs || []).find(o => o.id === fresh.id) || fresh : fresh;
        const assignee = (opData.team || [])[0];
        const person = assignee ? people.find(x => x.id === assignee) : null;
        const health = getHealth(opData);
        const healthColor = HEALTH_DOT[health];
        const healthLabel = health === "ontime" ? "On Time" : health === "behind" ? "Behind" : health === "critical" ? "Late" : "Done";
        const client = parentJob && parentJob.clientId ? clients.find(c => c.id === parentJob.clientId) : null;
        const isOpLocked = opData.locked;
        return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(false), position: "relative", maxWidth: 480 }} onClick={e => e.stopPropagation()}>{cls}
          {/* Health + Lock banner */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <div style={{ flex: 1, background: healthColor + "15", border: `1px solid ${healthColor}33`, borderRadius: T.radiusSm, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: healthColor, boxShadow: `0 0 8px ${healthColor}66` }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: healthColor }}>{healthLabel}</span>
            </div>
            {isOpLocked && <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b33", borderRadius: T.radiusSm, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ lineHeight: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>Locked</span>
            </div>}
          </div>
          {/* Title */}
          <h3 style={{ margin: "0 0 6px", color: T.text, fontSize: 22, fontWeight: 700 }}>{opData.title}{parentPanel ? ` – ${parentPanel.title}` : ""}</h3>
          {parentJob && <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: T.textDim, marginBottom: 6 }}>{parentJob.title}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {parentJob.jobNumber && <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>Task # {parentJob.jobNumber}</span>}
              {parentJob.poNumber && <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98115", border: "1px solid #10b98133", borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>PO # {parentJob.poNumber}</span>}
            </div>
          </div>}
          {/* Assigned person */}
          {person && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: person.color + "0a", borderRadius: T.radiusSm, border: `1px solid ${person.color}33`, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: person.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 700 }}>{person.name[0]}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{person.name}</div>
              <div style={{ fontSize: 12, color: T.textDim }}>{person.role}</div>
            </div>
          </div>}
          {!person && <div style={{ padding: "14px 16px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, marginBottom: 16, fontSize: 14, color: T.textDim, fontStyle: "italic" }}>Unassigned</div>}
          {/* Schedule */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, padding: "12px 14px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Start</div>
              <div style={{ fontSize: 15, color: T.text, fontWeight: 600, fontFamily: T.mono }}>{fm(opData.start)}</div>
            </div>
            <div style={{ flex: 1, padding: "12px 14px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>End</div>
              <div style={{ fontSize: 15, color: T.text, fontWeight: 600, fontFamily: T.mono }}>{fm(opData.end)}</div>
            </div>
            <div style={{ padding: "12px 14px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Hours/Day</div>
              <div style={{ fontSize: 15, color: T.text, fontWeight: 600 }}>{opData.hpd || 8}h</div>
            </div>
          </div>
          {/* Client */}
          {client && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, marginBottom: 16 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: client.color }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{client.name}</span>
            {client.contact && <span style={{ fontSize: 12, color: T.textDim, marginLeft: "auto" }}>{client.contact}</span>}
          </div>}
          {/* Notes / description — always show, editable */}
          {parentJob && <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: T.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Notes</div>
            <textarea defaultValue={parentJob.notes || ""} onBlur={e => updTask(parentJob.id, { notes: e.target.value })} rows={3} placeholder="Add notes…" style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.text, fontSize: 14, padding: "12px 14px", fontFamily: T.font, resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6, transition: "border-color 0.15s" }} onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => { e.target.style.borderColor = T.border; updTask(parentJob.id, { notes: e.target.value }); }} />
          </div>}
          {/* Move Log / Schedule History */}
          {(opData.moveLog || []).length > 0 && <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: T.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Schedule History ({opData.moveLog.length})</div>
            <div style={{ borderRadius: T.radiusSm, border: `1px solid ${T.border}`, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
              {[...(opData.moveLog)].reverse().map((log, i) => {
                const realIdx = opData.moveLog.length - 1 - i;
                return <div key={i} style={{ padding: "10px 14px", background: i % 2 === 0 ? T.surface : "transparent", borderBottom: i < opData.moveLog.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>{log.reason || "Schedule change"}</span>
                    <span style={{ fontSize: 11, color: T.textDim, marginLeft: "auto" }}>{fm(log.date)}</span>
                    {can("undoHistory") && <button onClick={() => {
                      const opId = opData.id;
                      setTasks(prev => prev.map(job => ({ ...job, subs: (job.subs || []).map(panel => ({ ...panel, subs: (panel.subs || []).map(op => {
                        if (op.id !== opId) return op;
                        const newLog = [...(op.moveLog || [])];
                        const entry = newLog[realIdx];
                        if (!entry) return op;
                        newLog.splice(realIdx, 1);
                        const revertEntry = { fromStart: op.start, fromEnd: op.end, toStart: entry.fromStart, toEnd: entry.fromEnd, date: TD, movedBy: loggedInUser ? loggedInUser.name : "Admin", reason: "Undo: " + (entry.reason || "schedule change") };
                        return { ...op, start: entry.fromStart, end: entry.fromEnd, moveLog: [...newLog, revertEntry] };
                      }) })) })));
                      closeModal();
                    }} title="Undo this change" style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: T.textSec, flexShrink: 0, transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#f59e0b"; e.currentTarget.style.color = "#f59e0b"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSec; }}
                    >↩</button>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span style={{ color: T.textDim, fontFamily: T.mono }}>{fm(log.fromStart)} – {fm(log.fromEnd)}</span>
                    <span style={{ color: "#f59e0b" }}>→</span>
                    <span style={{ color: "#f59e0b", fontWeight: 600, fontFamily: T.mono }}>{fm(log.toStart)} – {fm(log.toEnd)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>by {log.movedBy}</div>
                </div>;
              })}
            </div>
          </div>}
          {/* Actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {can("editJobs") && <Btn onClick={() => { closeModal(); if (parentPanel) openEdit(parentJob, null); }}>Edit Job</Btn>}
            {can("lockJobs") && parentPanel && <Btn variant={isOpLocked ? "warn" : "ghost"} onClick={() => { toggleLock(opData.id, parentPanel.id); closeModal(); }}>{isOpLocked ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline",verticalAlign:"middle",marginRight:4 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>Unlock</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline",verticalAlign:"middle",marginRight:4 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Lock</>}</Btn>}
            {parentJob && <Btn variant="ghost" onClick={() => { closeModal(); openDetail(parentJob); }}>View Full Job</Btn>}
          </div>
        </div></div>;
      }
      // Job-level detail (existing)
      const parent = tasks.find(x => x.id === fresh.id);
      return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(true), position: "relative", maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>{cls}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}><HealthIcon t={fresh} size={22} style={{ flexShrink: 0 }} /><h3 style={{ margin: 0, color: T.text, fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{fresh.title}</h3></div>
        {(fresh.jobNumber || fresh.poNumber) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>{fresh.jobNumber && <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>Task # {fresh.jobNumber}</span>}{fresh.poNumber && <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98115", border: "1px solid #10b98133", borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>PO # {fresh.poNumber}</span>}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>{fresh.clientId && <Badge t={"🏢 " + clientName(fresh.clientId)} c={clientColor(fresh.clientId)} lg />}<span style={{ fontSize: 15, color: T.textSec, display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontFamily: T.mono }}>{fm(fresh.start)}</span><span style={{ color: T.textDim }}>→</span><span style={{ fontFamily: T.mono }}>{fm(fresh.end)}</span><span style={{ color: T.textDim }}>·</span>{fresh.hpd}h/day</span></div>
        {fresh.dueDate && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 16px", background: fresh.dueDate < TD ? "#ef444415" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b15" : T.surface, borderRadius: T.radiusSm, border: `1px solid ${fresh.dueDate < TD ? "#ef444433" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b33" : T.border}` }}><span style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>Customer Due Date:</span><span style={{ fontSize: 14, fontWeight: 700, color: fresh.dueDate < TD ? "#ef4444" : fresh.dueDate <= addD(TD, 3) ? "#f59e0b" : T.text, fontFamily: T.mono }}>{fm(fresh.dueDate)}</span>{fresh.dueDate < TD && <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>OVERDUE</span>}</div>}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Notes</div>
          <textarea value={t.notes || ""} onChange={e => setModal(p => ({ ...p, data: { ...p.data, notes: e.target.value } }))} onBlur={e => updTask(fresh.id, { notes: e.target.value })} rows={3} placeholder="Add notes…" style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.text, fontSize: 14, padding: "12px 14px", fontFamily: T.font, resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6, transition: "border-color 0.15s" }} onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => { e.target.style.borderColor = T.border; updTask(fresh.id, { notes: e.target.value }); }} />
        </div>
        {/* Panels and Operations */}
        {parent && (parent.subs || []).length > 0 && <div style={{ marginBottom: 16 }}>
          <h4 style={{ color: T.text, fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>Panels ({parent.subs.length})</h4>
          {parent.subs.map(panel => {
            const hasEng = panel.engineering !== undefined;
            const pEng = panel.engineering || {};
            const engAllDone = hasEng && !!(pEng.designed && pEng.verified && pEng.sentToPerforex);
            const pActiveStep = hasEng ? (!pEng.designed ? "designed" : !pEng.verified ? "verified" : "sentToPerforex") : null;
            return <div key={panel.id} style={{ background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${engAllDone ? "#10b98133" : hasEng ? T.accent + "33" : T.border}`, padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <HealthIcon t={panel} size={14} />
                <span style={{ flex: 1, fontSize: 14, color: T.text, fontWeight: 600, fontFamily: T.mono }}>{panel.title}</span>
                <span style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>{fm(panel.start)} → {fm(panel.end)}</span>
              </div>
              {/* Engineering sign-off row — only for panel jobs */}
              {hasEng && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: T.radiusXs, marginBottom: 8, background: engAllDone ? "#10b98108" : T.accent + "08", border: `1px solid ${engAllDone ? "#10b98133" : T.accent + "22"}`, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, marginRight: 4 }}>ENG:</span>
                {engSteps.map(step => {
                  const done = !!pEng[step.key];
                  const isActive = step.key === pActiveStep;
                  if (done) return <span key={step.key} style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>✓ <span style={{ color: T.textDim }}>{step.label}</span></span>;
                  if (isActive && canSignOffEngineering) return <button key={step.key} onClick={() => signOffEngineering(parent.id, panel.id, step.key)} style={{ padding: "3px 10px", borderRadius: 12, background: T.accent, color: T.accentText, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>;
                  if (isActive) return <span key={step.key} style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>→ {step.label}</span>;
                  return <span key={step.key} style={{ fontSize: 11, color: T.textDim, opacity: 0.4 }}>○ {step.label}</span>;
                })}
                {engAllDone && <span style={{ marginLeft: "auto", fontSize: 11, color: "#10b981", fontWeight: 600 }}>✓ Ready</span>}
              </div>}
              {(panel.subs || []).length > 0 && <div>
                {panel.subs.map(op => { const assignee = (op.team || [])[0]; const person = assignee ? people.find(x => x.id === assignee) : null;
                  return <div key={op.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: T.radiusXs, marginBottom: 4, background: T.bg, border: `1px solid ${T.border}` }}>
                    <HealthIcon t={op} size={12} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.text, minWidth: 50 }}>{op.title}</span>
                    <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(op.start)}–{fm(op.end)}</span>
                    {person && <span style={{ marginLeft: "auto", fontSize: 12, color: person.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 16, height: 16, borderRadius: 6, background: person.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>{person.name[0]}</span>{person.name}</span>}
                    {!person && <span style={{ marginLeft: "auto", fontSize: 11, color: T.textDim, fontStyle: "italic" }}>Unassigned</span>}
                  </div>; })}
              </div>}
            </div>;
          })}
        </div>}
        {can("editJobs") && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Btn onClick={() => { closeModal(); openEdit(fresh, fresh.isSub ? fresh.pid : null); }}>Edit</Btn></div>}
      </div></div>; }
    if (modal.type === "deps") { const item = modal.data; if (!item) return null; const fi = allItems.find(x => x.id === item.id) || item; const others = allItems.filter(x => x.id !== fi.id);
      return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(false), position: "relative" }} onClick={e => e.stopPropagation()}>{cls}
        <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 22, fontWeight: 700 }}>Dependencies</h3>
        <p style={{ fontSize: 14, color: T.textSec, marginBottom: 20 }}>Select tasks that must finish before <strong style={{ color: T.text }}>{fi.title}</strong> starts:</p>
        <div>{others.map(o => { const linked = (fi.deps || []).includes(o.id);
          return <div key={o.id} onClick={() => toggleDep(fi.id, o.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: T.radiusSm, marginBottom: 6, cursor: "pointer", background: linked ? T.accent + "15" : T.surface, border: `1px solid ${linked ? T.accent + "66" : T.border}` }}><span style={{ fontSize: 18 }}>{linked ? "🔗" : "⚪"}</span><div style={{ flex: 1 }}><div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{o.isSub ? "↳ " : ""}{o.title}</div><div style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono, marginTop: 2 }}>{fm(o.start)} – {fm(o.end)}</div></div>{linked && <Btn variant="danger" size="sm" onClick={e => { e.stopPropagation(); toggleDep(fi.id, o.id); }}>Unlink</Btn>}</div>; })}</div>
      </div></div>; }
    if (modal.type === "avail") return <AvailModal people={people} allItems={allItems} bookedHrs={bookedHrs} onClose={closeModal} isMobile={isMobile} onStartTask={(personId, start, end, hpd) => {
      closeModal();
      setModal({ type: "edit", data: { id: null, title: "", start, end, pri: "Medium", status: "Not Started", team: [personId], color: T.accent, hpd, notes: "", subs: [], deps: [], clientId: null, useMatrix: true }, parentId: null });
    }} />;
    return null;
  };

  // ═══════════════════ LOADING / AUTH GATE ═══════════════════
  if (dataLoading || !loggedInUser) {
    return (
      <div className={`traqs-${themeMode}`} style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: `3px solid ${T.accent}33`, borderTop: `3px solid ${T.accent}`, animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }} />
          <div style={{ fontSize: 14, color: T.textDim }}>Loading TRAQS…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Filter out admin users from the shop crew display (they don't get assigned tasks)
  const shopPeople = people.filter(p => p.userRole === "user");

  return <div className={`traqs-${themeMode}`} style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: T.font, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    {/* Slim search bar */}
    {!isMobile && <div style={{ padding: "10px 32px 8px", display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, borderBottom: `1px solid ${T.border}22`, gap: 8 }}>
      <div ref={searchRef} style={{ position: "relative", flex: 1, maxWidth: askExpanded ? 360 : 480, transition: "max-width 0.28s cubic-bezier(0.22,1,0.36,1)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 20, border: `1px solid ${searchOpen ? T.accent + "66" : T.border}`, background: T.bg, transition: "all 0.2s" }}>
          <span style={{ lineHeight: 0, color: T.textDim }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <input value={searchQ} onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }} onFocus={() => { if (searchQ) setSearchOpen(true); }} placeholder="Search jobs, clients, team members..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12, fontFamily: T.font }} />
          {searchQ && <span onClick={() => { setSearchQ(""); setSearchOpen(false); }} style={{ cursor: "pointer", fontSize: 10, color: T.textDim, padding: "1px 5px", borderRadius: 4, background: T.border + "44" }}>✕</span>}
        </div>
        {searchOpen && searchQ.length > 0 && (() => {
          const q = searchQ.toLowerCase();
          const jobResults = allItems.filter(t => t.title.toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q));
          const clientResults = clients.filter(c => c.name.toLowerCase().includes(q) || (c.contact || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q));
          const personResults = people.filter(p => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q));
          const hasResults = jobResults.length > 0 || clientResults.length > 0 || personResults.length > 0;
          return <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 9999, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, boxShadow: "0 16px 48px rgba(0,0,0,0.25)", maxHeight: 380, overflow: "auto" }}>
            {!hasResults && <div style={{ padding: "24px 16px", textAlign: "center", color: T.textDim, fontSize: 14 }}>No results for \"{searchQ}\"</div>}
            {personResults.length > 0 && <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Team Members</div>
              {personResults.slice(0, 5).map(p => <div key={p.id} onClick={() => { setSearchQ(""); setSearchOpen(false); switchView("schedule"); }} style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: T.textDim }}>{p.role}</span>
              </div>)}
            </div>}
            {clientResults.length > 0 && <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", borderTop: personResults.length > 0 ? `1px solid ${T.border}` : "none" }}>Clients</div>
              {clientResults.slice(0, 5).map(c => <div key={c.id} onClick={() => { setSearchQ(""); setSearchOpen(false); switchView("clients"); setSelClient(c.id); }} style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: c.color }} />
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                {c.contact && <span style={{ fontSize: 12, color: T.textDim }}>{c.contact}</span>}
              </div>)}
            </div>}
            {jobResults.length > 0 && <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", borderTop: (personResults.length > 0 || clientResults.length > 0) ? `1px solid ${T.border}` : "none" }}>Jobs</div>
              {jobResults.slice(0, 8).map(t => { const owner = people.find(p => p.id === (t.team || [])[0]); return <div key={t.id} onClick={() => { setSearchQ(""); setSearchOpen(false); openDetail(t); }} style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <HealthIcon t={t} size={10} />
                <span style={{ fontWeight: 500, flex: 1 }}>{t.title}</span>
                {owner && <span style={{ fontSize: 12, color: T.textDim }}>{owner.name}</span>}
                <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(t.start)}</span>
              </div>; })}
            </div>}
          </div>;
        })()}
      </div>
      {/* Ask TRAQS companion bar */}
      <div ref={askBarRef} style={{ position: "relative", flexShrink: 0, width: askExpanded ? 300 : 130, transition: "width 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        {!askExpanded
          ? <button onClick={() => { setAskExpanded(true); setTimeout(() => askBarInputRef.current?.focus(), 50); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 20, border: `1px solid ${T.accent}44`, background: `linear-gradient(135deg, ${T.accent}12, ${T.accent}06)`, color: T.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font, letterSpacing: "0.02em", whiteSpace: "nowrap", transition: "all 0.18s" }} onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}22, ${T.accent}10)`; e.currentTarget.style.borderColor = T.accent + "88"; }} onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}12, ${T.accent}06)`; e.currentTarget.style.borderColor = T.accent + "44"; }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              Ask TRAQS
            </button>
          : <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 20, border: `1px solid ${T.accent}66`, background: T.bg, boxShadow: `0 0 0 2px ${T.accent}18` }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill={T.accent} style={{ flexShrink: 0 }}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              <input ref={askBarInputRef} value={askBarQ} onChange={e => setAskBarQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && askBarQ.trim()) { const q = askBarQ.trim(); setAskBarQ(""); setAskExpanded(false); setAskHistory(h => [...h, { role: "user", content: q }]); setAskOpen(true); setAskLoading(true); handleAskTraqs(q); } if (e.key === "Escape") { setAskExpanded(false); setAskBarQ(""); } }} placeholder="Ask anything…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12, fontFamily: T.font, minWidth: 0 }} />
              {askBarQ && <span onClick={() => setAskBarQ("")} style={{ cursor: "pointer", fontSize: 10, color: T.textDim, padding: "1px 5px", borderRadius: 4, background: T.border + "44", flexShrink: 0 }}>✕</span>}
            </div>
        }
      </div>
    </div>}
    {/* Main nav bar */}
    {!isMobile && <div className="anim-header" style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, position: "relative", zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={UL_LOGO_WHITE} alt="TRAQS" style={{ height: 32, objectFit: "contain", display: "block", filter: T.colorScheme === "dark" ? "none" : "brightness(0)" }} />
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${canUndo ? T.border : "transparent"}`, background: canUndo ? T.bg : "transparent", cursor: canUndo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: canUndo ? 1 : 0.3, transition: "all 0.15s", color: T.textSec }}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${canRedo ? T.border : "transparent"}`, background: canRedo ? T.bg : "transparent", cursor: canRedo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: canRedo ? 1 : 0.3, transition: "all 0.15s", color: T.textSec }}>↪</button>
        </div>
      </div>
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, background: T.bg, borderRadius: T.radiusSm, padding: 3, isolation: "isolate" }}>
        {/* Sliding pill — repositioned via refs, animates on view change */}
        <div ref={navPillRef} style={{ position: "absolute", top: 3, bottom: 3, left: 0, borderRadius: T.radiusXs, background: T.accent, boxShadow: `0 4px 18px ${T.accent}55`, zIndex: 0, pointerEvents: "none" }} />
        {views.map(v => (
          <button key={v.id} ref={el => { navBtnRefs.current[v.id] = el; }} onClick={() => switchView(v.id)}
            style={{ position: "relative", zIndex: 1, padding: "8px 16px", borderRadius: T.radiusXs, border: "none", fontSize: 13, fontWeight: view === v.id ? 700 : 400, cursor: "pointer", fontFamily: T.font, background: "transparent", color: view === v.id ? T.accentText : T.text, transition: "color 0.3s ease, font-weight 0.2s ease", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            {v.icon}{v.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div onClick={() => doSave()} title="Click to save now" style={{ marginRight: 2, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", opacity: 0.85 }}>
            {saveStatus === "saving"
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.5" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              : saveStatus === "saved"
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20 6L9 17l-5-5"/></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.textSec} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
            <span style={{ fontSize: 11, fontWeight: 500, color: saveStatus === "saved" ? "#10b981" : saveStatus === "saving" ? T.accent : T.textSec }}>{saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Unsaved"}</span>
          </div>
          <div style={{ width: 30, height: 30, borderRadius: 15, background: loggedInUser.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700 }}>{loggedInUser.name[0]}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{loggedInUser.name}</div>
            <div style={{ fontSize: 10, color: isAdmin ? T.accent : T.textDim }}>{isAdmin ? "Admin" : "Crew"}</div>
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: T.border, margin: "0 4px" }} />
        {/* Notification Bell */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button onClick={e => { e.stopPropagation(); setNotifOpen(p => !p); }} title="Notifications" style={{ position: "relative", background: notifOpen ? T.accent + "15" : "transparent", border: `1px solid ${notifOpen ? T.accent + "44" : T.border}`, borderRadius: T.radiusSm, padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={notifOpen ? T.accent : T.textSec} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            {unreadByThread.length > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 8, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{unreadByThread.length > 9 ? "9+" : unreadMessages.length}</span>}
          </button>
          {notifOpen && <div onClick={e => e.stopPropagation()} style={{ position: "fixed", right: 80, top: 60, width: 320, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", zIndex: 9999, overflow: "hidden", fontFamily: T.font }}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase" }}>Notifications</div>
              {unreadByThread.length > 0 && <button onClick={() => { const all = {}; messages.forEach(m => { all[m.threadKey] = new Date().toISOString(); }); setLastRead(p => ({ ...p, ...all })); localStorage.setItem("tq_last_read", JSON.stringify({ ...lastRead, ...all })); }} style={{ background: "none", border: "none", fontSize: 11, color: T.accent, cursor: "pointer", fontFamily: T.font }}>Mark all read</button>}
            </div>
            {unreadByThread.length === 0 ? (
              <div style={{ padding: "28px 18px", textAlign: "center", color: T.textDim, fontSize: 13 }}>All caught up! 🎉</div>
            ) : unreadByThread.map(item => {
              const title = getThreadTitle(item.threadKey, item.scope, item.jobId, item.panelId, item.opId);
              const author = people.find(p => p.id === item.latest.authorId);
              return <div key={item.threadKey} onClick={() => {
                const gId = item.scope === "group" ? item.threadKey.replace("group:", "") : null;
                const participants = getThreadParticipants(item.scope, item.jobId, item.panelId, item.opId, gId);
                setChatThread({ threadKey: item.threadKey, title, scope: item.scope, jobId: item.jobId, panelId: item.panelId, opId: item.opId, groupId: gId, participants });
                setView("messages"); setNotifOpen(false); markThreadRead(item.threadKey);
              }} style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: T.accent, flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                    <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0, marginLeft: 8 }}>{item.count} new</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>{item.latest.authorName}:</strong> {item.latest.text}</div>
                </div>
              </div>;
            })}
          </div>}
        </div>
        {/* Settings Gear */}
        <div ref={settingsRef} style={{ position: "relative" }}>
          <button onClick={e => { e.stopPropagation(); setSettingsOpen(p => !p); }} style={{ background: settingsOpen ? T.accent + "15" : "transparent", border: `1px solid ${settingsOpen ? T.accent + "44" : T.border}`, borderRadius: T.radiusSm, padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={settingsOpen ? T.accent : T.textSec} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.3s", transform: settingsOpen ? "rotate(90deg)" : "none" }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          {settingsOpen && <div onClick={e => e.stopPropagation()} style={{ position: "fixed", right: 32, top: 60, minWidth: 260, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", zIndex: 9999, overflow: "hidden", fontFamily: T.font }}>
            <div style={{ padding: "12px 16px 8px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase" }}>Settings</div>
            </div>
            {/* ── Theme picker ── */}
            <div style={{ padding: "12px 16px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Theme</div>
              <div style={{ display: "flex", gap: 7 }}>
                {[
                  { id: "midnight", label: "Dark",   bg: "#080d18", accent: "#3d7fff" },
                  { id: "frost",    label: "White",  bg: "#f0f4f9", accent: "#0ea5e9" },
                  { id: "custom",   label: "Custom", bg: customTheme.bg, accent: customTheme.accent },
                ].map(th => {
                  const active = themeMode === th.id;
                  return <button key={th.id} onClick={() => setThemeMode(th.id)} title={th.label}
                    style={{ flex: 1, padding: "10px 4px 8px", background: th.bg, border: `2px solid ${active ? th.accent : "transparent"}`, borderRadius: T.radiusXs, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "border 0.18s, transform 0.18s", transform: active ? "scale(1.06)" : "scale(1)" }}>
                    {th.id === "custom"
                      ? <div style={{ width: 18, height: 18, borderRadius: 9, background: "conic-gradient(#f43f5e,#f59e0b,#10b981,#3d7fff,#7c3aed,#f43f5e)", boxShadow: active ? `0 0 8px ${th.accent}88` : "none", transition: "box-shadow 0.18s" }} />
                      : <div style={{ width: 18, height: 18, borderRadius: 9, background: th.accent, boxShadow: active ? `0 0 8px ${th.accent}88` : "none", transition: "box-shadow 0.18s" }} />}
                    <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? th.accent : "#888", letterSpacing: "0.02em" }}>{th.label}</span>
                  </button>;
                })}
              </div>

              {/* ── Custom color pickers (shown when Custom is active) ── */}
              {themeMode === "custom" && <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12 }}>Customize</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { key: "bg",     label: "Background", sub: "App background & surfaces" },
                    { key: "accent", label: "Accent",     sub: "Buttons, highlights & indicators" },
                  ].map(({ key, label, sub }) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <label style={{ position: "relative", width: 38, height: 38, borderRadius: T.radiusXs, border: `2px solid ${T.borderLight}`, overflow: "hidden", cursor: "pointer", flexShrink: 0, display: "block" }}
                        title={`Pick ${label}`}>
                        <div style={{ width: "100%", height: "100%", background: customTheme[key] }} />
                        <input type="color" value={customTheme[key]}
                          onChange={e => setCustomTheme(p => ({ ...p, [key]: e.target.value }))}
                          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                      </label>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>{sub}</div>
                      </div>
                      <div style={{ marginLeft: "auto", fontSize: 11, color: T.textDim, fontFamily: "'JetBrains Mono',monospace" }}>{customTheme[key]}</div>
                    </div>
                  ))}
                </div>
              </div>}
            </div>
            <button onClick={() => { setSettingsOpen(false); setUsersOpen(true); setSettingsUser(null); }} style={{ width: "100%", padding: "11px 16px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 11, fontFamily: T.font, textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "11"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", color: T.textSec, lineHeight: 0 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Users</div>
                <div style={{ fontSize: 11, color: T.textDim }}>Manage permissions & access</div>
              </div>
            </button>
            <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
            <button onClick={() => { setSettingsOpen(false); setConfirmLogout(true); }} style={{ width: "100%", padding: "11px 16px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 11, fontFamily: T.font, textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = "#ef444411"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", lineHeight: 0 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>Log Out</div>
                <div style={{ fontSize: 11, color: T.textDim }}>{loggedInUser.name}</div>
              </div>
            </button>
          </div>}
        </div>
      </div>
    </div>}
    <div style={{ padding: isMobile ? "0" : view === "messages" ? "0" : "28px 32px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: view === "messages" ? "hidden" : "auto" }}>
      {isMobile ? renderMobileApp() : <AnimatedView viewKey={view} style={view === "messages" ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" } : undefined}>{view === "schedule" && renderTeam()}{view === "tasks" && <div style={{ flex: 1 }}>{renderTasks()}</div>}{view === "clients" && <div style={{ flex: 1 }}>{renderClients()}</div>}{view === "analytics" && renderAnalytics()}{view === "messages" && renderMessages()}</AnimatedView>}
    </div>
    {/* Team day-view drag ghost */}
    {teamDayGhost && <>
      <div style={{ position: "fixed", left: teamDayGhost.left, top: teamDayGhost.top, width: teamDayGhost.width, height: teamDayGhost.height, background: teamDayGhost.color, borderRadius: T.radiusXs, display: "flex", alignItems: "center", padding: "0 10px", overflow: "hidden", boxShadow: `0 8px 24px ${teamDayGhost.color}66, 0 0 0 2px rgba(255,255,255,0.3)`, opacity: 0.88, pointerEvents: "none", zIndex: 9999, border: "1.5px solid rgba(255,255,255,0.35)" }}>
        <span style={{ fontSize: 10, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{teamDayGhost.label}</span>
      </div>
      {teamDayGhost.time && <div style={{ position: "fixed", left: teamDayGhost.left, top: teamDayGhost.top - 24, background: "rgba(10,10,20,0.92)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, pointerEvents: "none", zIndex: 10000, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", border: `1px solid ${teamDayGhost.color}88`, backdropFilter: "blur(4px)", fontFamily: T.mono }}>{teamDayGhost.time}</div>}
    </>}
    {/* Ask TRAQS Panel */}
    {askOpen && <div style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", justifyContent: "flex-end" }} onClick={() => setAskOpen(false)}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: "95vw", height: "100%", background: T.card, borderLeft: `1px solid ${T.borderLight}`, display: "flex", flexDirection: "column", boxShadow: "-24px 0 80px rgba(0,0,0,0.5)", animation: "slideInRight 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${T.accent}33, ${T.accent}18)`, border: `1px solid ${T.accent}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={T.accent}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>Ask TRAQS</div>
            <div style={{ fontSize: 11, color: T.textDim }}>AI scheduling assistant</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {(askHistory.length > 0 || pendingActions) && <button onClick={() => { setAskHistory([]); setPendingActions(null); }} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, fontSize: 11, padding: "3px 8px", cursor: "pointer", fontFamily: T.font }}>Clear</button>}
            <button onClick={() => setAskOpen(false)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
          </div>
        </div>
        {/* Conversation */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {askHistory.length === 0 && <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "40px 0" }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: `linear-gradient(135deg, ${T.accent}33, ${T.accent}18)`, border: `1px solid ${T.accent}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill={T.accent}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
            </div>
            <div style={{ textAlign: "center", maxWidth: 300 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>What can I help you with?</div>
              <div style={{ fontSize: 13, color: T.textSec, lineHeight: 1.6 }}>Ask about workloads, scheduling conflicts, job assignments, or anything about your team's capacity.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 320 }}>
              {["Who is overbooked this week?", "Which jobs are at risk of running late?", "Who has capacity to take on more work?", "Mark [job name] as finished", "Assign [person] to [job]"].map(s => <button key={s} onClick={() => { setAskQ(s); askInputRef.current?.focus(); }} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: "9px 14px", cursor: "pointer", fontSize: 12, color: T.textSec, textAlign: "left", fontFamily: T.font, transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent + "66"; e.currentTarget.style.color = T.text; }} onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSec; }}>{s}</button>)}
            </div>
          </div>}
          {askHistory.map((msg, i) => {
            // Don't render tool_result user messages (internal plumbing)
            if (msg.role === "user" && Array.isArray(msg.content)) return null;
            // For assistant messages, extract only text blocks
            const displayText = Array.isArray(msg.content)
              ? msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim()
              : msg.content;
            if (!displayText) return null;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
                <div style={{ fontSize: 10, color: T.textDim, marginBottom: 2, padding: "0 4px" }}>{msg.role === "user" ? "You" : "TRAQS AI"}</div>
                <div style={{ maxWidth: "88%", padding: "11px 14px", borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px", background: msg.role === "user" ? T.accent : T.surface, color: msg.role === "user" ? T.accentText : T.text, fontSize: 13, lineHeight: 1.65, border: msg.role === "user" ? "none" : `1px solid ${T.border}`, whiteSpace: "pre-wrap" }}>
                  {displayText}
                </div>
              </div>
            );
          })}
          {askLoading && <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ padding: "11px 14px", borderRadius: "4px 16px 16px 16px", background: T.surface, border: `1px solid ${T.border}`, display: "flex", gap: 5, alignItems: "center" }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: 3, background: T.accent, animation: `bounce 1.2s ease-in-out ${i*0.18}s infinite` }}/>)}
            </div>
          </div>}
        </div>
        {/* Pending Actions confirmation card */}
        {pendingActions && (
          <div style={{ margin: "0 16px 12px", background: T.surface, border: `1px solid ${T.accent}55`, borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ padding: "10px 14px 8px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "0.05em", textTransform: "uppercase" }}>TRAQS wants to</div>
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              {pendingActions.toolUses.map((tu, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.text }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.textSec, flexShrink: 0, marginTop: 5 }} />
                  <span>{describeAction(tu.name, tu.input)}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "8px 14px 14px", display: "flex", gap: 8 }}>
              <button onClick={() => setPendingActions(null)} style={{ flex: 1, padding: "8px 0", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: "transparent", color: T.textSec, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
              <button onClick={executeConfirmedActions} style={{ flex: 2, padding: "8px 0", borderRadius: T.radiusSm, border: "none", background: T.accent, color: T.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>Confirm & Apply</button>
            </div>
          </div>
        )}
        {/* Input */}
        <div style={{ padding: "14px 20px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: "10px 12px", transition: "border 0.15s", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.08)" }}>
            <textarea ref={askInputRef} value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={async e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await handleAskTraqs(); } }} placeholder="Ask anything about your schedule…" rows={2} style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 13, color: T.text, fontFamily: T.font, lineHeight: 1.55 }} />
            <button onClick={handleAskTraqs} disabled={!askQ.trim() || askLoading} style={{ width: 34, height: 34, borderRadius: 10, background: askQ.trim() && !askLoading ? T.accent : T.border, border: "none", cursor: askQ.trim() && !askLoading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={askQ.trim() && !askLoading ? T.accentText : T.textDim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <div style={{ fontSize: 10, color: T.textDim, marginTop: 6, textAlign: "center" }}>Enter to send · Shift+Enter for new line</div>
        </div>
      </div>
    </div>}
    {renderModal()}
    {saveTemplateModal && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
        zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        onClick={() => setSaveTemplateModal(false)}>
        <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 16, padding: 28,
          maxWidth: 400, width: "100%", border: `1px solid ${T.borderLight}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)", position: "relative" }}>
          <h3 style={{ margin: "0 0 16px", color: T.text, fontSize: 18, fontWeight: 700 }}>Save Template</h3>
          <InputField label="Template Name" value={templateNameInput} onChange={v => setTemplateNameInput(v)}
            placeholder='e.g. Standard 3-Op, Riverside Job' />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={() => setSaveTemplateModal(false)} style={{ flex: 1, padding: "10px 0", borderRadius: T.radiusSm,
              border: `1px solid ${T.border}`, background: "transparent", color: T.textSec,
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
            <button disabled={!templateNameInput.trim()}
              onClick={() => {
                const name = templateNameInput.trim();
                if (!name) return;
                const ops = (modal?.data?.customOps || []).filter(o => o.title?.trim());
                persistTemplates([...templates, { id: uid(), name, ops }]);
                setSaveTemplateModal(false);
              }}
              style={{ flex: 1, padding: "10px 0", borderRadius: T.radiusSm, border: "none",
                background: templateNameInput.trim() ? T.accent : T.border, color: T.accentText,
                fontSize: 13, fontWeight: 700,
                cursor: templateNameInput.trim() ? "pointer" : "not-allowed", fontFamily: T.font }}>
              Save
            </button>
          </div>
        </div>
      </div>
    )}
    {/* Users Modal */}
    {usersOpen && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 2000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }}>
      <div className="anim-modal-box" onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 16, padding: 0, width: "100%", maxWidth: 580, border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", overflow: "hidden", position: "relative" }}>
        {/* Header */}
        <div style={{ padding: "24px 28px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: T.text }}>Users</h3>
          <button onClick={() => setUsersOpen(false)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </div>
        {/* Content */}
        <div style={{ padding: "20px 28px 28px" }}>
          <div>
            <div style={{ marginBottom: 14, fontSize: 12, color: T.textDim }}>Click a user to manage their permissions. New users have no permissions until explicitly granted.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...people].sort((a, b) => a.name.localeCompare(b.name)).map(person => {
                const isSelected = settingsUser === person.id;
                const isAdm = person.userRole === "admin";
                const permsEnabled = perm => person.adminPerms == null || person.adminPerms[perm] === true;
                const togglePerm = (key, val) => updPerson(person.id, { adminPerms: { ...(person.adminPerms || {}), [key]: val } });
                return <div key={person.id}>
                  {/* Person row */}
                  <div onClick={() => setSettingsUser(isSelected ? null : person.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: T.radiusSm, background: isSelected ? T.accent + "10" : T.surface, border: `1px solid ${isSelected ? T.accent + "44" : T.border}`, cursor: "pointer", transition: "all 0.15s" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: person.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{person.name[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.name}</div>
                      <div style={{ fontSize: 11, color: T.textDim }}>{person.role || "No role"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {isAdm && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: T.accent + "20", color: T.accent, border: `1px solid ${T.accent}33` }}>Admin</span>}
                      {person.isEngineer && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: T.accent + "20", color: T.accent, border: `1px solid ${T.accent}33` }}>Eng</span>}
                      {person.noAutoSchedule && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b33" }}>No Auto</span>}
                      {(person.jobTags || []).length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "#8b5cf620", color: "#8b5cf6", border: "1px solid #8b5cf633" }}>
                          🔒 {person.jobTags.length} tag{person.jobTags.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <span style={{ color: T.textDim, fontSize: 12, marginLeft: 4 }}>{isSelected ? "▲" : "▼"}</span>
                  </div>
                  {/* Expanded permissions */}
                  {isSelected && <div style={{ margin: "2px 0 4px", padding: "14px 16px", background: T.bg, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Admin toggle */}
                    <div onClick={() => updPerson(person.id, { userRole: isAdm ? "user" : "admin", adminPerms: isAdm ? undefined : {} })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${isAdm ? T.accent + "44" : T.border}`, background: isAdm ? T.accent + "08" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ lineHeight: 0, color: isAdm ? T.accent : T.textDim }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Admin Capabilities</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>Full control over jobs and team</div>
                      </div>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: isAdm ? T.accent : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: 2, left: isAdm ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                      </div>
                    </div>
                    {/* Sub-permissions when admin */}
                    {isAdm && <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      {ADMIN_PERMS.map(({ key, icon, label }) => {
                        const on = permsEnabled(key);
                        return <div key={key} onClick={() => togglePerm(key, !on)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: T.radiusXs, cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span style={{ fontSize: 13, width: 18, textAlign: "center", flexShrink: 0 }}>{icon}</span>
                          <span style={{ flex: 1, fontSize: 12, color: on ? T.text : T.textDim, fontWeight: on ? 500 : 400 }}>{label}</span>
                          <div style={{ width: 28, height: 16, borderRadius: 8, background: on ? T.accent : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                            <div style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: 6, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} />
                          </div>
                        </div>;
                      })}
                    </div>}
                    {/* Engineering toggle */}
                    <div onClick={() => updPerson(person.id, { isEngineer: !person.isEngineer })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${person.isEngineer ? T.accent + "44" : T.border}`, background: person.isEngineer ? T.accent + "08" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ lineHeight: 0, color: person.isEngineer ? T.accent : T.textDim }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Engineering Sign-Off Access</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>Can sign off Design, Verify & Perforex steps</div>
                      </div>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: person.isEngineer ? T.accent : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: 2, left: person.isEngineer ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                      </div>
                    </div>
                    {/* No Auto-Schedule toggle */}
                    <div onClick={() => updPerson(person.id, { noAutoSchedule: !person.noAutoSchedule })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${person.noAutoSchedule ? "#f59e0b44" : T.border}`, background: person.noAutoSchedule ? "#f59e0b08" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ lineHeight: 0, color: person.noAutoSchedule ? "#f59e0b" : T.textDim }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Exclude from Auto-Scheduling</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>Never auto-assigned by the scheduler</div>
                      </div>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: person.noAutoSchedule ? "#f59e0b" : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: 2, left: person.noAutoSchedule ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                      </div>
                    </div>
                    {/* Job Restrictions */}
                    <div style={{ padding: "10px 10px 12px", borderRadius: T.radiusXs, border: `1px solid ${(person.jobTags || []).length ? "#8b5cf644" : T.border}`, background: (person.jobTags || []).length ? "#8b5cf608" : T.surface }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ lineHeight: 0, color: (person.jobTags || []).length ? "#8b5cf6" : T.textDim }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Task Claims</div>
                          <div style={{ fontSize: 11, color: T.textDim }}>Tags this person exclusively owns (e.g. "Wire", "Riverside")</div>
                        </div>
                      </div>
                      {(person.jobTags || []).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                          {(person.jobTags || []).map((tag, ti) => (
                            <span key={ti} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: "#8b5cf615", border: "1px solid #8b5cf633", fontSize: 12, color: "#8b5cf6", fontWeight: 600 }}>
                              {tag}
                              <button onClick={() => updPerson(person.id, { jobTags: (person.jobTags || []).filter((_, j) => j !== ti) })} style={{ background: "none", border: "none", color: "#8b5cf6", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 15 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={tagInputs[person.id] || ""}
                          onChange={e => setTagInputs(p => ({ ...p, [person.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              const tag = (tagInputs[person.id] || "").trim();
                              if (tag && !(person.jobTags || []).includes(tag)) {
                                updPerson(person.id, { jobTags: [...(person.jobTags || []), tag] });
                                setTagInputs(p => ({ ...p, [person.id]: "" }));
                              }
                            }
                          }}
                          placeholder='e.g. Wire, Riverside'
                          style={{ flex: 1, padding: "5px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, boxSizing: "border-box" }}
                        />
                        <button onClick={() => {
                          const tag = (tagInputs[person.id] || "").trim();
                          if (tag && !(person.jobTags || []).includes(tag)) {
                            updPerson(person.id, { jobTags: [...(person.jobTags || []), tag] });
                            setTagInputs(p => ({ ...p, [person.id]: "" }));
                          }
                        }} style={{ padding: "5px 12px", borderRadius: T.radiusXs, border: "1px solid #8b5cf644", background: "#8b5cf610", color: "#8b5cf6", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>}
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>}
    {/* TRAQS Information Upload Modal */}
    {uploadModal && <div className="anim-modal-overlay" onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 24 }}>

      {/* ── Phase 1: FAST TRAQS splash intro ─────────────────────────── */}
      {fastTraqsPhase === "intro" && (
        <div className={fastTraqsExiting ? "ft-intro-exit" : "ft-intro-enter"} onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: isMobile ? 18 : 24, padding: isMobile ? "24px 20px 20px" : "44px 36px 36px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto", border: `1px solid ${T.accent}44`, boxShadow: `0 48px 120px rgba(0,0,0,0.75), 0 0 80px ${T.accent}18`, textAlign: "center", position: "relative" }}>
          {/* Ambient glow orb */}
          {!isMobile && <div style={{ position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)", width: 400, height: 400, background: `radial-gradient(circle, ${T.accent}18 0%, transparent 65%)`, pointerEvents: "none" }} />}
          {/* Close */}
          <button onClick={() => { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); }} style={{ position: "absolute", top: isMobile ? 14 : 20, right: isMobile ? 16 : 24, width: 32, height: 32, borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, zIndex: 2 }}>✕</button>

          {/* TRAQS Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: isMobile ? 12 : 28 }}>
            <img src={UL_LOGO_WHITE} alt="TRAQS" style={{ height: isMobile ? 30 : 40, objectFit: "contain", filter: T.colorScheme === "dark" ? "none" : "brightness(0)" }} />
          </div>

          {/* Title */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 26 : 36, fontWeight: 900, color: T.accent, letterSpacing: "-0.02em", fontFamily: T.font, textShadow: `0 0 28px ${T.accent}77` }}>FAST TRAQS</h2>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: isMobile ? 13 : 15, fontWeight: 600, color: T.text, fontFamily: T.font }}>Your Entire Schedule, Imported in Seconds</p>
          <p style={{ margin: isMobile ? "0 0 16px" : "0 0 32px", fontSize: 12, color: T.textSec, fontFamily: T.font, lineHeight: 1.6, maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
            Drop in any spreadsheet or document and FAST TRAQS instantly reads every job, assigns work to the right people, adds clients, and builds your full schedule — no manual entry needed.
          </p>

          {/* Feature grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 8 : 10, marginBottom: isMobile ? 16 : 32, textAlign: "left" }}>
            {[
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, title: "Bulk Job Updates",  desc: "Update POs, status, due dates across jobs in plain text" },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title: "Team Members",      desc: "Detects people and assigns them to roles" },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg>, title: "Clients",           desc: "Identifies and imports contacts" },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, title: "Your Timeline",     desc: "Builds your full schedule automatically" },
            ].map((f, i) => (
              <div key={f.title} style={{ background: T.bg, borderRadius: isMobile ? 10 : 14, padding: isMobile ? "10px 12px" : "14px 16px", border: `1px solid ${T.border}`, animation: `ftFeaturePop 0.5s cubic-bezier(0.34,1.56,0.64,1) ${0.12 + i * 0.08}s both` }}>
                <div style={{ width: isMobile ? 18 : 24, height: isMobile ? 18 : 24, marginBottom: isMobile ? 4 : 6, color: T.accent }}>{cloneElement(f.icon, { width: isMobile ? 18 : 24, height: isMobile ? 18 : 24 })}</div>
                <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: T.text, fontFamily: T.font, marginBottom: 2 }}>{f.title}</div>
                <div style={{ fontSize: isMobile ? 11 : 12, color: T.textSec, fontFamily: T.font, lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            ))}
          </div>

          {/* BEGIN button */}
          <button
            onClick={() => { setFastTraqsExiting(true); setTimeout(() => { setFastTraqsPhase("input"); setFastTraqsExiting(false); }, 420); }}
            style={{ width: "100%", padding: isMobile ? "14px 0" : "17px 0", borderRadius: 16, border: "none", background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, color: T.accentText, fontSize: isMobile ? 16 : 18, fontWeight: 900, cursor: "pointer", fontFamily: T.font, letterSpacing: "0.06em", animation: "glow-pulse 2.4s ease-in-out infinite", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, transition: "transform 0.15s ease" }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1.02)"}
          >
            BEGIN
          </button>
        </div>
      )}

      {/* ── Phase 2: Input form ───────────────────────────────────────── */}
      {fastTraqsPhase === "input" && (
        <div className="ft-input-enter" onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 20, padding: 0, width: "100%", maxWidth: 620, maxHeight: "88vh", overflow: "auto", border: `1px solid ${T.accent}33`, boxShadow: `0 40px 100px rgba(0,0,0,0.65), 0 0 50px ${T.accent}14` }}>
          {/* Header */}
          <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setFastTraqsPhase("intro")} title="Back" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, flexShrink: 0 }}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: T.accent, fontFamily: T.font, letterSpacing: "0.04em" }}>FAST TRAQS</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSec, fontFamily: T.font, marginTop: 1 }}>Drop in your Excel or CSV file — FAST TRAQS detects jobs, panels, and assignments automatically</div>
            </div>
            <button onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, flexShrink: 0 }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: "20px 24px" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Paste information or describe changes</label>
            <textarea value={uploadText} onChange={e => setUploadText(e.target.value)}
              placeholder={"Paste scheduling data, job details, or describe updates to existing jobs...\n\nExamples:\n• Team: Alex, Jordan, Morgan\n  Job 10055 for Riverside Electric, due Mar 15\n  2 panels, Wire→Cut→Layout each 2 days\n\n• Add PO-45123 to job 10042\n• Mark Riverside Pump Station as In Progress\n• Set due date for job 10055 to March 15"}
              style={{ width: "100%", minHeight: 130, padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, resize: "vertical", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }} disabled={uploadProcessing} />

            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Or upload files</label>
              <div style={{ border: `2px dashed ${T.border}`, borderRadius: T.radiusSm, padding: "14px 16px", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }} onClick={() => document.getElementById("traqs-file-input").click()} onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }} onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }} onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; const files = Array.from(e.dataTransfer.files); setUploadFiles(prev => [...prev, ...files]); }}>
                <input id="traqs-file-input" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt,.png,.jpg,.jpeg" style={{ display: "none" }} onChange={e => { const files = Array.from(e.target.files); setUploadFiles(prev => [...prev, ...files]); e.target.value = ""; }} />
              <input id="traqs-camera-input" type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { const files = Array.from(e.target.files); setUploadFiles(prev => [...prev, ...files]); e.target.value = ""; }} />
                <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                <div style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>Drop files here or click to browse</div>
                <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>Excel, CSV, PDF, images, text</div>
              </div>
              {isMobile && <button onClick={() => document.getElementById("traqs-camera-input").click()} disabled={uploadProcessing}
                style={{ width: "100%", marginTop: 8, padding: "11px", borderRadius: T.radiusSm, border: `1px dashed ${T.accent}55`, background: T.accent + "08", cursor: uploadProcessing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: T.accent, fontWeight: 600, fontFamily: T.font, opacity: uploadProcessing ? 0.5 : 1 }}>
                <span style={{ fontSize: 18 }}>📷</span> Take Photo of Drawing or Document
              </button>}
              {uploadFiles.length > 0 && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {uploadFiles.map((f, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.bg, borderRadius: T.radiusXs, fontSize: 12 }}>
                  <span style={{ fontSize: 14 }}>{f.name.endsWith(".pdf") ? "📄" : f.name.endsWith(".xlsx") || f.name.endsWith(".xls") ? "📊" : /\.(png|jpg|jpeg)$/i.test(f.name) ? "🖼️" : "📝"}</span>
                  <span style={{ flex: 1, color: T.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ color: T.textSec, fontSize: 11 }}>{(f.size / 1024).toFixed(1)}KB</span>
                  {!uploadProcessing && <button onClick={e => { e.stopPropagation(); setUploadFiles(prev => prev.filter((_, j) => j !== i)); }} style={{ background: "none", border: "none", color: T.text, cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>}
                </div>)}
              </div>}
            </div>

            {uploadResult && <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: T.radiusSm, background: uploadResult.success ? "#10b98115" : "#ef444415", border: `1px solid ${uploadResult.success ? "#10b98133" : "#ef444433"}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: uploadResult.success ? "#10b981" : "#ef4444" }}>{uploadResult.success ? "✅ Success" : "❌ Error"}</div>
              <div style={{ fontSize: 12, color: T.textSec, marginTop: 4 }}>{uploadResult.message}</div>
            </div>}
          </div>

          {/* Footer */}
          <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 11, color: T.textDim, fontStyle: "italic", display: "flex", alignItems: "center", gap: 4 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Review imported jobs — column mapping may need adjustment.</span>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Btn size="sm" variant="ghost" onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }}>Cancel</Btn>
              <Btn size="sm" onClick={processUpload} disabled={uploadProcessing || uploadFiles.length === 0}>
                {uploadProcessing ? "⏳ Processing..." : "⚡ Process"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>}
    {/* ─── Clear/Delete chat confirmation ─── */}
    {confirmClearChat && <div onClick={() => setConfirmClearChat(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 400, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, color: T.danger, opacity: 0.8 }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
        <h3 style={{ margin: "0 0 10px", color: T.text, fontSize: 18, fontWeight: 700, textAlign: "center" }}>
          {confirmClearChat.isGroup ? "Delete Group?" : "Clear Chat?"}
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: T.textSec, textAlign: "center", lineHeight: 1.6 }}>
          {confirmClearChat.isGroup
            ? <>This will permanently delete <strong style={{ color: T.text }}>{confirmClearChat.label}</strong> and all its messages.</>
            : <>This will permanently delete all messages in <strong style={{ color: T.text }}>{confirmClearChat.label}</strong>.</>}
          <br /><span style={{ color: T.danger, fontSize: 12 }}>This cannot be undone.</span>
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setConfirmClearChat(null)} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface, color: T.textSec, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
          <button onClick={async () => {
            const { threadKey, isGroup, groupId } = confirmClearChat;
            try { await deleteThread(threadKey, getToken, orgCode); } catch {}
            setMessages(prev => prev.filter(m => m.threadKey !== threadKey));
            if (chatThread?.threadKey === threadKey) setChatThread(null);
            if (isGroup && groupId) {
              const updated = groups.filter(g => g.id !== groupId);
              try { await saveGroups(updated, getToken, orgCode); } catch {}
              setGroups(updated);
              setPinnedGroups(p => { const n = p.filter(id => id !== groupId); localStorage.setItem("tq_pinned_groups", JSON.stringify(n)); return n; });
            }
            setConfirmClearChat(null);
          }} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: "0 4px 16px rgba(239,68,68,0.35)" }}>
            {confirmClearChat.isGroup ? "Delete Group" : "Clear Chat"}
          </button>
        </div>
      </div>
    </div>}

    {/* ─── Attachment lightbox ─── */}
    {lightboxAtt && <div onClick={() => setLightboxAtt(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <button onClick={() => setLightboxAtt(null)} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%", width: 38, height: 38, color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</button>
      {lightboxAtt.mimeType?.startsWith("image/")
        ? <img src={`/api/attachment?key=${encodeURIComponent(lightboxAtt.key)}`} alt={lightboxAtt.filename} onClick={e => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "88vh", borderRadius: 10, objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }} />
        : <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, padding: "32px 40px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, maxWidth: 340 }}>
            <span style={{ fontSize: 48 }}>{lightboxAtt.mimeType === "application/pdf" ? "📄" : "📎"}</span>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text, textAlign: "center", wordBreak: "break-all" }}>{lightboxAtt.filename}</div>
            <a href={`/api/attachment?key=${encodeURIComponent(lightboxAtt.key)}`} download={lightboxAtt.filename} style={{ background: T.accent, color: T.accentText, borderRadius: 9, padding: "10px 24px", textDecoration: "none", fontSize: 14, fontWeight: 600, fontFamily: T.font }}>Download</a>
          </div>
      }
    </div>}

    {/* ─── Quick chat sidebar ─── */}
    {quickChat && <div onClick={() => setQuickChat(null)} style={{ position: "fixed", inset: 0, zIndex: 600 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: isMobile ? "100%" : 360, background: T.card, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 601, boxShadow: "-8px 0 48px rgba(0,0,0,0.5)", animation: "slideInRight 0.22s cubic-bezier(0.22,1,0.36,1)" }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {quickChat.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 5 }}>
              {quickChat.participants.slice(0, 7).map(p => (
                <div key={p.id} title={p.name} style={{ width: 22, height: 22, borderRadius: 11, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{p.name[0]}</div>
              ))}
              {quickChat.participants.length > 7 && <span style={{ fontSize: 10, color: T.textDim, marginLeft: 2 }}>+{quickChat.participants.length - 7}</span>}
            </div>
          </div>
          <button onClick={() => { setChatThread(quickChat); setView("messages"); markThreadRead(quickChat.threadKey); setQuickChat(null); }} title="Open in Messages tab" style={{ background: T.accent + "18", border: `1px solid ${T.accent}44`, color: T.accent, borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontFamily: T.font, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Full View →</button>
          <button onClick={() => setQuickChat(null)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        {/* Messages scroll area */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 0" }}>
          {(() => {
            const tMsgs = messages.filter(m => m.threadKey === quickChat.threadKey).slice(-40);
            if (tMsgs.length === 0) return (
              <div style={{ textAlign: "center", padding: "40px 20px", color: T.textDim }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.5 }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                <div style={{ fontSize: 13 }}>No messages yet. Send the first one!</div>
              </div>
            );
            return tMsgs.map((m, i) => {
              const isMe = loggedInUser && m.authorId === loggedInUser.id;
              const prev = tMsgs[i - 1];
              const showName = !isMe && (!prev || prev.authorId !== m.authorId);
              const ts = new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              return <div key={m.id} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: 7, padding: "3px 12px", alignItems: "flex-end" }}>
                {!isMe && <div style={{ width: 26, height: 26, borderRadius: 13, background: showName ? m.authorColor : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{showName ? m.authorName[0] : ""}</div>}
                <div style={{ maxWidth: "75%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 2 }}>
                  {showName && <span style={{ fontSize: 10, color: T.textDim }}>{m.authorName}</span>}
                  {m.text && <div style={{ background: m.authorColor, color: "#fff", padding: "8px 12px", borderRadius: isMe ? "13px 13px 4px 13px" : "13px 13px 13px 4px", fontSize: 13, lineHeight: 1.45, wordBreak: "break-word", border: "none" }}>{m.text}</div>}
                  {(m.attachments || []).map((att, ai) => (
                    att.mimeType?.startsWith("image/")
                      ? <div key={ai} onClick={() => setLightboxAtt(att)} style={{ borderRadius: 9, overflow: "hidden", border: `1px solid ${T.border}`, maxWidth: 200, cursor: "zoom-in" }}>
                          <img src={`/api/attachment?key=${encodeURIComponent(att.key)}`} alt={att.filename} style={{ display: "block", maxWidth: "100%", maxHeight: 160, objectFit: "cover" }} loading="lazy" />
                        </div>
                      : <div key={ai} onClick={() => setLightboxAtt(att)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 11px", background: m.authorColor + "cc", border: `1px solid ${m.authorColor}`, borderRadius: 9, fontSize: 12, color: "#fff", cursor: "pointer", maxWidth: 190 }}>
                          <span style={{ fontSize: 15, flexShrink: 0 }}>{att.mimeType === "application/pdf" ? "📄" : "📎"}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.filename}</span>
                        </div>
                  ))}
                  <span style={{ fontSize: 10, color: T.textDim }}>{ts}</span>
                </div>
              </div>;
            });
          })()}
          <div ref={quickChatBottomRef} />
        </div>
        {/* Input */}
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          {loggedInUser && quickChat.participants.some(p => p.id === loggedInUser.id) ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea value={quickChatInput} onChange={e => setQuickChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuickMessage(); } }} placeholder="Quick message… (Enter to send)" rows={2} style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 12px", color: T.text, fontSize: 13, fontFamily: T.font, resize: "none", outline: "none", lineHeight: 1.4 }} />
              <button onClick={sendQuickMessage} disabled={!quickChatInput.trim() || quickChatSending} style={{ width: 38, height: 38, borderRadius: 10, background: quickChatInput.trim() && !quickChatSending ? T.accent : T.border, border: "none", cursor: quickChatInput.trim() && !quickChatSending ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.15s" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: T.textDim, background: T.surface, borderRadius: 8, border: `1px solid ${T.border}` }}>👁 View only — you're not a participant</div>
          )}
        </div>
      </div>
    </div>}

    {/* ─── Group context menu ─── */}
    {groupCtxMenu && <div onClick={() => setGroupCtxMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9998 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(groupCtxMenu.x, window.innerWidth - 220), top: Math.min(groupCtxMenu.y, window.innerHeight - 260), zIndex: 9999, minWidth: 200, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "6px 0", boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
        <div style={{ padding: "10px 16px 8px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>👥 {groupCtxMenu.groupName}</div>
        </div>
        <CtxMenuItem icon={pinnedGroups.includes(groupCtxMenu.groupId) ? "📌" : "📌"} label={pinnedGroups.includes(groupCtxMenu.groupId) ? "Unpin from Top" : "Pin to Top"} sub={pinnedGroups.includes(groupCtxMenu.groupId) ? "Remove from pinned" : "Keep at top of list"} onClick={() => {
          const updated = pinnedGroups.includes(groupCtxMenu.groupId)
            ? pinnedGroups.filter(id => id !== groupCtxMenu.groupId)
            : [...pinnedGroups, groupCtxMenu.groupId];
          setPinnedGroups(updated);
          localStorage.setItem("tq_pinned_groups", JSON.stringify(updated));
          setGroupCtxMenu(null);
        }} />
        {can("editJobs") && <>
          <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
          <CtxMenuItem icon="✏️" label="Edit Group" sub="Rename and manage members" onClick={() => {
            const g = groups.find(g => g.id === groupCtxMenu.groupId);
            if (g) setEditGroupModal({ groupId: g.id, name: g.name, memberIds: g.memberIds || [] });
            setGroupCtxMenu(null);
          }} />
        </>}
        <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
        {can("editJobs") && <div onClick={() => { setConfirmClearChat({ threadKey: `group:${groupCtxMenu.groupId}`, label: groupCtxMenu.groupName, isGroup: true, groupId: groupCtxMenu.groupId }); setGroupCtxMenu(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "15"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.danger, lineHeight: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></span>
          <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Delete Group</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Remove this group and its messages</div></div>
        </div>}
      </div>
    </div>}

    {/* ─── Job thread context menu ─── */}
    {threadCtxMenu && <div onClick={() => setThreadCtxMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9998 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(threadCtxMenu.x, window.innerWidth - 220), top: Math.min(threadCtxMenu.y, window.innerHeight - 140), zIndex: 9999, minWidth: 210, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "6px 0", boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
        <div style={{ padding: "10px 16px 8px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{threadCtxMenu.scope === "op" ? "🔧" : threadCtxMenu.scope === "panel" ? "📦" : "🏗"} {threadCtxMenu.title}</div>
        </div>
        <CtxMenuItem icon="📌" label={pinnedThreads.includes(threadCtxMenu.threadKey) ? "Unpin from Top" : "Pin to Top"} sub={pinnedThreads.includes(threadCtxMenu.threadKey) ? "Remove from pinned" : "Keep at top of list"} onClick={() => {
          const updated = pinnedThreads.includes(threadCtxMenu.threadKey)
            ? pinnedThreads.filter(tk => tk !== threadCtxMenu.threadKey)
            : [...pinnedThreads, threadCtxMenu.threadKey];
          setPinnedThreads(updated);
          localStorage.setItem("tq_pinned_threads", JSON.stringify(updated));
          setThreadCtxMenu(null);
        }} />
        <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
        {can("editJobs") && <div onClick={() => { setConfirmClearChat({ threadKey: threadCtxMenu.threadKey, label: threadCtxMenu.title, isGroup: false }); setThreadCtxMenu(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "15"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.danger, lineHeight: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></span>
          <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Clear Chat</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Delete all messages in this thread</div></div>
        </div>}
      </div>
    </div>}

    {/* Shared context menu */}
    {ctxMenu && (() => {
      const spaceBelow = window.innerHeight - ctxMenu.y - 12;
      const spaceAbove = ctxMenu.y - 12;
      const flipUp = spaceBelow < 300 && spaceAbove > spaceBelow;
      const maxH = flipUp ? Math.min(spaceAbove, window.innerHeight - 32) : Math.min(spaceBelow, window.innerHeight - 32);
      const vPos = flipUp ? { bottom: window.innerHeight - ctxMenu.y } : { top: ctxMenu.y };
      return <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: isMobile ? 16 : Math.min(ctxMenu.x, window.innerWidth - 268), ...(isMobile ? { bottom: 16, right: 16 } : vPos), zIndex: 9999, minWidth: isMobile ? "auto" : 260, width: isMobile ? "calc(100% - 32px)" : "auto", maxHeight: isMobile ? "80vh" : maxH, overflowY: "auto", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "6px 0", boxShadow: "0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)", fontFamily: T.font }}>
      <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ctxMenu.item.title}</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>{fm(ctxMenu.item.start)} → {fm(ctxMenu.item.end)}</div>
      </div>
      {can("editJobs") && <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>} label="Edit Job" onClick={() => {
        const it = ctxMenu.item; setCtxMenu(null);
        // For operations (level 2), open the parent job so all panels/assignments are visible
        if (it.level === 2 || (it.isSub && it.pid && !tasks.find(x => x.id === it.id))) {
          let parentJob = null;
          for (const job of tasks) { for (const panel of (job.subs || [])) { if ((panel.subs || []).find(o => o.id === it.id)) { parentJob = job; break; } } if (parentJob) break; }
          if (parentJob) openEdit(parentJob, null);
          else openEdit(it, it.isSub ? it.pid : null);
        } else if (it.level === 1 && it.pid) {
          // For panels, open the parent job
          const parentJob = tasks.find(j => j.id === it.pid);
          if (parentJob) openEdit(parentJob, null);
          else openEdit(it, it.pid);
        } else {
          openEdit(it, it.isSub ? it.pid : null);
        }
      }} />}
      {/* Quick add panel (job level) */}
      {can("editJobs") && (ctxMenu.item.level === 0 || (!ctxMenu.item.isSub && !ctxMenu.item.pid)) && <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>} label="Add Panel" sub="Add a new panel to this job" onClick={() => {
        const it = ctxMenu.item;
        setCtxMenu(null);
        setQuickAddSub({ type: "panel", parentId: it.id, grandParentId: null, parentTitle: it.title, title: "", start: it.start, end: it.end, team: [], x: ctxMenu.x, y: ctxMenu.y });
      }} />}
      {/* Quick add operation (panel level) */}
      {can("editJobs") && (ctxMenu.item.level === 1 || (ctxMenu.item.isSub && ctxMenu.item.pid && !ctxMenu.item.grandPid)) && <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>} label="Add Operation" sub="Add a new operation to this panel" onClick={() => {
        const it = ctxMenu.item;
        // Find grandParentId (the job that owns this panel)
        let grandParentId = null;
        for (const job of tasks) { if ((job.subs || []).find(p => p.id === it.id)) { grandParentId = job.id; break; } }
        setCtxMenu(null);
        setQuickAddSub({ type: "op", parentId: it.id, grandParentId, parentTitle: it.title, title: "", start: it.start, end: it.end, team: [], x: ctxMenu.x, y: ctxMenu.y });
      }} />}
      {/* Quick reassign for operations */}
      {can("reassign") && (ctxMenu.item.level === 2 || (ctxMenu.item.isSub && ctxMenu.item.pid && !tasks.find(x => x.id === ctxMenu.item.id))) && (() => {
        const it = ctxMenu.item;
        // Use live team from tasks so highlight updates immediately after clicking (ctxMenu.item is a stale snapshot)
        const liveTeam = (() => { for (const job of tasks) { for (const panel of (job.subs || [])) { for (const op of (panel.subs || [])) { if (op.id === it.id) return op.team; } } } return it.team; })();
        const currentPerson = (liveTeam || [])[0];
        const shopCrew = people.filter(p => p.userRole === "user");
        return <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0", padding: "6px 0" }}>
          <div style={{ padding: "4px 18px 8px", fontSize: 12, color: T.textDim, fontWeight: 500 }}>Reassign Operation — close when done</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 12px 4px" }}>
            {shopCrew.map(p => {
              const sel = p.id === currentPerson;
              // Check if person is busy during this operation's dates (same-person overlap)
              let busy = false;
              if (!sel) {
                for (const job of tasks) {
                  for (const panel of (job.subs || [])) {
                    for (const op of (panel.subs || [])) {
                      if (op.id !== it.id && op.team.includes(p.id) && op.status !== "Finished" && op.start <= it.end && op.end >= it.start) { busy = true; break; }
                    }
                    if (busy) break;
                  }
                  if (busy) break;
                }
                if (!busy) {
                  const pp = people.find(x => x.id === p.id);
                  if (pp) for (const to of (pp.timeOff || [])) { if (to.start <= it.end && to.end >= it.start) { busy = true; break; } }
                }
              }
              return <button key={p.id} onClick={() => {
                if (busy) return;
                // Update the assignment — menu stays open so user can review then close manually
                setTasks(prev => prev.map(job => ({ ...job, subs: (job.subs || []).map(panel => ({ ...panel, subs: (panel.subs || []).map(op => op.id === it.id ? { ...op, team: sel ? [] : [p.id] } : op) })) })));
              }} title={busy ? `${p.name} is busy during ${fm(it.start)}–${fm(it.end)}` : sel ? `Remove ${p.name}` : `Assign ${p.name}`} style={{ padding: "4px 10px", borderRadius: 8, border: `2px solid ${sel ? p.color : busy ? T.danger + "33" : T.border}`, background: sel ? p.color : busy ? T.danger + "08" : "transparent", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: sel ? "#fff" : busy ? T.danger + "88" : T.textSec, fontWeight: sel ? 700 : 400, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, transition: "all 0.15s", fontFamily: T.font, whiteSpace: "nowrap", textDecoration: busy ? "line-through" : "none" }}>
                <span style={{ width: 18, height: 18, borderRadius: 6, background: sel ? "rgba(255,255,255,0.25)" : busy ? T.danger + "15" : p.color + "22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: sel ? "#fff" : busy ? T.danger + "88" : p.color, flexShrink: 0 }}>{p.name[0]}</span>
                {p.name}
              </button>;
            })}
          </div>
        </div>;
      })()}

      {ctxMenu.source === "team" && (() => {
        const it = ctxMenu.item;
        let parentJob = null;
        if (it.grandPid) parentJob = tasks.find(j => j.id === it.grandPid);
        else if (it.pid) { parentJob = tasks.find(j => j.id === it.pid); if (!parentJob) for (const job of tasks) { if ((job.subs||[]).find(s => s.id === it.pid)) { parentJob = job; break; } } }
        else parentJob = tasks.find(j => j.id === it.id);
        if (!parentJob) return null;
        return <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>} label="Go to Project" sub={parentJob.title || it.jobTitle || ""} onClick={() => {
          setCtxMenu(null);
          setView("tasks");
          setTaskSubView("gantt");
          setGMode("month");
          const sd = new Date(parentJob.start + "T12:00:00");
          const first = new Date(sd.getFullYear(), sd.getMonth(), 1);
          const last = new Date(sd.getFullYear(), sd.getMonth() + 1, 0);
          setGStart(toDS(first));
          setGEnd(toDS(last));
          setExp(p => ({ ...p, [parentJob.id]: true }));
        }} />;
      })()}
      <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>} label="Open Chat" sub={ctxMenu.item.level === 2 ? "Chat with op assignee + admins" : ctxMenu.item.level === 1 ? "Chat with panel team + admins" : "Chat with full job team"} onClick={() => openChat(ctxMenu.item)} />
      {can("editJobs") && <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} label="Send Reminder" sub="Notify all team members on this job" onClick={() => { setReminderModal({ item: ctxMenu.item }); setCtxMenu(null); }} />}
      <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>} label="View Details" onClick={() => { openDetail(ctxMenu.item); setCtxMenu(null); }} />
      {(() => {
        const it = ctxMenu.item;
        let logCount = 0;
        if (it.moveLog) logCount = it.moveLog.length;
        // For jobs/panels, look up from tasks tree to count child logs
        if (it.level === 0 || (!it.isSub && !it.pid)) {
          const job = tasks.find(j => j.id === it.id);
          if (job) (job.subs || []).forEach(pnl => (pnl.subs || []).forEach(op => { logCount += (op.moveLog || []).length; }));
        } else if (it.level === 1 || (it.isSub && !it.grandPid)) {
          tasks.forEach(job => { const pnl = (job.subs || []).find(s => s.id === it.id); if (pnl) (pnl.subs || []).forEach(op => { logCount += (op.moveLog || []).length; }); });
        }
        return <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>} label={logCount > 0 ? `Schedule Log (${logCount})` : "Schedule Log"} sub={logCount > 0 ? "View move history" : "No changes recorded"} onClick={() => { openDetail(ctxMenu.item); setCtxMenu(null); }} />;
      })()}
      {can("lockJobs") && (ctxMenu.item.level === 2 || (ctxMenu.item.isSub && ctxMenu.item.pid)) && <CtxMenuItem icon={ctxMenu.item.locked ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>} label={ctxMenu.item.locked ? "Unlock Job" : "Lock Job"} sub={ctxMenu.item.locked ? "Allow this job to be moved" : "Prevent this job from being moved"} onClick={() => { const it = ctxMenu.item; toggleLock(it.id, it.pid); setCtxMenu(null); }} />}
      <CtxMenuItem icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>} label="Copy" sub={`Copy this ${ctxMenu.item.level === 2 ? "operation" : ctxMenu.item.level === 1 ? "panel" : "job"} to clipboard`} onClick={() => copyItem(ctxMenu.item)} />
      <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
      {can("editJobs") && <div onClick={() => { const it = ctxMenu.item; setCtxMenu(null); setConfirmDelete({ id: it.id, title: it.title, pid: it.isSub ? it.pid : null }); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "15"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.danger, lineHeight: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></span>
        <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Delete Task</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Permanently remove this task</div></div>
      </div>}
    </div>;
    })()}
    {/* Quick add subtask popup */}
    {quickAddSub && <div onClick={() => setQuickAddSub(null)} style={{ position: "fixed", inset: 0, zIndex: 9997 }}>
      <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(quickAddSub.x, window.innerWidth - 320), top: Math.min(quickAddSub.y, window.innerHeight - 320), zIndex: 9998, width: 308, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          {quickAddSub.type === "panel" ? "➕ Add Panel" : "➕ Add Operation"}
          <span style={{ fontWeight: 400, color: T.textDim, marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>to {quickAddSub.parentTitle}</span>
        </div>
        <input
          autoFocus
          placeholder={quickAddSub.type === "panel" ? "Panel name…" : "Operation name…"}
          value={quickAddSub.title}
          onChange={e => setQuickAddSub(p => ({ ...p, title: e.target.value }))}
          style={{ width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, outline: "none", marginBottom: 10, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: T.textDim, marginBottom: 4, fontWeight: 600 }}>START</div>
            <input type="date" value={quickAddSub.start} onChange={e => setQuickAddSub(p => ({ ...p, start: e.target.value }))}
              style={{ width: "100%", padding: "6px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: T.textDim, marginBottom: 4, fontWeight: 600 }}>END</div>
            <input type="date" value={quickAddSub.end} onChange={e => setQuickAddSub(p => ({ ...p, end: e.target.value }))}
              style={{ width: "100%", padding: "6px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>
        {/* People picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 6, fontWeight: 600 }}>ASSIGN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {people.filter(p => p.userRole === "user" || p.userRole === "admin").map(p => {
              const sel = (quickAddSub.team || []).includes(p.id);
              return <button key={p.id} onClick={() => setQuickAddSub(prev => ({
                ...prev,
                team: sel ? (prev.team || []).filter(id => id !== p.id) : [...(prev.team || []), p.id]
              }))} style={{ padding: "4px 10px", borderRadius: 8, border: `2px solid ${sel ? p.color : T.border}`, background: sel ? p.color : "transparent", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: sel ? "#fff" : T.textSec, fontWeight: sel ? 700 : 400, cursor: "pointer", transition: "all 0.15s", fontFamily: T.font, whiteSpace: "nowrap" }}>
                <span style={{ width: 16, height: 16, borderRadius: 5, background: sel ? "rgba(255,255,255,0.25)" : p.color + "22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: sel ? "#fff" : p.color, flexShrink: 0 }}>{p.name[0]}</span>
                {p.name}
              </button>;
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setQuickAddSub(null)} style={{ flex: 1, padding: "8px 0", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.textSec, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
          <button onClick={() => {
            if (!quickAddSub.title.trim()) return;
            const newItem = { id: uid(), title: quickAddSub.title.trim(), start: quickAddSub.start, end: quickAddSub.end, status: "Not Started", pri: "Medium", team: quickAddSub.team || [], hpd: 7.5, notes: "", deps: [] };
            if (quickAddSub.type === "panel") {
              setTasks(prev => prev.map(job => job.id === quickAddSub.parentId
                ? { ...job, subs: [...(job.subs || []), { ...newItem, subs: [] }] }
                : job));
            } else {
              setTasks(prev => prev.map(job => ({ ...job, subs: (job.subs || []).map(panel =>
                panel.id === quickAddSub.parentId
                  ? { ...panel, subs: [...(panel.subs || []), newItem] }
                  : panel
              )})));
            }
            setQuickAddSub(null);
          }} style={{ flex: 2, padding: "8px 0", borderRadius: T.radiusXs, border: "none", background: T.accent, color: T.accentText, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
            {quickAddSub.type === "panel" ? "Add Panel" : "Add Operation"}
          </button>
        </div>
      </div>
    </div>}
    {/* Paste confirmation popup */}
    {pasteConfirm && <div onClick={() => setPasteConfirm(null)} style={{ position: "fixed", inset: 0, zIndex: 9997 }}>
      <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(pasteConfirm.x, window.innerWidth - 310), top: Math.min(pasteConfirm.y, window.innerHeight - 170), zIndex: 9998, width: 300, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: 18, boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Paste here?</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clipboard?.item?.title} <span style={{ fontWeight: 400, color: T.textDim }}>(Copy)</span></div>
        <div style={{ fontSize: 12, color: T.textSec, marginBottom: 6 }}>
          {clipboard?.level === 2 ? "Operation" : clipboard?.level === 1 ? "Panel → new job" : "Job"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, padding: "8px 12px", background: T.surface, borderRadius: T.radiusXs, border: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{fm(pasteConfirm.startDate)}</span>
          <span style={{ color: T.textDim, fontSize: 12 }}>→</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{fm(pasteConfirm.endDate)}</span>
          <span style={{ fontSize: 11, color: T.textDim, marginLeft: "auto" }}>({Math.max(diffD(pasteConfirm.startDate, pasteConfirm.endDate) + 1, 1)} days)</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setPasteConfirm(null)} style={{ flex: 1, padding: "9px 0", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.textSec, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
          <button onClick={doPaste} style={{ flex: 1, padding: "9px 0", borderRadius: T.radiusXs, border: "none", background: T.accent, color: T.accentText, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>Paste Here</button>
        </div>
      </div>
    </div>}

    {/* PTO context menu */}
    {ptoCtx && <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(ptoCtx.x, window.innerWidth - 260), top: Math.min(ptoCtx.y, window.innerHeight - 200), zIndex: 9999, minWidth: 240, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "6px 0", boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
      <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: 5 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>{ptoCtx.bar.title}</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>{fm(ptoCtx.bar.fullStart)} → {fm(ptoCtx.bar.fullEnd)}</div>
      </div>
      <CtxMenuItem icon="✏️" label="Edit Time Off" sub="Change dates or reason" onClick={() => {
        const pid = ptoCtx.personId, idx = ptoCtx.toIdx;
        const pp = people.find(x => x.id === pid);
        const pto = pp ? (pp.timeOff || [])[idx] : null;
        if (pto) setTimeOffEdit({ personId: pid, idx, start: pto.start, end: pto.end, reason: pto.reason || "", type: pto.type || "PTO" });
        setPtoCtx(null);
      }} />
      <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
      <div onClick={() => { delTimeOff(ptoCtx.personId, ptoCtx.toIdx); setPtoCtx(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "15"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ width: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.danger, lineHeight: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></span>
        <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Delete Time Off</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Remove this entry</div></div>
      </div>
    </div>}
    {/* Client edit modal */}
    {clientModal && (() => {
      const [ed, setEd] = [clientModal, d => setClientModal(typeof d === "function" ? d(clientModal) : d)];
      return <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }} >
        <div className="anim-modal-box" style={{ background: T.card, borderRadius: isMobile ? 0 : 16, padding: isMobile ? 16 : 32, maxWidth: isMobile ? "100%" : 540, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", position: "relative" }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setClientModal(null)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>
          <h3 style={{ margin: "0 0 24px", color: T.text, fontSize: 22, fontWeight: 700 }}>{ed.id ? "Edit Client" : "New Client"}</h3>
          <InputField label="Company Name" value={ed.name} onChange={v => setClientModal(p => ({ ...p, name: v }))} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <InputField label="Contact Person" value={ed.contact} onChange={v => setClientModal(p => ({ ...p, contact: v }))} />
            <InputField label="Phone" value={ed.phone} onChange={v => setClientModal(p => ({ ...p, phone: v }))} />
          </div>
          <InputField label="Email" value={ed.email} onChange={v => setClientModal(p => ({ ...p, email: v }))} />
          <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Notes</label><textarea value={ed.notes} onChange={e => setClientModal(p => ({ ...p, notes: e.target.value }))} rows={3} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, resize: "vertical", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" }}>
            {ed.id && <Btn variant="danger" onClick={() => setConfirmDeleteClient(ed.id)} style={{ marginRight: "auto" }}>Delete Client</Btn>}
            <Btn variant="ghost" onClick={() => setClientModal(null)}>Cancel</Btn>
            <Btn onClick={() => saveClient(ed)}>Save Client</Btn>
          </div>
        </div>
      </div>;
    })()}
    {/* Client delete confirm modal */}
    {confirmDeleteClient && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 420, width: "100%", border: `1px solid ${T.danger}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${T.danger}11`, textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: T.danger }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
        <h3 style={{ margin: "0 0 8px", color: T.danger, fontSize: 20, fontWeight: 700 }}>Delete Client?</h3>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: T.textSec, lineHeight: 1.6 }}>
          This will permanently delete <strong style={{ color: T.text }}>{clients.find(c => c.id === confirmDeleteClient)?.name}</strong> and remove them from all associated jobs. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Btn variant="ghost" onClick={() => setConfirmDeleteClient(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={() => { delClient(confirmDeleteClient); setConfirmDeleteClient(null); setClientModal(null); setSelClient(null); }}>Delete</Btn>
        </div>
      </div>
    </div>}
    {/* Person edit modal */}
    {personModal && (() => {
      const ed = personModal;
      const setEd = d => setPersonModal(typeof d === "function" ? d(personModal) : d);
      return <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }} >
        <div className="anim-modal-box" style={{ background: T.card, borderRadius: isMobile ? 0 : 16, padding: isMobile ? 16 : 32, maxWidth: isMobile ? "100%" : 600, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", position: "relative" }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setPersonModal(null)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>
          <h3 style={{ margin: "0 0 24px", color: T.text, fontSize: 22, fontWeight: 700 }}>{ed.id ? "Edit Team Member" : "New Team Member"}</h3>
          <InputField label="Full Name" value={ed.name} onChange={v => setEd(p => {
            const domain = orgConfig?.domain;
            const prevAuto = autoEmail(p.name, domain);
            const isAutoEmail = !p.id && (!p.email || p.email === prevAuto);
            return { ...p, name: v, email: isAutoEmail ? autoEmail(v, domain) : p.email };
          })} />
          <InputField label="Email" value={ed.email || ""} onChange={v => setEd(p => ({ ...p, email: v.trim().toLowerCase() }))} type="email" placeholder="firstname@domain.com" />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <InputField label="Role" value={ed.role} onChange={v => setEd(p => ({ ...p, role: v }))} />
            <InputField label="Hours/Day Capacity" value={ed.cap} onChange={v => setEd(p => ({ ...p, cap: +v }))} type="number" />
          </div>

          {/* Team — free-text input, admin-only editable */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 500 }}>
              Team
              {!isAdmin && ed.teamNumber && <span style={{ marginLeft: 8, fontSize: 11, color: T.textDim }}>(set by admin)</span>}
            </label>
            {isAdmin ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    list="tq-team-suggestions"
                    value={ed.teamNumber || ""}
                    onChange={e => setEd(p => ({ ...p, teamNumber: e.target.value || null, isTeamLead: e.target.value ? p.isTeamLead : false }))}
                    placeholder="e.g. 1, 2, Shop A, Alpha…"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none" }}
                  />
                  <datalist id="tq-team-suggestions">
                    {[...new Set(people.filter(p => p.teamNumber && p.id !== ed.id).map(p => String(p.teamNumber)))].map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
                {ed.teamNumber && <button onClick={() => setEd(p => ({ ...p, teamNumber: null, isTeamLead: false }))} style={{ padding: "9px 13px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.textDim, fontSize: 13, cursor: "pointer", fontFamily: T.font, whiteSpace: "nowrap", flexShrink: 0 }}>✕</button>}
              </div>
            ) : (
              <div style={{ padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, fontSize: 14, color: T.text, fontWeight: 600 }}>
                {ed.teamNumber || <span style={{ color: T.textDim, fontWeight: 400 }}>Unassigned</span>}
              </div>
            )}
          </div>

          {/* Team Lead toggle — only when team is assigned */}
          {ed.teamNumber && <div style={{ marginBottom: 20, padding: "14px 16px", borderRadius: T.radiusSm, border: `1px solid ${ed.isTeamLead ? "#10b98155" : T.border}`, background: ed.isTeamLead ? "#10b98108" : T.surface, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: isAdmin ? "pointer" : "default", transition: "all 0.2s" }} onClick={() => isAdmin && setEd(p => ({ ...p, isTeamLead: !p.isTeamLead }))}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ lineHeight: 0, color: "#f59e0b" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="#f59e0b" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Team {ed.teamNumber} Lead</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>{isAdmin ? "Designate as the lead for this team" : "Team lead designation (admin-only)"}</div>
              </div>
            </div>
            <div style={{ width: 40, height: 22, borderRadius: 11, background: ed.isTeamLead ? "#10b981" : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0, opacity: isAdmin ? 1 : 0.5 }}>
              <div style={{ position: "absolute", top: 3, left: ed.isTeamLead ? 21 : 3, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>}

          <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 500 }}>Color</label><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{COLORS.map(c => <div key={c} onClick={() => setEd(p => ({ ...p, color: c }))} style={{ width: 32, height: 32, borderRadius: 16, background: c, cursor: "pointer", border: ed.color === c ? "3px solid #fff" : "3px solid transparent", boxShadow: ed.color === c ? `0 0 12px ${c}66` : "none" }} />)}</div></div>

          {/* Time Off management */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <label style={{ fontSize: 13, color: T.textSec, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Time Off / Unavailable Dates</label>
              <Btn variant="ghost" size="sm" onClick={() => setEd(p => ({ ...p, timeOff: [...(p.timeOff || []), { start: TD, end: addD(TD, 1), reason: "" }] }))}>+ Add</Btn>
            </div>
            {(ed.timeOff || []).length === 0 && <div style={{ padding: 16, textAlign: "center", fontSize: 13, color: T.textDim, background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>No time off scheduled</div>}
            {(ed.timeOff || []).map((to, i) => <div key={i} style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 10, padding: 12, background: T.surface, borderRadius: T.radiusSm, border: "1px solid #a78bfa22" }}>
              <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: T.textDim, marginBottom: 4 }}>From</label><input type="date" value={to.start} onChange={e => { const nto = [...ed.timeOff]; nto[i] = { ...nto[i], start: e.target.value }; setEd(p => ({ ...p, timeOff: nto })); }} style={{ colorScheme: T.colorScheme, width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} /></div>
              <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: T.textDim, marginBottom: 4 }}>To</label><input type="date" value={to.end} onChange={e => { const nto = [...ed.timeOff]; nto[i] = { ...nto[i], end: e.target.value }; setEd(p => ({ ...p, timeOff: nto })); }} style={{ colorScheme: T.colorScheme, width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} /></div>
              <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: T.textDim, marginBottom: 4 }}>Reason</label><input value={to.reason} onChange={e => { const nto = [...ed.timeOff]; nto[i] = { ...nto[i], reason: e.target.value }; setEd(p => ({ ...p, timeOff: nto })); }} placeholder="Vacation, Sick..." style={{ width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} /></div>
              <Btn variant="danger" size="sm" onClick={() => { const nto = ed.timeOff.filter((_, j) => j !== i); setEd(p => ({ ...p, timeOff: nto })); }}>✕</Btn>
            </div>)}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
            <div>{ed.id && <Btn variant="danger" onClick={() => { delPerson(ed.id); setPersonModal(null); }}>Delete Member</Btn>}</div>
            <div style={{ display: "flex", gap: 12 }}><Btn variant="ghost" onClick={() => setPersonModal(null)}>Cancel</Btn><Btn onClick={() => savePerson(ed)}>Save</Btn></div>
          </div>
        </div>
      </div>;
    })()}
    {/* Time Off edit modal */}
    {timeOffEdit && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 28, maxWidth: 420, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 20px", color: T.text, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit Time Off</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "center" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Person</label>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{(() => { const pp = people.find(x => x.id === timeOffEdit.personId); return pp ? pp.name : "Unknown"; })()}</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Type</label>
            <div style={{ display: "flex", gap: 4 }}>
              {["PTO", "UTO"].map(t => <button key={t} onClick={() => setTimeOffEdit(p => ({ ...p, type: t }))} style={{ padding: "5px 14px", borderRadius: 6, border: `1px solid ${timeOffEdit.type === t ? (t === "PTO" ? "#10b981" : "#f59e0b") + "66" : T.border}`, background: timeOffEdit.type === t ? (t === "PTO" ? "#10b981" : "#f59e0b") + "15" : "transparent", cursor: "pointer", fontFamily: T.font, fontSize: 12, fontWeight: timeOffEdit.type === t ? 700 : 400, color: timeOffEdit.type === t ? (t === "PTO" ? "#10b981" : "#f59e0b") : T.textSec }}>{t}</button>)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>From</label>
            <input type="date" value={timeOffEdit.start} onChange={e => setTimeOffEdit(p => ({ ...p, start: e.target.value }))} style={{ colorScheme: T.colorScheme, width: "100%", padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>To</label>
            <input type="date" value={timeOffEdit.end} onChange={e => setTimeOffEdit(p => ({ ...p, end: e.target.value }))} style={{ colorScheme: T.colorScheme, width: "100%", padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Reason</label>
          <input value={timeOffEdit.reason} onChange={e => setTimeOffEdit(p => ({ ...p, reason: e.target.value }))} placeholder="Vacation, sick leave, etc." style={{ width: "100%", padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={() => setTimeOffEdit(null)}>Cancel</Btn>
          <Btn onClick={() => { updTimeOff(timeOffEdit.personId, timeOffEdit.idx, { start: timeOffEdit.start, end: timeOffEdit.end, reason: timeOffEdit.reason, type: timeOffEdit.type }); setTimeOffEdit(null); }}>Save</Btn>
        </div>
      </div>
    </div>}
    {/* Time Off modal */}
    {timeOffModal && <TimeOffModal people={people} updPerson={updPerson} onClose={() => setTimeOffModal(false)} />}
    {/* Engineering block error toast */}
    {engBlockError && <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "#ef4444", color: "#fff", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 10, maxWidth: 480, pointerEvents: "none" }}>
      <span style={{ fontSize: 18 }}>🔧</span>{engBlockError}
    </div>}
    {/* Logout confirmation modal */}
    {confirmLogout && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setConfirmLogout(false)}>
        <div style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, padding: 28, maxWidth: 360, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>Log Out?</div>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: T.textSec, lineHeight: 1.6 }}>
            {saveStatus === "unsaved"
              ? "You have unsaved changes that will be lost. Log out anyway?"
              : `You are signed in as ${loggedInUser?.name || ""}. Are you sure you want to log out?`}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmLogout(false)} style={{ padding: "9px 20px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
            <button onClick={() => { setConfirmLogout(false); handleLogout(); }} style={{ padding: "9px 20px", borderRadius: T.radiusXs, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Log Out</button>
          </div>
        </div>
      </div>
    )}
    {/* Delete confirmation modal */}
    {confirmDelete && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-delete-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 440, width: "100%", border: `1px solid ${T.danger}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${T.danger}11`, position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: T.danger }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
        <h3 style={{ margin: "0 0 12px", color: T.text, fontSize: 20, fontWeight: 700 }}>Delete Task?</h3>
        <p style={{ margin: "0 0 8px", fontSize: 15, color: T.textSec, lineHeight: 1.5 }}>You are about to permanently delete:</p>
        <div style={{ padding: "12px 18px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{confirmDelete.title}</span>
        </div>
        <div style={{ padding: "10px 14px", background: T.danger + "0a", borderRadius: T.radiusSm, border: `1px solid ${T.danger}22`, marginBottom: 24 }}>
          <span style={{ fontSize: 13, color: T.danger, fontWeight: 600 }}>⚠ This action cannot be undone.</span>
          <span style={{ display: "block", fontSize: 12, color: T.textDim, marginTop: 4 }}>All subtasks, dependencies, and associated data will be permanently removed.</span>
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Btn variant="ghost" onClick={() => setConfirmDelete(null)} style={{ minWidth: 120 }}>Cancel</Btn>
          <Btn variant="danger" onClick={() => { delTask(confirmDelete.id, confirmDelete.pid); if (confirmDelete.extra) confirmDelete.extra(); setConfirmDelete(null); }} style={{ minWidth: 120, background: T.danger, color: "#fff", border: "none" }}>Delete Forever</Btn>
        </div>
      </div>
    </div>}

    {/* Overlap Error Modal */}
    {overlapError && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 520, width: "100%", border: `1px solid ${T.danger}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${T.danger}11`, position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: T.danger }}>{overlapError.message.includes("Locked") ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}</div>
        <h3 style={{ margin: "0 0 8px", color: T.danger, fontSize: 20, fontWeight: 700 }}>{overlapError.message}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: T.textSec, lineHeight: 1.5 }}>{overlapError.message.includes("Locked") ? "One or more jobs in the path are locked and cannot be moved or pushed forward." : "This action would create a scheduling conflict. Team members cannot work on multiple tasks at the same time."}</p>
        <div style={{ textAlign: "left", maxHeight: 200, overflow: "auto", marginBottom: 24 }}>
          {overlapError.details.map((d, i) => <div key={i} style={{ padding: "10px 14px", background: T.danger + "08", borderRadius: T.radiusSm, border: `1px solid ${T.danger}22`, marginBottom: 6, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
            <span style={{ color: T.danger, fontWeight: 700 }}>⛔ </span>{d}
          </div>)}
        </div>
        <Btn onClick={() => setOverlapError(null)} style={{ minWidth: 140 }}>Got it</Btn>
      </div>
    </div>}

    {/* Team drag cursor badge — follows mouse, shows target person */}
    {teamDragInfo && teamDragInfo.cursorX != null && (() => {
      const { cursorX, cursorY, targetPersonId, hasOverlap, taskTitle, barColor } = teamDragInfo;
      const tgt = people.find(x => x.id === targetPersonId);
      if (!tgt) return null;
      const gc = hasOverlap ? "#ef4444" : barColor || T.accent;
      return <div style={{ position: "fixed", left: cursorX + 14, top: cursorY - 36, pointerEvents: "none", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
        {/* Name badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: T.card, border: `1.5px solid ${gc}`, borderRadius: 20, padding: "4px 10px 4px 6px", boxShadow: `0 0 18px ${gc}88, 0 4px 16px rgba(0,0,0,0.4)`, backdropFilter: "blur(8px)" }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, background: tgt.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{tgt.name.charAt(0)}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: gc, whiteSpace: "nowrap" }}>{tgt.name}</span>
        </div>
        {/* Job title tiny label */}
        {taskTitle && <div style={{ fontSize: 10, color: T.textDim, background: T.surface + "cc", borderRadius: 6, padding: "2px 8px", border: `1px solid ${T.border}`, boxShadow: "0 2px 8px rgba(0,0,0,0.3)", backdropFilter: "blur(4px)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{taskTitle}</div>}
      </div>;
    })()}

    {/* Confirm Move Modal */}
    {confirmMove && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 480, width: "100%", border: `1px solid ${T.accent}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5)`, position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.accent + "15", border: `2px solid ${T.accent}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: T.accent }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>
        <h3 style={{ margin: "0 0 12px", color: T.text, fontSize: 20, fontWeight: 700 }}>{confirmMove.title || "Move Entire Job?"}</h3>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: T.textSec, lineHeight: 1.6 }}>{confirmMove.message}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Btn variant="ghost" onClick={() => { if (confirmMove.onCancel) confirmMove.onCancel(); }} style={{ minWidth: 120 }}>Cancel</Btn>
          <Btn onClick={() => { if (confirmMove.onConfirm) confirmMove.onConfirm(); }} style={{ minWidth: 120 }}>Yes, Move It</Btn>
        </div>
      </div>
    </div>}

    {/* Push confirmation modal */}
    {confirmPush && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 560, width: "100%", border: `1px solid #f59e0b33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5)`, position: "relative" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: "#f59e0b15", border: "2px solid #f59e0b33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#f59e0b" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 20, fontWeight: 700, textAlign: "center" }}>Scheduling Conflict</h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: T.textSec, lineHeight: 1.5, textAlign: "center" }}>This move affects <strong style={{ color: "#f59e0b" }}>{confirmPush.pushes.length}</strong> other {confirmPush.pushes.length === 1 ? "job" : "jobs"}. How would you like to proceed?</p>
        <div style={{ maxHeight: 260, overflow: "auto", marginBottom: 24, borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
          {confirmPush.pushes.map((push, i) => {
            const person = (confirmPush.people || people).find(x => x.id === push.personId);
            return <div key={i} style={{ padding: "14px 16px", borderBottom: i < confirmPush.pushes.length - 1 ? `1px solid ${T.border}` : "none", background: i % 2 === 0 ? T.surface : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {person && <span style={{ width: 20, height: 20, borderRadius: 6, background: person.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>{person.name[0]}</span>}
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{push.opTitle} – {push.panelTitle}</span>
                <span style={{ fontSize: 12, color: T.textDim, marginLeft: "auto" }}>Job {push.jobTitle}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ color: T.textDim, fontFamily: T.mono }}>{fm(push.oldStart)} – {fm(push.oldEnd)}</span>
                <span style={{ color: "#f59e0b", fontSize: 16 }}>→</span>
                <span style={{ color: "#f59e0b", fontWeight: 700, fontFamily: T.mono }}>{fm(push.newStart)} – {fm(push.newEnd)}</span>
                <span style={{ marginLeft: "auto", background: "#f59e0b15", border: "1px solid #f59e0b33", borderRadius: 6, padding: "2px 8px", fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>+{push.daysPushed} {push.daysPushed === 1 ? "day" : "days"}</span>
              </div>
            </div>;
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => confirmPush.onConfirmSingle()} style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, color: T.text }}>Move Just This Job</Btn>
            <Btn onClick={() => confirmPush.onConfirm()} style={{ flex: 1, background: "#f59e0b", border: "none" }}>Move All Jobs</Btn>
          </div>
          <Btn variant="ghost" onClick={() => confirmPush.onCancel()} style={{ width: "100%" }}>Cancel</Btn>
        </div>
      </div>
    </div>}

    {/* ── New Group Modal ───────────────────────────────────────────────────── */}
    {newGroupModal && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal" onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: T.radiusMd, padding: 28, width: "100%", maxWidth: 420, border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: T.text }}>New Group</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textDim }}>Create a group for team messaging</p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Group Name</label>
        <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newGroupName.trim()) saveNewGroup(); }} placeholder="e.g. Wire Crew, Shop Team…" style={{ width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Members <span style={{ color: T.textDim, fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {people.map(p => {
            const sel = newGroupPeople.includes(p.id);
            return <button key={p.id} onClick={() => setNewGroupPeople(prev => sel ? prev.filter(id => id !== p.id) : [...prev, p.id])} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px 6px 8px", borderRadius: 20, border: `2px solid ${sel ? p.color : T.border}`, background: sel ? p.color + "18" : "transparent", cursor: "pointer", fontFamily: T.font, transition: "all 0.15s" }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{p.name[0]}</div>
              <span style={{ fontSize: 13, fontWeight: sel ? 600 : 400, color: sel ? p.color : T.textSec }}>{p.name}</span>
            </button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={() => { setNewGroupModal(false); setNewGroupName(""); setNewGroupPeople([]); }}>Cancel</Btn>
          <Btn onClick={saveNewGroup} disabled={!newGroupName.trim() || newGroupSaving}>{newGroupSaving ? "Creating…" : "Create Group"}</Btn>
        </div>
      </div>
    </div>}

    {/* ── Edit Group Modal ──────────────────────────────────────────────────── */}
    {editGroupModal && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="anim-modal" onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: T.radiusMd, padding: 28, width: "100%", maxWidth: 420, border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Edit Group</h3>
          <button onClick={() => setEditGroupModal(null)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textDim }}>Rename or update group members</p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Group Name</label>
        <input autoFocus value={editGroupModal.name} onChange={e => setEditGroupModal(p => ({ ...p, name: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && editGroupModal.name.trim()) saveEditGroup(); }} placeholder="Group name…" style={{ width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSec, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Members</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {people.map(p => {
            const sel = editGroupModal.memberIds.includes(p.id);
            return <button key={p.id} onClick={() => setEditGroupModal(prev => ({ ...prev, memberIds: sel ? prev.memberIds.filter(id => id !== p.id) : [...prev.memberIds, p.id] }))} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px 6px 8px", borderRadius: 20, border: `2px solid ${sel ? p.color : T.border}`, background: sel ? p.color + "18" : "transparent", cursor: "pointer", fontFamily: T.font, transition: "all 0.15s" }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{p.name[0]}</div>
              <span style={{ fontSize: 13, fontWeight: sel ? 600 : 400, color: sel ? p.color : T.textSec }}>{p.name}</span>
            </button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={() => setEditGroupModal(null)}>Cancel</Btn>
          <Btn onClick={saveEditGroup} disabled={!editGroupModal.name.trim()}>Save Changes</Btn>
        </div>
      </div>
    </div>}

    {/* Reminder modal */}
    {reminderModal && (() => {
      const item = reminderModal.item;
      let scope, jobId, panelId = null, opId = null;
      if (item.level === 2 || (item.isSub && item.grandPid)) {
        scope = "op"; opId = item.id; panelId = item.pid;
        let parentJob = null;
        for (const j of tasks) { for (const p of (j.subs || [])) { if ((p.subs || []).find(o => o.id === item.id)) { parentJob = j; break; } } if (parentJob) break; }
        jobId = parentJob?.id || item.grandPid;
      } else if (item.level === 1 || item.isSub) {
        scope = "panel"; panelId = item.id; jobId = item.pid;
      } else {
        scope = "job"; jobId = item.id;
      }
      const participants = getThreadParticipants(scope, jobId, panelId, opId);
      const workers = participants.filter(p => p.userRole !== "admin");
      const recipients = workers.length ? workers : participants;
      return <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setReminderModal(null); setReminderNote(""); }}>
        <div style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.borderLight}`, width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.7)", fontFamily: T.font, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 7 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>Send Reminder</div>
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>{item.title}{item.end ? ` · Due ${fm(item.end)}` : ""}</div>
          </div>
          <div style={{ padding: "16px 24px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Notifying {recipients.length} team member{recipients.length !== 1 ? "s" : ""}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
              {recipients.map(p => <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, background: p.color + "18", border: `1px solid ${p.color}44`, borderRadius: 20, padding: "4px 10px 4px 6px" }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{p.name[0]}</div>
                <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{p.name}</span>
              </div>)}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Message (optional)</div>
            <textarea value={reminderNote} onChange={e => setReminderNote(e.target.value)} placeholder="Please complete this job." rows={3} style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.text, fontSize: 13, padding: "10px 12px", fontFamily: T.font, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ padding: "0 24px 20px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setReminderModal(null); setReminderNote(""); }} style={{ padding: "9px 20px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: "transparent", color: T.textSec, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>Cancel</button>
            <button onClick={() => sendReminder(reminderModal.item, reminderNote)} disabled={reminderSending || recipients.length === 0} style={{ padding: "9px 20px", borderRadius: T.radiusSm, border: "none", background: T.accent, color: T.accentText, fontSize: 13, fontWeight: 700, cursor: reminderSending || recipients.length === 0 ? "not-allowed" : "pointer", fontFamily: T.font, opacity: reminderSending || recipients.length === 0 ? 0.6 : 1 }}>{reminderSending ? "Sending…" : "Send Reminder"}</button>
          </div>
        </div>
      </div>;
    })()}

    {/* Floating bulk delete button(s) */}
    {(selJobs.size > 0 || selClients.size > 0 || selPeople.size > 0) && <div style={{ position: "fixed", bottom: 32, right: 32, zIndex: 1200, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end", animation: "ghost-fade-in 0.2s ease" }}>
      {selJobs.size > 0 && <button onClick={() => setBulkDeleteConfirm({ type: "jobs", ids: [...selJobs], count: selJobs.size })} style={{ padding: "11px 22px", borderRadius: T.radiusSm, border: `1.5px solid ${T.danger}55`, background: T.danger, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: `0 4px 24px ${T.danger}55`, display: "flex", alignItems: "center", gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete {selJobs.size} Job{selJobs.size !== 1 ? "s" : ""}</button>}
      {selClients.size > 0 && <button onClick={() => setBulkDeleteConfirm({ type: "clients", ids: [...selClients], count: selClients.size })} style={{ padding: "11px 22px", borderRadius: T.radiusSm, border: `1.5px solid ${T.danger}55`, background: T.danger, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: `0 4px 24px ${T.danger}55`, display: "flex", alignItems: "center", gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete {selClients.size} Client{selClients.size !== 1 ? "s" : ""}</button>}
      {selPeople.size > 0 && <button onClick={() => setBulkDeleteConfirm({ type: "people", ids: [...selPeople], count: selPeople.size })} style={{ padding: "11px 22px", borderRadius: T.radiusSm, border: `1.5px solid ${T.danger}55`, background: T.danger, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: `0 4px 24px ${T.danger}55`, display: "flex", alignItems: "center", gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete {selPeople.size} Person{selPeople.size !== 1 ? "s" : ""}</button>}
    </div>}
    {/* Bulk delete confirmation modal */}
    {bulkDeleteConfirm && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setBulkDeleteConfirm(null)}>
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 440, width: "100%", border: `1px solid ${T.danger}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${T.danger}11`, textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: T.danger }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
        <h3 style={{ margin: "0 0 8px", color: T.danger, fontSize: 20, fontWeight: 700 }}>Delete {bulkDeleteConfirm.count} {bulkDeleteConfirm.type === "jobs" ? "Job" : bulkDeleteConfirm.type === "clients" ? "Client" : "Person"}{bulkDeleteConfirm.count !== 1 ? "s" : ""}?</h3>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: T.textSec, lineHeight: 1.6 }}>This will permanently delete {bulkDeleteConfirm.count} selected {bulkDeleteConfirm.type === "jobs" ? "job" : bulkDeleteConfirm.type === "clients" ? "client" : "team member"}{bulkDeleteConfirm.count !== 1 ? "s" : ""}. This cannot be undone.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Btn variant="ghost" onClick={() => setBulkDeleteConfirm(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={() => { const { type, ids } = bulkDeleteConfirm; if (type === "jobs") { ids.forEach(id => delTask(id)); setSelJobs(new Set()); setJobSelectMode(false); } else if (type === "clients") { ids.forEach(id => delClient(id)); setSelClients(new Set()); setClientSelectMode(false); } else if (type === "people") { ids.forEach(id => delPerson(id)); setSelPeople(new Set()); setTeamSelectMode(false); } setBulkDeleteConfirm(null); }}>Delete All</Btn>
        </div>
      </div>
    </div>}
  </div>;
}

function AvailModal({ people, allItems, bookedHrs, onClose, isMobile, onStartTask }) {
  const [aS, setAS] = useState(toDS(new Date())); const [aE, setAE] = useState(addD(toDS(new Date()), 5)); const [aH, setAH] = useState(4);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const results = useMemo(() => people.filter(p => p.userRole !== "admin").map(p => { let tf = 0; const days = []; let c = aS; while (c <= aE) { const b = bookedHrs(p.id, c); const f = Math.max(0, p.cap - b); tf += f; days.push({ d: c, b, f }); c = addD(c, 1); } const avg = days.length ? tf / days.length : 0; const cur = allItems.filter(i => i.team.includes(p.id) && i.end >= aS && i.start <= aE && i.status !== "Finished"); return { p, tf, avg, days, cur, ok: avg >= aH }; }).sort((a, b) => b.tf - a.tf), [aS, aE, aH, people, bookedHrs, allItems]);
  const available = results.filter(r => r.ok);
  const busy = results.filter(r => !r.ok);
  return <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }}>
    <div className="anim-modal-box" style={{ background: T.card, borderRadius: isMobile ? 0 : 16, padding: isMobile ? 16 : 32, maxWidth: isMobile ? "100%" : 600, width: "100%", border: `1px solid ${T.borderLight}`, position: "relative", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
      <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>
      <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Availability Finder</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textDim }}>Find available team members for a date range</p>
      
      {/* Input fields */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Start Date</label>
          <input type="date" value={aS} onChange={e => { setAS(e.target.value); setSelectedPerson(null); }} style={{ colorScheme: T.colorScheme, width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>End Date</label>
          <input type="date" value={aE} onChange={e => { setAE(e.target.value); setSelectedPerson(null); }} style={{ colorScheme: T.colorScheme, width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
        </div>
        <div style={{ minWidth: 120 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Hrs/Day</label>
          <input type="number" min="1" max="12" value={aH} onChange={e => { setAH(+e.target.value); setSelectedPerson(null); }} style={{ width: "100%", padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box" }} />
        </div>
      </div>

      {/* Results */}
      {available.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Available · {available.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {available.map(r => {
            const isSel = selectedPerson === r.p.id;
            return <div key={r.p.id} onClick={() => setSelectedPerson(isSel ? null : r.p.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: isSel ? T.accent + "12" : T.surface, borderRadius: T.radiusSm, border: `1px solid ${isSel ? T.accent + "55" : "#10b98133"}`, cursor: "pointer", transition: "all 0.15s" }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: r.p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{r.p.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{r.p.name}</div>
                <div style={{ fontSize: 12, color: T.textSec, marginTop: 1 }}>
                  <span style={{ fontWeight: 600, color: "#10b981" }}>{r.avg.toFixed(1)}h/day free</span>
                  <span style={{ color: T.textDim }}> · {r.tf.toFixed(0)}h total available</span>
                </div>
                {r.cur.length > 0 && <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>Current: {r.cur.map(t => t.title).join(", ")}</div>}
              </div>
              {isSel && <div style={{ width: 22, height: 22, borderRadius: 11, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ color: T.accentText, fontSize: 13, fontWeight: 700 }}>✓</span></div>}
            </div>;
          })}
        </div>
      </>}

      {busy.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.danger, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Busy · {busy.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {busy.map(r => <div key={r.p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.danger}22`, opacity: 0.6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: r.p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{r.p.name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: T.text }}>{r.p.name}</div>
              <div style={{ fontSize: 11, color: T.textDim }}>{r.avg.toFixed(1)}h/day free · needs {aH}h</div>
            </div>
            <Badge t="Busy" c={T.danger} />
          </div>)}
        </div>
      </>}

      {results.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: T.textDim, fontSize: 14 }}>No team members found</div>}

      {/* Action bar */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", paddingTop: 16, borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => { if (selectedPerson) onStartTask(selectedPerson, aS, aE, aH); }} style={{ opacity: selectedPerson ? 1 : 0.4, pointerEvents: selectedPerson ? "auto" : "none" }}>Start New Task →</Btn>
      </div>
    </div>
  </div>;
}

function TimeOffModal({ people, updPerson, onClose }) {
  const [toPerson, setToPerson] = useState(null);
  const [toStart, setToStart] = useState(TD);
  const [toEnd, setToEnd] = useState(addD(TD, 1));
  const [toReason, setToReason] = useState("");
  const [toType, setToType] = useState("PTO");
  const shopCrew = people.filter(p => p.userRole === "user");
  const allTimeOff = people.flatMap(p => (p.timeOff || []).map((to, idx) => ({ ...to, person: p, idx }))).sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = allTimeOff.filter(to => to.end >= TD);
  const past = allTimeOff.filter(to => to.end < TD);
  const handleAdd = () => {
    if (!toPerson || !toStart || !toEnd) return;
    const p = people.find(x => x.id === toPerson);
    if (!p) return;
    const label = toType + (toReason ? " – " + toReason : "");
    updPerson(toPerson, { timeOff: [...(p.timeOff || []), { start: toStart, end: toEnd, reason: label, type: toType }] });
    setToPerson(null); setToStart(TD); setToEnd(addD(TD, 1)); setToReason(""); setToType("PTO");
  };
  const handleRemove = (pid, idx) => {
    const p = people.find(x => x.id === pid);
    if (!p) return;
    updPerson(pid, { timeOff: (p.timeOff || []).filter((_, i) => i !== idx) });
  };
  return <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" }}>
    <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 560, width: "100%", border: `1px solid ${T.borderLight}`, position: "relative", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
      <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>
      <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Manage Time Off</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textDim }}>Schedule time off for team members</p>

      {/* Add new */}
      <div style={{ padding: 16, background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Add New</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Team Member</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {shopCrew.map(p => <button key={p.id} onClick={() => setToPerson(toPerson === p.id ? null : p.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${toPerson === p.id ? p.color + "66" : T.border}`, background: toPerson === p.id ? p.color + "15" : "transparent", cursor: "pointer", fontFamily: T.font, fontSize: 13, color: T.text, fontWeight: toPerson === p.id ? 600 : 400, transition: "all 0.15s" }}>
              <div style={{ width: 18, height: 18, borderRadius: 6, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
              {p.name}
            </button>)}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Type</label>
          <div style={{ display: "flex", gap: 6 }}>
            {["PTO", "UTO"].map(t => <button key={t} onClick={() => setToType(t)} style={{ padding: "7px 18px", borderRadius: 8, border: `1px solid ${toType === t ? (t === "PTO" ? "#10b981" : "#f59e0b") + "66" : T.border}`, background: toType === t ? (t === "PTO" ? "#10b981" : "#f59e0b") + "15" : "transparent", cursor: "pointer", fontFamily: T.font, fontSize: 13, fontWeight: toType === t ? 700 : 400, color: toType === t ? (t === "PTO" ? "#10b981" : "#f59e0b") : T.textSec, transition: "all 0.15s" }}>{t === "PTO" ? "🏖️ PTO (Paid)" : "📋 UTO (Unpaid)"}</button>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>From</label>
            <input type="date" value={toStart} onChange={e => setToStart(e.target.value)} style={{ colorScheme: T.colorScheme, width: "100%", padding: "8px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>To</label>
            <input type="date" value={toEnd} onChange={e => setToEnd(e.target.value)} style={{ colorScheme: T.colorScheme, width: "100%", padding: "8px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Reason</label>
          <input value={toReason} onChange={e => setToReason(e.target.value)} placeholder="Vacation, sick leave, etc." style={{ width: "100%", padding: "8px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
        </div>
        <Btn size="sm" onClick={handleAdd} style={{ opacity: toPerson ? 1 : 0.4, pointerEvents: toPerson ? "auto" : "none" }}>+ Add Time Off</Btn>
      </div>

      {/* Upcoming time off */}
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Upcoming{upcoming.length > 0 ? ` · ${upcoming.length}` : ""}</div>
      {upcoming.length === 0 && <div style={{ textAlign: "center", padding: "20px 0", color: T.textDim, fontSize: 13 }}>No upcoming time off</div>}
      {upcoming.map((to, i) => <div key={to.person.id + "-" + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: T.surface, borderRadius: T.radiusXs, border: `1px solid ${T.border}`, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: to.person.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{to.person.name[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{to.person.name}</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>{fm(to.start)} → {fm(to.end)} · {to.reason}</div>
        </div>
        <button onClick={() => handleRemove(to.person.id, to.idx)} style={{ background: "none", border: "none", color: T.danger, fontSize: 16, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "12"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>✕</button>
      </div>)}

      {/* Past time off */}
      {past.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8, marginTop: 16 }}>Past · {past.length}</div>
        {past.map((to, i) => <div key={to.person.id + "-p-" + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: T.surface, borderRadius: T.radiusXs, border: `1px solid ${T.border}`, marginBottom: 4, opacity: 0.5 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: to.person.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{to.person.name[0]}</div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, color: T.text }}>{to.person.name}</span>
            <span style={{ fontSize: 12, color: T.textDim, marginLeft: 8 }}>{fm(to.start)} → {fm(to.end)} · {to.reason}</span>
          </div>
        </div>)}
      </>}
    </div>
  </div>;
}
