import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { fetchTasks, saveTasks, fetchPeople, savePeople, fetchClients, saveClients, callAI, fetchMessages, postMessage, deleteThread, uploadAttachment, fetchGroups, saveGroups, callNotify } from "./api.js";
import { TRAQS_LOGO_BLUE, TRAQS_LOGO_WHITE } from "./logo.js";

const COLORS = ["#6366f1","#f43f5e","#10b981","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316","#3b82f6","#84cc16"];
const ADMIN_PERMS = [
  { key: "editJobs",      icon: "✏️",  label: "Create, edit & delete jobs" },
  { key: "moveJobs",      icon: "📅",  label: "Move & resize jobs on Gantt and team view" },
  { key: "reassign",      icon: "👤",  label: "Reassign operations to team members" },
  { key: "lockJobs",      icon: "🔒",  label: "Lock & unlock jobs" },
  { key: "manageTeam",    icon: "👥",  label: "Add, edit & remove team members" },
  { key: "manageClients", icon: "🏢",  label: "Add, edit & delete clients" },
  { key: "undoHistory",   icon: "↩️",  label: "Undo schedule history changes" },
  { key: "orgSettings",   icon: "⚙️",  label: "Access organization settings" },
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
.anim-btn:hover  { transform: translateY(-2px) scale(1.03); box-shadow: 0 10px 28px rgba(0,0,0,0.22); }
.anim-btn:active { transform: scale(0.94) translateY(0); transition-duration: 0.08s; }

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
const Btn = ({ children, onClick, variant = "primary", size = "md", style: sx = {} }) => {
  const base = { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: T.font, fontWeight: 600, cursor: "pointer", borderRadius: T.radiusSm, border: "none" };
  const sizes = { sm: { padding: "7px 14px", fontSize: 13 }, md: { padding: "10px 20px", fontSize: 14 } };
  const vars = { primary: { background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, color: T.accentText, boxShadow: 'none' }, ghost: { background: T.glass, color: T.textSec, border: `1px solid ${T.glassBorder}` }, danger: { background: "transparent", color: T.danger, border: `1px solid ${T.danger}33` }, teal: { background: "transparent", color: "#14b8a6", border: `1px solid #14b8a633` }, warn: { background: "transparent", color: "#f59e0b", border: `1px solid #f59e0b33` } };
  return <button className="anim-btn" onClick={onClick} style={{ ...base, ...sizes[size], ...vars[variant], ...sx }}>{children}</button>;
};
const Card = ({ children, style: sx = {}, delay = 0, onClick }) => <div className="anim-card anim-card-wrap" onClick={onClick}
  onMouseEnter={onClick ? e => { e.currentTarget.style.border = `1px solid ${T.accent}55`; e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.18), 0 0 0 1px ${T.accent}22`; e.currentTarget.style.transform = "translateY(-1px)"; } : undefined}
  onMouseLeave={onClick ? e => { e.currentTarget.style.border = `1px solid ${T.glassBorder}`; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = "none"; } : undefined}
  style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.glassBorder}`, padding: 24, animationDelay: `${delay}ms`, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', cursor: onClick ? "pointer" : undefined, transition: "border 0.15s, box-shadow 0.15s, transform 0.15s", ...sx }}>{children}</div>;
const InputField = ({ label, value, onChange, type = "text", placeholder }) => <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500, fontFamily: T.font }}>{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none", transition: "border 0.2s, box-shadow 0.2s", colorScheme: T.colorScheme }} onFocus={e => { e.target.style.borderColor = T.accent + "55"; e.target.style.boxShadow = `0 0 0 3px ${T.accent}15`; }} onBlur={e => { e.target.style.borderColor = T.glassBorder; e.target.style.boxShadow = "none"; }} /></div>;
const SelectField = ({ label, value, onChange, options }) => <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500, fontFamily: T.font }}>{label}</label><select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.glassBorder}`, background: T.glass, color: T.text, fontSize: 14, fontFamily: T.font, boxSizing: "border-box", outline: "none" }}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></div>;
function CtxMenuItem({ icon, label, sub, onClick }) { return <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "12"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}><span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{label}</div>{sub && <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{sub}</div>}</div></div>; }

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
        if (pill) pill.style.transition = "transform 0.44s cubic-bezier(0.34,1.56,0.64,1), width 0.38s cubic-bezier(0.22,1,0.36,1)";
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
      {options.map(opt => (
        <button key={opt.value} ref={el => { btnRefs.current[opt.value] = el; }} onClick={() => onChange(opt.value)}
          style={{ position:"relative", zIndex:1, padding:pad, borderRadius:T.radiusXs, border:"none", fontSize:fs, fontWeight:value===opt.value?fw:400, cursor:"pointer", fontFamily:T.font, background:"transparent", color:value===opt.value?T.accentText:T.text, transition:"color 0.3s ease", whiteSpace:"nowrap" }}>
          {opt.label}
        </button>
      ))}
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
    <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${open ? T.accent : T.border}`, background: T.surface, cursor: "pointer", transition: "border 0.15s" }}>
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
  const [mobileTab, setMobileTab] = useState("viewall");
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [loginStep] = useState("user"); // kept for any remaining refs
  const handleLogin = () => {};
  const handleLogout = () => logout({ logoutParams: { returnTo: window.location.origin } });

  const processUpload = async () => {
    setUploadProcessing(true);
    setUploadResult(null);
    try {
      // Check if any Excel files — parse them directly (no AI needed)
      const excelFiles = uploadFiles.filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
      const otherFiles = uploadFiles.filter(f => !/\.(xlsx|xls|csv)$/i.test(f.name));
      
      let totalPeople = 0, totalClients = 0, totalJobs = 0;

      // === DIRECT EXCEL PARSING ===
      for (const file of excelFiles) {
        const ab = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = () => rej(new Error("Failed to read file"));
          reader.readAsArrayBuffer(file);
        });
        const XLSX = await new Promise((resolve, reject) => {
          if (window.XLSX) { resolve(window.XLSX); return; }
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          script.onload = () => resolve(window.XLSX);
          script.onerror = () => reject(new Error("Failed to load spreadsheet library"));
          document.head.appendChild(script);
        });
        const wb = XLSX.read(ab, { type: "array", cellDates: true });
        
        // Find the schedule sheet (look for one with "Schedule" or "Dynamic" in name, or use first)
        const sheetName = wb.SheetNames.find(n => /schedule|dynamic/i.test(n)) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
        
        // Find header row
        let headerIdx = 0;
        for (let i = 0; i < Math.min(rows.length, 5); i++) {
          const row = rows[i];
          if (row && row.some(v => typeof v === "string" && /project|due date|start|end/i.test(v))) { headerIdx = i; break; }
        }
        const header = rows[headerIdx] || [];
        const col = {};
        header.forEach((h, i) => { if (h) col[String(h).trim().toLowerCase()] = i; });
        
        // Map column names (flexible matching)
        const cSH = col["sh"] ?? 0;
        const cTitle = col["mtx project"] ?? col["project"] ?? col["title"] ?? 1;
        const cDue = col["due date"] ?? col["due"] ?? 2;
        const cClient = col["cust"] ?? col["client"] ?? col["customer"] ?? 3;
        const cContact = col["contact"] ?? 4;
        const cPO = col["po"] ?? 5;
        const cComplete = col["% complete"] ?? col["complete"] ?? 8;
        const cNotes = col["comments"] ?? col["notes"] ?? 9;
        const cStart = col["start"] ?? 10;
        const cEnd = col["end"] ?? 11;
        const cAssigned = col["assigned to"] ?? col["assigned"] ?? 12;

        // Email-to-name mapping
        const emailMap = {};
        const nameResolve = (raw) => {
          if (!raw) return null;
          raw = String(raw).trim();
          // Check email pattern
          const emailMatch = raw.match(/^([^@]+)@/);
          if (emailMatch) {
            const n = emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1).toLowerCase();
            emailMap[raw.toLowerCase()] = n;
            return n;
          }
          // Already a name - normalize
          return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        };

        const parseDate = (v) => {
          if (!v) return null;
          if (v instanceof Date) return v.toISOString().split("T")[0];
          const s = String(v).trim();
          if (s === "TBD" || s === "N/A") return null;
          // Try ISO parse
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
          return null;
        };

        const parseCompletion = (v) => {
          if (v == null) return 0;
          const n = parseFloat(String(v).replace("%", ""));
          if (isNaN(n)) return 0;
          return n > 1 ? n / 100 : n;
        };

        // Parse hierarchical rows
        const dataRows = rows.slice(headerIdx + 1);
        const jobs = [];
        let curJob = null, curPanel = null;

        for (const row of dataRows) {
          if (!row || row.every(v => v == null || String(v).trim() === "")) continue;
          const sh = row[cSH] != null ? parseInt(String(row[cSH])) : null;
          const title = row[cTitle] ? String(row[cTitle]).trim() : "";
          const start = parseDate(row[cStart]);
          const end = parseDate(row[cEnd]);
          const assigned = nameResolve(row[cAssigned]);
          const completion = parseCompletion(row[cComplete]);
          const dueDate = parseDate(row[cDue]);
          const clientCode = row[cClient] ? String(row[cClient]).trim() : null;
          const contact = row[cContact] ? String(row[cContact]).trim() : null;
          const notes = row[cNotes] ? String(row[cNotes]).trim() : "";
          
          if (sh === 1) {
            // Job level
            const status = completion >= 1 ? "Finished" : completion >= 0.5 ? "In Progress" : completion > 0 ? "In Progress" : "Not Started";
            curJob = { title: title.replace(/\s*-\s*.*$/, "").trim() || title, fullTitle: title, start, end, dueDate, clientCode, contact, notes, status, completion, panels: [] };
            jobs.push(curJob);
            curPanel = null;
          } else if (sh === 2 && curJob) {
            // Panel level
            const status = completion >= 1 ? "Finished" : completion >= 0.5 ? "In Progress" : completion > 0 ? "In Progress" : "Not Started";
            curPanel = { title: title || `${curJob.title}-panel`, start, end, assigned, dueDate, notes, status, completion, ops: [] };
            curJob.panels.push(curPanel);
          } else if (sh === 3 && curPanel) {
            // Operation level
            const opTitle = title.toUpperCase().replace(/^[\d-]+\s*/, "").trim();
            // Normalize op titles
            let normTitle = opTitle;
            if (/^CUT/i.test(opTitle)) normTitle = "Cut";
            else if (/^LABEL/i.test(opTitle)) normTitle = "Labels";
            else if (/^LAYOUT/i.test(opTitle)) normTitle = "Layout";
            else if (/^WIRE/i.test(opTitle)) normTitle = "Wire";
            else if (/^ENGINEER/i.test(opTitle)) normTitle = "Engineering";
            else if (/^PROGRAM/i.test(opTitle)) normTitle = "Programming";
            else normTitle = opTitle.charAt(0).toUpperCase() + opTitle.slice(1).toLowerCase();
            
            curPanel.ops.push({ title: normTitle, start, end, assigned, completion });
          } else if (!sh && curPanel && title) {
            // Sometimes SH column is empty for sub-panels or ops
            const upper = title.toUpperCase();
            if (/^(CUT|LABEL|LAYOUT|WIRE|ENGINEER|PROGRAM)/.test(upper)) {
              let normTitle = upper;
              if (/^CUT/i.test(upper)) normTitle = "Cut";
              else if (/^LABEL/i.test(upper)) normTitle = "Labels";
              else if (/^LAYOUT/i.test(upper)) normTitle = "Layout";
              else if (/^WIRE/i.test(upper)) normTitle = "Wire";
              else if (/^ENGINEER/i.test(upper)) normTitle = "Engineering";
              else if (/^PROGRAM/i.test(upper)) normTitle = "Programming";
              curPanel.ops.push({ title: normTitle, start, end, assigned, completion });
            } else if (/^\d{6}/.test(title)) {
              // Looks like a panel number
              const status = completion >= 1 ? "Finished" : completion > 0 ? "In Progress" : "Not Started";
              curPanel = { title, start, end, assigned, dueDate, notes, status, completion, ops: [] };
              curJob.panels.push(curPanel);
            }
          }
        }

        // Collect unique people from the data
        const foundPeople = new Set();
        jobs.forEach(j => j.panels.forEach(p => {
          if (p.assigned) foundPeople.add(p.assigned);
          p.ops.forEach(op => { if (op.assigned) foundPeople.add(op.assigned); });
        }));

        // Add new people not already in system
        const newPeopleNames = [...foundPeople].filter(n => !people.find(p => p.name.toLowerCase() === n.toLowerCase()));
        const personColors = ["#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#0891b2","#c026d3","#e11d48","#059669","#9333ea"];
        let maxPid = Math.max(0, ...people.map(p => p.id));
        const newPeople = newPeopleNames.map((n, i) => ({
          id: ++maxPid, name: n, role: "Shop", cap: 8,
          color: personColors[i % personColors.length], timeOff: [], userRole: "user"
        }));
        if (newPeople.length > 0) setPeople(prev => [...prev, ...newPeople]);
        totalPeople += newPeople.length;
        const allPeople = [...people, ...newPeople];

        // Client code mapping
        const clientMap = { "FLS": "FLS", "OTC": "OTC", "WTR": "WTR Engineering", "OVO": "OVO", "WHE": "Wheeler CAT", "ROY": "Royal", "Neu": "Nueman Machinery" };

        // Collect unique clients
        const foundClients = new Set();
        jobs.forEach(j => { if (j.clientCode) foundClients.add(j.clientCode); });
        const newClientNames = [...foundClients].filter(code => {
          const fullName = clientMap[code] || code;
          return !clients.find(c => c.name.toLowerCase() === fullName.toLowerCase());
        });
        const newClients = newClientNames.map((code, i) => ({
          id: "c" + (clients.length + i + 1), name: clientMap[code] || code, contact: "", email: "", phone: "",
          color: personColors[(i + 3) % personColors.length], notes: ""
        }));
        if (newClients.length > 0) setClients(prev => [...prev, ...newClients]);
        totalClients += newClients.length;
        const allClients = [...clients, ...newClients];

        // Build TRAQS job structures
        const findPerson = (name) => { if (!name) return null; return allPeople.find(p => p.name.toLowerCase() === name.toLowerCase()); };
        const findClient = (code) => { if (!code) return null; const fullName = clientMap[code] || code; return allClients.find(c => c.name.toLowerCase() === fullName.toLowerCase()); };

        const newJobs = jobs.filter(j => j.panels.length > 0).map(job => {
          const cl = findClient(job.clientCode);
          const panels = job.panels.map(panel => {
            const ops = panel.ops.map(op => {
              const person = findPerson(op.assigned);
              const opComp = op.completion || 0;
              const status = opComp >= 1 ? "Finished" : opComp >= 0.5 ? "In Progress" : opComp > 0 ? "In Progress" : "Not Started";
              return {
                id: uid(), title: op.title, start: op.start || panel.start || job.start || TD,
                end: op.end || panel.end || job.end || TD,
                status, pri: "Medium", team: person ? [person.id] : [],
                hpd: 8, notes: "", deps: []
              };
            });
            const pStart = ops.length > 0 ? ops.reduce((a, b) => (a.start || "9") < (b.start || "9") ? a : b).start : (panel.start || job.start || TD);
            const pEnd = ops.length > 0 ? ops.reduce((a, b) => (a.end || "0") > (b.end || "0") ? a : b).end : (panel.end || job.end || TD);
            return {
              id: uid(), title: panel.title, start: pStart, end: pEnd,
              pri: "Medium", status: panel.status || "Not Started", team: [], hpd: 8, notes: panel.notes || "", deps: [],
              subs: ops
            };
          });
          const jStart = panels.reduce((a, b) => (a.start || "9") < (b.start || "9") ? a : b).start;
          const jEnd = panels.reduce((a, b) => (a.end || "0") > (b.end || "0") ? a : b).end;
          return {
            id: uid(), title: job.title || job.fullTitle, start: jStart, end: jEnd,
            pri: "Medium", status: job.status || "Not Started", team: [], color: "#3b82f6",
            hpd: 8, notes: job.notes || "", clientId: cl ? cl.id : null, dueDate: job.dueDate || "",
            deps: [], subs: panels
          };
        });
        if (newJobs.length > 0) setTasks(prev => [...prev, ...newJobs]);
        totalJobs += newJobs.length;
      }

      // === AI-BASED PARSING for text, images, PDFs ===
      let textContent = "";
      if (uploadText.trim()) textContent += uploadText.trim() + "\n\n";
      const imageBlocks = [];

      for (const file of otherFiles) {
        const isImage = /\.(png|jpg|jpeg)$/i.test(file.name);
        const isPdf = /\.pdf$/i.test(file.name);
        if (isImage) {
          const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("Read failed")); r.readAsDataURL(file); });
          imageBlocks.push({ type: "image", source: { type: "base64", media_type: file.name.endsWith(".png") ? "image/png" : "image/jpeg", data: base64 } });
        } else if (isPdf) {
          const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("Read failed")); r.readAsDataURL(file); });
          imageBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
        } else {
          const text = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Read failed")); r.readAsText(file); });
          textContent += `\n--- File: ${file.name} ---\n${text}\n`;
        }
      }

      if (textContent.trim() || imageBlocks.length > 0) {
        const msgContent = [...imageBlocks];
        if (textContent.trim()) msgContent.push({ type: "text", text: textContent.trim() });

        const existingPeople = [...people, ...Array(totalPeople)].map(p => p ? `${p.name} (${p.role})` : "").filter(Boolean).join(", ");
        const existingClients = clients.map(c => `${c.name} (id:${c.id})`).join(", ");

        const systemPrompt = `You are a scheduling data parser for TRAQS by Matrix Systems LLC, a steel/metal fabrication & electrical panel shop.
EXISTING: Team: ${existingPeople || "None"} | Clients: ${existingClients || "None"}
Parse into JSON: {"people":[{"name":"str","role":"Shop","cap":8,"color":"#hex","userRole":"user"}],"clients":[{"name":"str","contact":"","email":"","phone":"","color":"#hex","notes":""}],"jobs":[{"title":"str","start":"YYYY-MM-DD","end":"YYYY-MM-DD","pri":"Medium","status":"Not Started","notes":"","clientName":"str or null","dueDate":"YYYY-MM-DD or null","panels":[{"title":"str","ops":[{"title":"Wire|Cut|Layout|Labels|Engineering|Programming","start":"YYYY-MM-DD","end":"YYYY-MM-DD","assignedTo":"name or null"}]}]}]}
Rules: Ops within panel are SEQUENTIAL. Panels can run parallel. Skip existing people/clients. Return ONLY JSON.`;

        const data = await callAI({ system: systemPrompt, messages: [{ role: "user", content: msgContent }], max_tokens: 4000 }, getToken);
        const responseText = data.content?.map(b => b.text || "").join("") || "";
        const jsonStr = responseText.replace(/```json\s*|```\s*/g, "").trim();
        const parsed = JSON.parse(jsonStr);

        if (parsed.people?.length > 0) {
          let mx = Math.max(0, ...people.map(p => p.id));
          const np = parsed.people.map((p, i) => ({ id: ++mx, name: p.name, role: p.role || "Shop", cap: 8, color: p.color || COLORS[i % COLORS.length], timeOff: [], userRole: p.userRole || "user" }));
          setPeople(prev => [...prev, ...np]); totalPeople += np.length;
        }
        if (parsed.clients?.length > 0) {
          const nc = parsed.clients.map((c, i) => ({ id: "c" + (clients.length + totalClients + i + 1), name: c.name, contact: c.contact || "", email: c.email || "", phone: c.phone || "", color: c.color || COLORS[i % COLORS.length], notes: c.notes || "" }));
          setClients(prev => [...prev, ...nc]); totalClients += nc.length;
        }
        if (parsed.jobs?.length > 0) {
          const ap = [...people]; const ac = [...clients];
          const nj = parsed.jobs.map(job => {
            const cl = job.clientName ? ac.find(c => c.name.toLowerCase().includes(job.clientName.toLowerCase())) : null;
            const panels = (job.panels || []).map(panel => {
              const ops = (panel.ops || []).map(op => {
                const person = op.assignedTo ? ap.find(p => p.name.toLowerCase() === op.assignedTo.toLowerCase()) : null;
                return { id: uid(), title: op.title || "Wire", start: op.start || job.start, end: op.end || job.end, status: "Not Started", pri: "Medium", team: person ? [person.id] : [], hpd: 8, notes: "", deps: [] };
              });
              const pS = ops.length ? ops.reduce((a, b) => a.start < b.start ? a : b).start : job.start;
              const pE = ops.length ? ops.reduce((a, b) => a.end > b.end ? a : b).end : job.end;
              return { id: uid(), title: panel.title, start: pS, end: pE, pri: "Medium", status: "Not Started", team: [], hpd: 8, notes: "", deps: [], subs: ops };
            });
            const jS = panels.length ? panels.reduce((a, b) => a.start < b.start ? a : b).start : job.start;
            const jE = panels.length ? panels.reduce((a, b) => a.end > b.end ? a : b).end : job.end;
            return { id: uid(), title: job.title, start: jS, end: jE, pri: "Medium", status: job.status || "Not Started", team: [], color: "#3b82f6", hpd: 8, notes: job.notes || "", clientId: cl ? cl.id : null, dueDate: job.dueDate || "", deps: [], subs: panels };
          });
          setTasks(prev => [...prev, ...nj]); totalJobs += nj.length;
        }
      }

      if (totalPeople === 0 && totalClients === 0 && totalJobs === 0 && !uploadText.trim() && uploadFiles.length === 0) {
        setUploadProcessing(false); return;
      }

      setUploadResult({ success: true, message: `Added ${totalPeople} team member${totalPeople !== 1 ? "s" : ""}, ${totalClients} client${totalClients !== 1 ? "s" : ""}, and ${totalJobs} job${totalJobs !== 1 ? "s" : ""}.` });
      setUploadText("");
      setUploadFiles([]);
    } catch (err) {
      console.error(err);
      setUploadResult({ success: false, message: "Error processing data: " + err.message });
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
  const [view, setView] = useState("gantt");
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
  const [fPer, setFPer] = useState("All");
  const [modal, setModal] = useState(null);
  const [engBlockError, setEngBlockError] = useState(null);
  const [engQueueOpen, setEngQueueOpen] = useState(true);
  const [personModal, setPersonModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [settingsUser, setSettingsUser] = useState(null);
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
  // Single layout effect: instant on first paint, animated on every subsequent view change
  useLayoutEffect(() => {
    const btn = navBtnRefs.current[view];
    const pill = navPillRef.current;
    if (!btn || !pill) return;
    if (!navPillTransitioned.current) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      navPillTransitioned.current = true;
      requestAnimationFrame(() => {
        if (pill) pill.style.transition = "transform 0.44s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.38s cubic-bezier(0.22, 1, 0.36, 1)";
      });
    } else {
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
    }
  }, [view]);
  const [timeOffModal, setTimeOffModal] = useState(false);
  const [gStart, setGStart] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [gEnd, setGEnd] = useState(() => { const d = new Date(TD + "T12:00:00"); return toDS(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  const [gMode, setGMode] = useState("month"); // day, week, month
  const [ganttViewMode, setGanttViewMode] = useState("linear"); // linear | calendar
  const [exp, setExp] = useState({});
  const [selBarId, setSelBarId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [clipboard, setClipboard] = useState(null); // { level, item }
  const [pasteConfirm, setPasteConfirm] = useState(null); // { x, y, startDate, endDate }
  const [reminderModal, setReminderModal] = useState(null);
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

  // ─── Push notification token registration ────────────────────────────────
  useEffect(() => {
    if (!loggedInUser) return;
    const register = async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.checkPermissions();
        const status = perm.receive === "granted" ? perm : await PushNotifications.requestPermissions();
        if (status.receive !== "granted") return;
        await PushNotifications.register();
        PushNotifications.addListener("registration", async ({ value: token }) => {
          if (loggedInUser.pushToken === token) return;
          const updated = { ...loggedInUser, pushToken: token };
          setLoggedInUser(updated);
          setPeople(prev => {
            const next = prev.map(p => p.id === loggedInUser.id ? updated : p);
            savePeople(next, getToken, orgCode).catch(console.warn);
            return next;
          });
        });
      } catch {
        // Not running in Capacitor (web browser) — skip silently
      }
    };
    register();
  }, [loggedInUser?.id]);

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
  const [selClient, setSelClient] = useState(null);
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
    const handler = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
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
  useEffect(() => {
    const el = ganttContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setGanttWidth(e.contentRect.width); });
    ro.observe(el);
    setGanttWidth(el.clientWidth);
    return () => ro.disconnect();
  });

  useEffect(() => { const h = () => { setCtxMenu(null); setPtoCtx(null); setSettingsOpen(false); }; window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, []);
  useEffect(() => { const h = e => { if (e.key === "Escape") { setLinkingFrom(null); setCtxMenu(null); setPtoCtx(null); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  const allItems = useMemo(() => { let r = []; const tc = t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.color : T.accent; }; tasks.forEach(t => { const c = tc(t); r.push({ ...t, color: c, isSub: false, pid: null, level: 0 }); (t.subs || []).forEach(s => { r.push({ ...s, color: tc(s) || c, isSub: true, pid: t.id, level: 1 }); (s.subs || []).forEach(op => { r.push({ ...op, color: tc(op) || tc(s) || c, isSub: true, pid: s.id, grandPid: t.id, level: 2 }); }); }); }); return r; }, [tasks, people]);
  const taskColor = useCallback(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.color : T.accent; }, [people]);
  const taskOwner = useCallback(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); return p ? p.name.split(" ")[0] : null; }, [people]);
  const filtered = useMemo(() => tasks.filter(t => { if (fStat !== "All" && t.status !== fStat) return false; if (fPer !== "All") { const p = +fPer; const onOp = (t.subs || []).some(panel => (panel.subs || []).some(op => op.team.includes(p))); if (!t.team.includes(p) && !onOp) return false; } if (fClient !== "All" && t.clientId !== fClient) return false; return true; }).map(t => { const pid = (t.team || [])[0]; const p = people.find(x => x.id === pid); const c = p ? p.color : T.accent; return { ...t, color: c, subs: (t.subs || []).map(s => { const sp = people.find(x => x.id === (s.team || [])[0]); const sc = sp ? sp.color : c; return { ...s, color: sc, subs: (s.subs || []).map(op => { const opp = people.find(x => x.id === (op.team || [])[0]); return { ...op, color: opp ? opp.color : sc }; }) }; }) }; }), [tasks, fStat, fPer, fClient, people]);
  const isOff = useCallback((pid, date) => { const p = people.find(x => x.id === pid); if (!p) return false; return (p.timeOff || []).some(to => date >= to.start && date <= to.end); }, [people]);
  const getOffReason = useCallback((pid, date) => { const p = people.find(x => x.id === pid); if (!p) return null; const to = (p.timeOff || []).find(to => date >= to.start && date <= to.end); return to ? to.reason : null; }, [people]);
  const bookedHrs = useCallback((pid, date) => { if (isOff(pid, date)) return 0; let h = 0; tasks.forEach(t => { (t.subs || []).forEach(panel => { (panel.subs || []).forEach(op => { if (op.team.includes(pid) && date >= op.start && date <= op.end) h += (op.hpd || 0) / Math.max(1, op.team.length); }); }); /* Legacy: also check direct subs without ops */ if (!(t.subs || []).some(s => (s.subs || []).length > 0)) { if (t.team.includes(pid) && date >= t.start && date <= t.end) h += (t.hpd || 0) / Math.max(1, t.team.length); (t.subs || []).forEach(s => { if (s.team.includes(pid) && date >= s.start && date <= s.end) h += (s.hpd || 0) / Math.max(1, s.team.length); }); } }); return h; }, [tasks, isOff]);

  // Check overlaps for a set of operations against a given task list
  // opsToCheck: [{ personId, start, end, opTitle, panelTitle, excludeOpId }]
  const checkOverlapsPure = (taskList, opsToCheck) => {
    const conflicts = [];
    for (const check of opsToCheck) {
      if (!check.personId || !check.start || !check.end) continue;
      const person = people.find(x => x.id === check.personId);
      if (!person) continue;
      for (const job of taskList) {
        for (const panel of (job.subs || [])) {
          for (const op of (panel.subs || [])) {
            if (op.id === check.excludeOpId) continue;
            if (!op.team.includes(check.personId)) continue;
            if (op.status === "Finished") continue;
            if (op.start <= check.end && op.end >= check.start) {
              conflicts.push({ person: person.name, personColor: person.color, opTitle: op.title, panelTitle: panel.title, jobTitle: job.title, start: op.start, end: op.end });
            }
          }
        }
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
  const addPerson = (data) => { setPeople(p => [...p, { ...data, id: Math.max(0, ...p.map(x => x.id)) + 1 }]); setPersonModal(null); };
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
  const openNew = (pid = null) => setModal({ type: "edit", data: { id: null, title: "", jobNumber: "", poNumber: "", start: TD, end: addD(TD, 3), dueDate: "", pri: "Medium", status: "Not Started", team: [], color: T.accent, hpd: 8, notes: "", subs: [], deps: [], clientId: null, jobType: "panel", templateMode: "matrix", customOps: [] }, parentId: pid });
  const openEdit = (t, pid = null) => setModal({ type: "edit", data: { ...t }, parentId: pid });
  const openDetail = t => setModal({ type: "detail", data: t, parentId: null });
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
            opsToCheck.push({ personId: op.team[0], start: op.start, end: op.end, opTitle: op.title, panelTitle: sub.title || "", excludeOpId: op.id });
          }
        });
      } else if ((sub.team || []).length > 0) {
        // Flat subtask (non-panel job)
        opsToCheck.push({ personId: sub.team[0], start: sub.start, end: sub.end, opTitle: sub.title, panelTitle: "", excludeOpId: sub.id });
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
    const withIds = { ...ed, subs: (ed.subs || []).map(panel => ({
      ...panel, id: panel.id || uid(),
      subs: (panel.subs || []).map(op => ({ ...op, id: op.id || uid() }))
    })) };
    if (withIds.id) updTask(withIds.id, withIds, parentId);
    else { const nw = { ...withIds, id: uid() }; if (parentId) setTasks(p => p.map(t => t.id === parentId ? { ...t, subs: [...(t.subs || []), nw] } : t)); else setTasks(p => [...p, nw]); }
    closeModal();
  };
  const views = [{ id: "gantt", icon: "📊", label: "Gantt" }, { id: "tasks", icon: "📋", label: "Tasks" }, { id: "clients", icon: "🏢", label: "Clients" }, { id: "team", icon: "👥", label: "Team" }, { id: "analytics", icon: "📈", label: "Analytics" }, { id: "messages", icon: "💬", label: "Messages" }];
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
      let parentJob = null;
      for (const j of tasks) { for (const p of (j.subs || [])) { if ((p.subs || []).find(o => o.id === item.id)) { parentJob = j; break; } } if (parentJob) break; }
      jobId = parentJob?.id || item.grandPid;
      title = `${item.title}`;
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
      for (const j of tasks) { for (const p of (j.subs || [])) { const o = (p.subs || []).find(x => x.id === opId); if (o) return `${o.title}`; } } return "Operation Chat";
    }
    return "Chat";
  }

  async function saveNewGroup() {
    if (!newGroupName.trim() || !loggedInUser) return;
    const memberIds = newGroupPeople.length > 0 ? newGroupPeople : [loggedInUser.id];
    const newGroup = { id: uid(), name: newGroupName.trim(), memberIds, createdBy: loggedInUser.id, createdAt: new Date().toISOString() };
    const updated = [...groups, newGroup];
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
      alert("Failed to create group. Please try again.");
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
    const onMove = (me) => {
      const days = Math.round(-(me.clientX - startX) / ganttCWRef.current);
      if (days !== lastShift) {
        const delta = days - lastShift;
        lastShift = days;
        setGStart(prev => addD(prev, delta));
        setGEnd(prev => addD(prev, delta));
      }
    };
    const onUp = () => {
      styleEl.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
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
    const onMove = (me) => {
      const days = Math.round(-(me.clientX - startX) / teamCWRef.current);
      if (days !== lastShift) {
        const delta = days - lastShift;
        lastShift = days;
        setTStart(prev => addD(prev, delta));
        setTEnd(prev => addD(prev, delta));
      }
    };
    const onUp = () => {
      styleEl.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [isMobile]);

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
    const rows = []; filtered.forEach(t => { rows.push({ ...t, isSub: false, pid: null, level: 0 }); if (exp[t.id]) (t.subs || []).forEach(s => { rows.push({ ...s, isSub: true, pid: t.id, level: 1 }); if (exp[s.id]) (s.subs || []).forEach(op => rows.push({ ...op, isSub: true, pid: s.id, grandPid: t.id, level: 2 })); }); });
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
                if (op.team[0]) ops.push({ personId: op.team[0], start: addD(op.start, actualDelta), end: addD(op.end, actualDelta), opId: op.id, opTitle: op.title, panelTitle: s.title });
              });
              if ((s.subs || []).length === 0 && s.team && s.team[0]) ops.push({ personId: s.team[0], start: addD(s.start, actualDelta), end: addD(s.end, actualDelta), opId: s.id, opTitle: s.title, panelTitle: item.title });
            });
          } else if (item.level === 1) {
            // Panel-level: ops within panel shift
            (item.subs || []).forEach(op => {
              if (op.team[0]) ops.push({ personId: op.team[0], start: addD(op.start, actualDelta), end: addD(op.end, actualDelta), opId: op.id, opTitle: op.title, panelTitle: item.title });
            });
          } else if (item.team && item.team[0]) {
            // Operation-level
            ops.push({ personId: item.team[0], start: newStart, end: newEnd, opId: item.id, opTitle: item.title, panelTitle: "" });
          }
          return ops;
        };

        // Apply move with log entries — defined outside setTasks so onConfirm can reuse it
        const applyMoveWithLog = (tl) => {
          if (item.level === 0 || (!item.isSub && (item.subs || []).length > 0)) {
            return tl.map(t => {
              if (t.id !== item.id) return t;
              const logEntry = { fromStart: t.start, fromEnd: t.end, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Job moved" };
              return { ...t, start: newStart, end: newEnd, subs: (t.subs || []).map(s => ({
                ...s, start: addD(s.start, actualDelta), end: addD(s.end, actualDelta),
                subs: (s.subs || []).map(op => ({
                  ...op, start: addD(op.start, actualDelta), end: addD(op.end, actualDelta),
                  moveLog: [...(op.moveLog || []), { fromStart: op.start, fromEnd: op.end, toStart: addD(op.start, actualDelta), toEnd: addD(op.end, actualDelta), date: TD, movedBy: movedByName, reason: "Job moved" }]
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
                    return { ...s, start: newStart, end: newEnd, moveLog: [...(s.moveLog || []), logEntry],
                      subs: (s.subs || []).map(op => ({
                        ...op, start: addD(op.start, actualDelta), end: addD(op.end, actualDelta),
                        moveLog: [...(op.moveLog || []), { fromStart: op.start, fromEnd: op.end, toStart: addD(op.start, actualDelta), toEnd: addD(op.end, actualDelta), date: TD, movedBy: movedByName, reason: "Panel moved" }]
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
            excludeOpId: o.opId, opTitle: o.opTitle || item.title, panelTitle: o.panelTitle || ""
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
              setTasks(curr => recalcBounds(applyMoveWithLog(curr), movedByName));
              if (pendingReassign) reassignTask(pendingReassign.id, pendingReassign.fromPid, pendingReassign.toPid, pendingReassign.pidArg);
            }
          }), 0);
          return reverted;
        });
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    };
    const tW = lW + days.length * cW, tH = hH + rows.length * rH;
    return <div>
      <div style={{ display: "flex", marginBottom: isMobile ? 10 : 20, alignItems: "center", position: "relative", minHeight: 44 }}>
        {/* Left: Day/Week/Month + navigation */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ganttViewMode === "linear" && <SlidingPill
            options={["day","week","month"].map(m=>({value:m,label:m.charAt(0).toUpperCase()+m.slice(1)}))}
            value={gMode}
            onChange={m => {
              setGMode(m);
              if (m==="day") { setGStart(TD); setGEnd(TD); }
              else if (m==="week") { const d=new Date(TD+"T12:00:00"); const dow=d.getDay(); const mon=addD(TD,-(dow===0?6:dow-1)); setGStart(mon); setGEnd(addD(mon,6)); }
              else { const d=new Date(TD+"T12:00:00"); const first=new Date(d.getFullYear(),d.getMonth(),1); const last=new Date(d.getFullYear(),d.getMonth()+1,0); setGStart(toDS(first)); setGEnd(toDS(last)); }
            }}
          />}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (ganttViewMode === "calendar" || gMode === "month") { const d = new Date(gStart + "T12:00:00"); d.setMonth(d.getMonth() - 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setGStart(toDS(first)); setGEnd(toDS(last)); }
              else if (gMode === "day") { setGStart(addD(gStart, -1)); setGEnd(addD(gEnd, -1)); }
              else if (gMode === "week") { setGStart(addD(gStart, -7)); setGEnd(addD(gEnd, -7)); }
            }}>◀</Btn>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 180, textAlign: "center" }}>{(() => {
              const s = new Date(gStart + "T12:00:00");
              if (ganttViewMode === "calendar" || gMode === "month") return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
              if (gMode === "day") return s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
              if (gMode === "week") { const e = new Date(gEnd + "T12:00:00"); return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`; }
              return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
            })()}</span>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (ganttViewMode === "calendar" || gMode === "month") { const d = new Date(gStart + "T12:00:00"); d.setMonth(d.getMonth() + 1); const first = new Date(d.getFullYear(), d.getMonth(), 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); setGStart(toDS(first)); setGEnd(toDS(last)); }
              else if (gMode === "day") { setGStart(addD(gStart, 1)); setGEnd(addD(gEnd, 1)); }
              else if (gMode === "week") { setGStart(addD(gStart, 7)); setGEnd(addD(gEnd, 7)); }
            }}>▶</Btn>
          </div>
        </div>
        {/* Center: Linear/Calendar toggle — absolutely centered */}
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
          <SlidingPill
            options={[{value:"linear",label:"Linear"},{value:"calendar",label:"Calendar"}]}
            value={ganttViewMode}
            onChange={v => { setGanttViewMode(v); if (v==="calendar") { const d=new Date(gStart+"T12:00:00"); const first=new Date(d.getFullYear(),d.getMonth(),1); const last=new Date(d.getFullYear(),d.getMonth()+1,0); setGStart(toDS(first)); setGEnd(toDS(last)); setGMode("month"); } }}
          />
        </div>
        {/* Right side: Clipboard + FAST TRAQS + New Job button */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {clipboard && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.accent}44`, background: T.accent + "12", fontSize: 12, color: T.accent, fontWeight: 600, maxWidth: 200 }}>
            <span>📋</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{clipboard.item.title}</span>
            <button onClick={() => setClipboard(null)} title="Clear clipboard" style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 14, padding: "0 0 0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>}
          {can("editJobs") && <><button onClick={() => { setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadModal(true); }} style={{ background: `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`, border: `1px solid ${T.accent}55`, borderRadius: T.radiusSm, padding: "10px 22px", cursor: "pointer", display: "flex", alignItems: "center", fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.accent, animation: "glow-pulse 2.8s ease-in-out infinite", transition: "all 0.2s", letterSpacing: "0.04em" }} onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}35, ${T.accent}1a)`; }} onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`; }}>FAST TRAQS</button><Btn onClick={() => openNew()} style={{ padding: "10px 22px", fontSize: 15 }}>+ New Job</Btn></>}
        </div>
      </div>
      {ganttViewMode === "calendar" ? (() => {
        const calMonth = new Date(gStart + "T12:00:00");
        const yr = calMonth.getFullYear(), mo = calMonth.getMonth();
        const firstDay = new Date(yr, mo, 1), lastDay = new Date(yr, mo + 1, 0);
        const offset = firstDay.getDay();
        const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
        const calDays = Array.from({ length: totalCells }, (_, i) => { const n = i - offset + 1; return (n < 1 || n > lastDay.getDate()) ? null : toDS(new Date(yr, mo, n)); });
        const weeks = []; for (let i = 0; i < calDays.length; i += 7) weeks.push(calDays.slice(i, i + 7));
        const allRows = []; filtered.forEach(t => { allRows.push({...t, lvl: 0}); (t.subs||[]).forEach(s => { allRows.push({...s, lvl: 1}); (s.subs||[]).forEach(op => allRows.push({...op, lvl: 2})); }); });
        const dNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        return <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `2px solid ${T.border}` }}>
            {dNames.map(d => <div key={d} style={{ padding: "10px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: T.textSec, letterSpacing: "0.05em", textTransform: "uppercase" }}>{d}</div>)}
          </div>
          {weeks.map((week, wi) => <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: wi < weeks.length - 1 ? `1px solid ${T.border}` : "none" }}>
            {week.map((day, di) => {
              const isToday = day === TD;
              const dayJobs = day ? allRows.filter(r => r.start <= day && r.end >= day && r.lvl === 0) : [];
              const dt = day ? new Date(day + "T12:00:00") : null;
              const isWknd = dt && [0,6].includes(dt.getDay());
              return <div key={di} style={{ borderRight: di < 6 ? `1px solid ${T.border}` : "none", padding: "6px 4px", background: isToday ? T.accent + "0a" : isWknd ? T.bg + "88" : "transparent", minHeight: 120 }}>
                {day && <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, marginBottom: 4, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: isToday ? T.accent : "transparent", color: isToday ? T.accentText : isWknd ? T.textDim : T.text }}>{dt.getDate()}</div>}
                {dayJobs.slice(0, 4).map(job => <div key={job.id} title={job.title} onClick={() => openDetail(job)} onContextMenu={e => handleCtx(e, job)} style={{ fontSize: 11, fontWeight: 500, color: T.accentText, background: T.accent, borderRadius: 3, padding: "2px 6px", marginBottom: 2, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title}</div>)}
                {dayJobs.length > 4 && <div style={{ fontSize: 10, color: T.textSec, padding: "1px 4px" }}>+{dayJobs.length - 4} more</div>}
              </div>;
            })}
          </div>)}
        </div>;
      })() : <div ref={ganttContainerRef} style={{ width: "100%" }}>
      <div ref={ganttRef} onMouseDown={handleGanttPan} style={{ overflowX: isMobile ? "auto" : "hidden", border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, position: "relative", cursor: "grab" }}>
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
                return <div className="anim-gantt-bar" style={{ position: "absolute", top: 6, left: x, width: w, height: rH - 12, borderRadius: T.radiusXs, background: barBg, border: `1.5px solid ${barColor}`, cursor: can("moveJobs") ? "grab" : "pointer", display: "flex", alignItems: "center", overflow: "hidden", zIndex: r.level === 2 ? 5 : 4, boxShadow: isExp ? `0 2px 8px ${barColor}44` : "none", opacity: isDragging ? 0.55 : 1, transition: isDragging ? "none" : "opacity 0.15s" }}
                  onMouseDown={e => { if (e.button === 0) { e.stopPropagation(); handleDrag(e, r, "move"); } }} onContextMenu={e => handleCtx(e, r)}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "rgba(255,255,255,0.15)", borderRadius: T.radiusXs - 1 }} />
                  {can("moveJobs") && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleDrag(e, r, "left"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 16, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                  {can("moveJobs") && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleDrag(e, r, "right"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 16, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                  <span style={{ fontSize: r.level === 2 ? 11 : 12, color: accentText(barColor), fontWeight: 600, padding: "0 12px", position: "relative", zIndex: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5, flex: 1 }}>{hasSubs && <span style={{ fontSize: 9, opacity: 0.7, flexShrink: 0 }}>{isExp ? "▼" : "▶"}</span>}{r.level === 0 && r.jobNumber && <span style={{ opacity: 0.7, fontWeight: 500, flexShrink: 0 }}>{r.jobNumber} ·</span>}{r.title}{hasSubs && <span style={{ fontSize: 10, opacity: 0.6 }}>({r.subs.length})</span>}{taskOwner(r) && <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>· {taskOwner(r)}</span>}</span>
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
  const finishedTasks = tasks.filter(t => t.status === "Finished");
  const activeTasks = filtered.filter(t => t.status !== "Finished");

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

  const renderTasks = () => <div>
    {/* Engineering Queue — only for engineers/admins */}
    {canSignOffEngineering && engQueueItems.length > 0 && <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>🔧</span>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#3b82f6" }}>Engineering Queue</h2>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", background: "#3b82f620", borderRadius: 10, padding: "2px 10px", border: "1px solid #3b82f633" }}>{engQueueItems.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {engQueueItems.map(({ job, panel }) => {
          const e = panel.engineering || {};
          const activeStep = !e.designed ? "designed" : !e.verified ? "verified" : "sentToPerforex";
          return <div key={panel.id} style={{ background: T.card, border: `1px solid #3b82f630`, borderTop: `3px solid #3b82f6`, borderRadius: T.radiusSm, padding: "14px 16px", boxShadow: `0 2px 12px #3b82f610` }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, marginBottom: 2 }}>{job.jobNumber ? `#${job.jobNumber} · ` : ""}{job.title}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{panel.title}</div>
              <div style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, marginTop: 2 }}>{fm(panel.start)} → {fm(panel.end)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {engSteps.map(step => {
                const done = !!e[step.key];
                const isActive = step.key === activeStep;
                if (done) return <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: T.radiusXs, background: "#10b98110", border: "1px solid #10b98130" }}>
                  <span style={{ color: "#10b981", fontSize: 13, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#10b981", flex: 1 }}>{step.label}</span>
                  <span style={{ fontSize: 10, color: T.textDim }}>{e[step.key].byName.split(" ")[0]}, {fm(e[step.key].at.split("T")[0])}</span>
                  {canSignOffEngineering && <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Revert" style={{ padding: "1px 7px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>}
                </div>;
                if (isActive) return <button key={step.key} onClick={() => canSignOffEngineering ? signOffEngineering(job.id, panel.id, step.key) : undefined} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: T.radiusXs, background: canSignOffEngineering ? "#3b82f6" : "#3b82f615", border: "none", cursor: canSignOffEngineering ? "pointer" : "default", width: "100%", fontFamily: T.font }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: canSignOffEngineering ? "#fff" : "#3b82f6", flex: 1, textAlign: "left" }}>→ {step.label}</span>
                  {canSignOffEngineering && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }}>Sign off</span>}
                </button>;
                return <div key={step.key} style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, opacity: 0.35 }}>
                  <span style={{ fontSize: 12, color: T.textDim }}>○ {step.label}</span>
                </div>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>}
    {/* Engineering Finished — only for engineers/admins */}
    {canSignOffEngineering && engFinishedItems.length > 0 && <div style={{ marginBottom: 28 }}>
      <div style={{ borderTop: `1px solid #10b98133`, position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", top: -10, left: 0, background: T.bg, paddingRight: 12, fontSize: 11, color: "#10b981", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Engineering Finished</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {engFinishedItems.map(({ job, panel }) => {
          const e = panel.engineering || {};
          return <div key={panel.id} style={{ background: T.card, border: `1px solid #10b98130`, borderTop: `3px solid #10b981`, borderRadius: T.radiusSm, padding: "12px 14px", opacity: 0.85 }}>
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, marginBottom: 2 }}>{job.jobNumber ? `#${job.jobNumber} · ` : ""}{job.title}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>{panel.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {engSteps.map(step => <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: T.radiusXs, background: "#10b98108", border: "1px solid #10b98120" }}>
                <span style={{ color: "#10b981", fontSize: 12, flexShrink: 0 }}>✓</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#10b981", flex: 1 }}>{step.label}</span>
                <span style={{ fontSize: 10, color: T.textDim }}>{e[step.key]?.byName?.split(" ")[0]}, {fm(e[step.key]?.at?.split("T")[0])}</span>
                {canSignOffEngineering && <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Revert" style={{ padding: "1px 7px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>}
              </div>)}
            </div>
          </div>;
        })}
      </div>
    </div>}
    {/* All Jobs separator */}
    {canSignOffEngineering && (engQueueItems.length > 0 || engFinishedItems.length > 0) && <div style={{ margin: "0 0 14px", borderTop: `1px solid ${T.border}`, position: "relative" }}>
      <span style={{ position: "absolute", top: -9, left: 0, background: T.bg, paddingRight: 10, fontSize: 10, color: T.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>All Jobs</span>
    </div>}
    {/* Active tasks */}
    <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
    {activeTasks.map((t, ti) => <Card key={t.id} delay={ti * 35} style={{ borderLeft: `4px solid ${t.color}`, padding: 16 }} onClick={() => openDetail(t)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><HealthIcon t={t} /><h3 style={{ margin: 0, color: T.text, fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{t.title}</h3></div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }} onClick={e => e.stopPropagation()}>{can("editJobs") && <><Btn variant="ghost" size="sm" onClick={() => openEdit(t)}>Edit</Btn><Btn variant="danger" size="sm" onClick={() => delTask(t.id)}>✕</Btn></>}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>{t.clientId && <Badge t={clientName(t.clientId)} c={clientColor(t.clientId)} />}</div>
      <div style={{ fontSize: 12, color: T.textSec, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontFamily: T.mono, fontSize: 12 }}>{fm(t.start)}</span><span style={{ color: T.textDim }}>→</span><span style={{ fontFamily: T.mono, fontSize: 12 }}>{fm(t.end)}</span><span style={{ color: T.textDim }}>·</span><span>{t.hpd}h/day</span></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>{t.team.map(id => <Badge key={id} t={pName(id)} c={T.accent} />)}</div>
      {t.notes && <div style={{ fontSize: 12, color: T.textDim, fontStyle: "italic", marginBottom: 8, lineHeight: 1.5 }}>{t.notes.substring(0, 100)}</div>}
      {(t.deps || []).length > 0 && <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>⛓ {t.deps.length} dependency(s)</div>}
      {(t.subs || []).length > 0 && <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
        {t.subs.map(s => {
          const hasEng = s.engineering !== undefined;
          const e = s.engineering || {};
          const allDone = hasEng && !!(e.designed && e.verified && e.sentToPerforex);
          const activeStep = hasEng ? (!e.designed ? "designed" : !e.verified ? "verified" : "sentToPerforex") : null;
          return <div key={s.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <HealthIcon t={s} size={11} />
              <span style={{ flex: 1, fontSize: 12, color: T.textSec, fontWeight: 500 }}>{s.title}</span>
              {allDone && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ Eng Ready</span>}
            </div>
            {hasEng && !allDone && <div style={{ display: "flex", gap: 6, paddingLeft: 19, flexWrap: "wrap", marginTop: 2 }}>
              {engSteps.map(step => {
                const done = !!e[step.key];
                const isActive = step.key === activeStep;
                if (done) return <span key={step.key} style={{ fontSize: 10, color: "#10b981", display: "flex", alignItems: "center", gap: 2 }}>✓ <span style={{ color: T.textDim }}>{step.label}</span></span>;
                if (isActive) return <span key={step.key} style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>→ {step.label}</span>;
                return <span key={step.key} style={{ fontSize: 10, color: T.textDim, opacity: 0.4 }}>○ {step.label}</span>;
              })}
            </div>}
          </div>;
        })}
      </div>}
      {can("editJobs") && <div style={{ marginTop: 10, display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}><Btn variant="ghost" size="sm" onClick={() => openNew(t.id)}>+ Subtask</Btn></div>}
    </Card>)}
    </div>
    {/* All Jobs Finished section */}
    {finishedTasks.length > 0 && <div style={{ marginTop: 32 }}>
      <div style={{ margin: "0 0 16px", borderTop: `1px solid ${T.border}`, position: "relative" }}>
        <span style={{ position: "absolute", top: -10, left: 0, background: T.bg, paddingRight: 12, fontSize: 11, color: T.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>All Jobs Finished</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 12 }}>
        {finishedTasks.map(t => <div key={t.id} onClick={() => openDetail(t)}
          onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.borderColor = "#10b98166"; e.currentTarget.style.boxShadow = "0 2px 10px rgba(16,185,129,0.12)"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
          style={{ background: T.card, borderRadius: T.radiusSm, padding: "14px 18px", border: `1px solid ${T.border}`, borderLeft: `4px solid #10b981`, opacity: 0.75, cursor: "pointer", transition: "opacity 0.15s, border-color 0.15s, box-shadow 0.15s" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 15 }}>✅</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
              {t.clientId && <Badge t={clientName(t.clientId)} c={clientColor(t.clientId)} />}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>{fm(t.start)} → {fm(t.end)}</span>
              {can("editJobs") && <Btn variant="danger" size="sm" onClick={() => delTask(t.id)}>✕</Btn>}
            </div>
          </div>
        </div>)}
      </div>
    </div>}
    </>
  </div>;

  // ═══════════════════ CLIENTS ═══════════════════
  const renderClients = () => {
    const sel = selClient ? clients.find(c => c.id === selClient) : null;
    const selTasks = selClient ? tasks.filter(t => t.clientId === selClient) : [];
    const selAllItems = selClient ? allItems.filter(i => { const parent = tasks.find(t => t.id === (i.pid || i.id)); return parent && parent.clientId === selClient; }) : [];
    const completed = selTasks.filter(t => t.status === "Finished").length;
    const inProg = selTasks.filter(t => t.status === "In Progress").length;
    const totalHrs = selTasks.reduce((a, t) => a + (t.hpd || 0) * (diffD(t.start, t.end) + 1), 0);

    return <div style={{ display: "flex", gap: 24, height: "100%" }}>
      {/* Client list sidebar */}
      <div style={{ minWidth: 320, maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Clients</h3>
          {can("manageClients") && <Btn size="sm" onClick={() => setClientModal({ id: null, name: "", contact: "", email: "", phone: "", color: COLORS[Math.floor(Math.random() * 10)], notes: "" })}>+ Add</Btn>}
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {clients.map(c => {
            const ct = tasks.filter(t => t.clientId === c.id);
            const active = ct.filter(t => t.status !== "Finished").length;
            const done = ct.filter(t => t.status === "Finished").length;
            const isSel = selClient === c.id;
            return <div key={c.id} onClick={() => setSelClient(isSel ? null : c.id)} style={{
              background: isSel ? c.color + "18" : T.card, borderRadius: T.radius,
              border: `1.5px solid ${isSel ? c.color + "66" : T.border}`,
              padding: "16px 18px", cursor: "pointer", transition: "all 0.15s ease",
              boxShadow: isSel ? `0 0 20px ${c.color}15` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: c.color, flexShrink: 0, boxShadow: `0 0 8px ${c.color}44` }} />
                <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {can("manageClients") && <span onClick={e => { e.stopPropagation(); setClientModal({ ...c }); }} style={{ cursor: "pointer", fontSize: 13, color: T.textDim, padding: "2px 6px", borderRadius: 4 }}>Edit</span>}
                </div>
              </div>
              <div style={{ fontSize: 13, color: T.textSec, marginBottom: 4 }}>{c.contact}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: T.textDim }}>
                <span>{ct.length} job{ct.length !== 1 ? "s" : ""}</span>
                {active > 0 && <span style={{ color: "#3b82f6" }}>{active} active</span>}
                {done > 0 && <span style={{ color: "#10b981" }}>{done} done</span>}
              </div>
            </div>;
          })}
          {clients.length === 0 && <div style={{ textAlign: "center", padding: 40, color: T.textDim, fontSize: 14 }}>No clients yet. Click <strong>+ Add</strong> to create one.</div>}
        </div>
      </div>

      {/* Client detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!sel ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}>🏢</div>
            <div style={{ fontSize: 16, color: T.textDim }}>Select a client to view their jobs</div>
          </div>
        ) : (
          <div>
            {/* Client header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: sel.color + "22", border: `2px solid ${sel.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: sel.color }}>{sel.name.charAt(0)}</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: T.text }}>{sel.name}</h2>
                  <div style={{ fontSize: 14, color: T.textSec, marginTop: 4, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {sel.contact && <span>👤 {sel.contact}</span>}
                    {sel.email && <span>✉ {sel.email}</span>}
                    {sel.phone && <span>📞 {sel.phone}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {can("manageClients") && <Btn size="sm" onClick={() => setClientModal({ ...sel })}>Edit Client</Btn>}
                {can("manageClients") && <Btn variant="danger" size="sm" onClick={() => { delClient(sel.id); setSelClient(null); }}>Delete</Btn>}
              </div>
            </div>

            {sel.notes && <div style={{ fontSize: 14, color: T.textSec, padding: 16, background: T.surface, borderRadius: T.radiusSm, marginBottom: 20, lineHeight: 1.6, border: `1px solid ${T.border}` }}>{sel.notes}</div>}

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Total Jobs", val: selTasks.length, color: sel.color },
                { label: "In Progress", val: inProg, color: "#3b82f6" },
                { label: "Finished", val: completed, color: "#10b981" },
                { label: "Est. Hours", val: totalHrs, color: "#f59e0b" },
              ].map(s => <div key={s.label} style={{ background: T.card, borderRadius: T.radiusSm, padding: "16px 18px", border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: T.mono }}>{s.val}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
              </div>)}
            </div>

            {/* Jobs list */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Jobs ({selTasks.length})</h4>
              {can("editJobs") && <Btn size="sm" onClick={() => { const m = { type: "edit", data: { id: null, title: "", start: TD, end: addD(TD, 3), pri: "Medium", status: "Not Started", team: [], color: T.accent, hpd: 8, notes: "", subs: [], deps: [], clientId: sel.id }, parentId: null }; setModal(m); }}>+ Add Job</Btn>}
            </div>
            {selTasks.length === 0 && <div style={{ textAlign: "center", padding: 32, color: T.textDim, fontSize: 14, background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}` }}>No jobs assigned to this client yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selTasks.map(t => {
                const dur = diffD(t.start, t.end) + 1;
                const pct = t.status === "Finished" ? 100 : t.status === "In Progress" ? 50 : t.status === "Pending" ? 15 : t.status === "On Hold" ? 25 : 0;
                return <div key={t.id} style={{ background: T.card, borderRadius: T.radiusSm, padding: "16px 20px", border: `1px solid ${T.border}`, borderLeft: `4px solid ${t.color}`, opacity: t.status === "Finished" ? 0.7 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <HealthIcon t={t} />
                      <span style={{ fontSize: 15, fontWeight: 700, color: T.text, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => openDetail(t)}>{t.title}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      <Badge t={t.pri} c={PRI_C[t.pri]} />

                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, color: T.textSec, marginBottom: 10 }}>
                    <span style={{ fontFamily: T.mono }}>{fm(t.start)} → {fm(t.end)}</span>
                    <span>{dur} day{dur !== 1 ? "s" : ""}</span>
                    <span>{t.hpd}h/day</span>
                    {(t.subs || []).length > 0 && <span>{t.subs.length} subtask{t.subs.length !== 1 ? "s" : ""}</span>}
                  </div>
                  {/* Progress bar */}
                  <div style={{ background: T.bg, borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ height: "100%", borderRadius: 4, background: t.color, width: `${pct}%`, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{t.team.slice(0, 5).map(id => <Badge key={id} t={pName(id)} c={T.accent} />)}{t.team.length > 5 && <Badge t={`+${t.team.length - 5}`} c={T.textDim} />}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {can("editJobs") && <><Btn variant="ghost" size="sm" onClick={() => openEdit(t)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => delTask(t.id)}>✕</Btn></>}
                    </div>
                  </div>
                </div>;
              })}
            </div>
          </div>
        )}
      </div>
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
      return bars;
    };
    // Build flat row list with subtask expansion
    const rowList = []; roles.forEach(role => {
      rowList.push({ type: "group", role, util: grpUtil(role) });
      if (!tCollapsed[role]) roleMap[role].forEach(p => {
        const bars = getPersonBars(p.id);
        rowList.push({ type: "person", person: p, util: getUtil(p.id), bars });
      });
    });
    const subH = 34;
    const tW = lW + days.length * cW;
    const totalH = rowList.reduce((s, r) => s + (r.type === "group" ? grpH : rH), 0) + 56;

    return <div>
      {/* Top nav */}
      <div style={{ display: "flex", gap: isMobile ? 6 : 12, marginBottom: isMobile ? 10 : 20, alignItems: "center", flexWrap: "wrap", position: "relative", minHeight: 44, justifyContent: isAdmin ? "flex-start" : "center" }}>
        {isAdmin && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn variant="primary" size="sm" onClick={() => setPersonModal({ id: null, name: "", role: "", email: "", cap: 8, color: COLORS[Math.floor(Math.random() * COLORS.length)], teamNumber: null, isTeamLead: false, isEngineer: false, userRole: "user" })}>+ Add Member</Btn>
          <Btn variant="teal" size="sm" onClick={openAvail}>🔍 Availability</Btn>
          <Btn variant="warn" size="sm" onClick={() => setTimeOffModal(true)}>📅 Time Off</Btn>
        </div>}
        <div style={{ position: isAdmin ? "absolute" : "relative", left: isAdmin ? "50%" : "auto", transform: isAdmin ? "translateX(-50%)" : "none", display: "flex", gap: 12, alignItems: "center" }}>
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
        {can("editJobs") && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadModal(true); }} style={{ background: `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`, border: `1px solid ${T.accent}55`, borderRadius: T.radiusSm, padding: "10px 22px", cursor: "pointer", display: "flex", alignItems: "center", fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.accent, animation: "glow-pulse 2.8s ease-in-out infinite", transition: "all 0.2s", letterSpacing: "0.04em" }} onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}35, ${T.accent}1a)`; }} onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${T.accent}22, ${T.accent}0d)`; }}>FAST TRAQS</button>
          <button onClick={() => openNew()} style={{ padding: "10px 26px", borderRadius: T.radiusSm, border: "none", background: T.accent, color: T.accentText, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: T.font, letterSpacing: "0.3px", transition: "all 0.15s", whiteSpace: "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
            + New Job
          </button>
        </div>}
      </div>
      {/* Resource timeline grid */}
      <div ref={teamContainerRef} style={{ width: "100%" }}>
      <div ref={teamRef} onMouseDown={handleTeamPan} style={{ overflow: isMobile ? "auto" : "hidden", border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.surface, position: "relative", cursor: "grab" }}>
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
                  {can("manageTeam") && <button onClick={e => { e.stopPropagation(); setPersonModal({ name: "", email: "", role: row.role, cap: 8, color: COLORS[Math.floor(Math.random() * COLORS.length)], timeOff: [], userRole: row.role === "Admin" ? "admin" : "user" }); }} style={{ width: 24, height: 24, borderRadius: 8, background: T.accent, border: "none", color: T.accentText, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }} title={`Add ${row.role} member`}>+</button>}
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
            return <div key={p.id} data-rowtype="person" data-rowid={p.id} style={{ display: "flex", height: rH, borderBottom: `1px solid ${isDrop ? T.accent : T.bg + "55"}`, position: "relative", background: isDrop ? T.accent + "08" : "transparent", opacity: isBeingDragged ? 0.35 : 1, transition: "background 0.15s, border-color 0.15s, opacity 0.1s" }}>
              {/* Insertion line indicators */}
              {isDragBefore && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: T.accent, zIndex: 20, borderRadius: 1, boxShadow: `0 0 6px ${T.accent}` }} />}
              {isDragAfter  && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: T.accent, zIndex: 20, borderRadius: 1, boxShadow: `0 0 6px ${T.accent}` }} />}
              <div style={{ minWidth: lW, maxWidth: lW, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 8px", borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, background: isDrop ? T.accent + "0c" : T.surface, zIndex: 10, transition: "background 0.15s" }}>
                {/* Drag handle */}
                <div onMouseDown={e => startRowDrag(e, p.id)} style={{ cursor: "grab", color: T.textDim, fontSize: 14, padding: "4px 2px", flexShrink: 0, lineHeight: 1, userSelect: "none", opacity: 0.5 }} title="Drag to reorder">⠿</div>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: p.color + "22", border: `1.5px solid ${p.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: p.color, flexShrink: 0 }}>{p.teamNumber ? String(p.teamNumber) : p.name.charAt(0)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.teamNumber ? `${p.teamNumber} - ${p.name}` : p.name}</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>{p.role} · {p.cap}h</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: utilC, fontFamily: T.mono, flexShrink: 0 }}>{row.util}%</span>
                {can("manageTeam") && <Btn variant="ghost" size="sm" style={{ padding: "4px 6px", fontSize: 11 }} onClick={() => setPersonModal({ ...p })}>Edit</Btn>}
              </div>
              <div style={{ flex: 1, position: "relative", display: "flex" }}>
                {days.map(day => { const dt = new Date(day + "T12:00:00"); const wk = [0, 6].includes(dt.getDay()); const pOff = isOff(p.id, day); const offR = pOff ? getOffReason(p.id, day) : null; const offType = pOff ? ((p.timeOff || []).find(to => day >= to.start && day <= to.end) || {}).type || "PTO" : null; const offColor = offType === "UTO" ? "#f59e0b" : "#10b981"; return <div key={day} title={pOff ? `${offType}: ${offR}` : ""} style={{ flex: 1, height: "100%", background: pOff ? offColor + "12" : day === TD ? T.accent + "08" : wk ? T.bg + "aa" : "transparent", borderRight: `1px solid ${T.bg}33`, position: "relative" }}>{pOff && <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(135deg, ${offColor}12, ${offColor}12 4px, transparent 4px, transparent 8px)`, pointerEvents: "none" }} />}</div>; })}
                {/* Team drag ghost overlay — snapped position with glow */}
                {teamDragInfo && teamDragInfo.targetPersonId === p.id && (() => {
                  const { snapStart, snapEnd, hasOverlap } = teamDragInfo;
                  const nDays = days.length;
                  const gx = (diffD(tStart, snapStart) / nDays * 100) + "%";
                  const gw = (Math.max(diffD(snapStart, snapEnd) + 1, 1) / nDays * 100) + "%";
                  const gc = hasOverlap ? "#ef4444" : T.accent;
                  return <div key="team-ghost" style={{ position: "absolute", top: 4, left: `calc(${gx} + 1px)`, width: gw, height: rH - 8, borderRadius: 20, border: `2px solid ${gc}`, background: gc + "1a", boxShadow: `0 0 28px ${gc}77, 0 0 10px ${gc}55, 0 0 56px ${gc}33`, pointerEvents: "none", zIndex: 3, animation: "ghost-fade-in 0.2s cubic-bezier(0.34,1.56,0.64,1)" }} />;
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
                    const sx = e.clientX, sy = e.clientY;
                    const os = bar.task.start, oe = bar.task.end;
                    const taskPid = bar.task.pid || null;
                    const origPerson = p.id;
                    let moved = false, lastDropPid = null, lastDx = 0;
                    const barEl = e.currentTarget;
                    const origLeft = barEl.style.left;
                    const gridEl = teamRef.current;
                    const onM = me => {
                      const pxDx = me.clientX - sx;
                      const pxDy = me.clientY - sy;
                      const dx = Math.round(pxDx / cW);
                      if (Math.abs(pxDx) > 2 || Math.abs(pxDy) > 8) moved = true;
                      // 2D free movement — bar follows cursor in both axes
                      barEl.style.transform = `translate(${pxDx}px, ${pxDy}px)`;
                      barEl.style.zIndex = "30";
                      barEl.style.opacity = "0.82";
                      barEl.style.boxShadow = `0 8px 40px rgba(0,0,0,0.45), 0 0 30px ${bar.color || "#6366f1"}99`;
                      barEl.style.transition = "box-shadow 0.08s, opacity 0.08s";
                      // Detect target row vertically
                      if (gridEl) {
                        const personRows = gridEl.querySelectorAll("[data-person-id]");
                        let found = null;
                        personRows.forEach(el => {
                          const rect = el.getBoundingClientRect();
                          if (me.clientY >= rect.top && me.clientY <= rect.bottom) found = +el.getAttribute("data-person-id");
                        });
                        if (found !== lastDropPid) { lastDropPid = found; setDropTarget(found); }
                      }
                      // Compute snap ghost position + overlap check
                      const rawS = addD(os, dx);
                      const rawE = addD(oe, dx);
                      const snapS = nextBD(rawS);
                      const snapDelta = diffD(rawS, snapS);
                      const snapE = snapDelta > 0 ? addD(rawE, snapDelta) : rawE;
                      const targetPid = lastDropPid || origPerson;
                      const movingTaskId = bar.task?.id;
                      let hasOverlap = false;
                      outerTeam: for (const job of tasks) {
                        for (const panel of (job.subs || [])) {
                          for (const op of (panel.subs || [])) {
                            if (op.id === movingTaskId || op.status === "Finished") continue;
                            if (!(op.team || []).includes(targetPid)) continue;
                            if (op.start <= snapE && op.end >= snapS) { hasOverlap = true; break outerTeam; }
                          }
                        }
                      }
                      setTeamDragInfo({ barId: bar.id, snapStart: snapS, snapEnd: snapE, targetPersonId: targetPid, hasOverlap });
                    };
                    const onU = me => {
                      document.removeEventListener("mousemove", onM);
                      document.removeEventListener("mouseup", onU);
                      // Reset visual styles
                      barEl.style.transform = "";
                      barEl.style.zIndex = "";
                      barEl.style.opacity = "";
                      barEl.style.boxShadow = "";
                      barEl.style.transition = "";
                      setDropTarget(null);
                      setTeamDragInfo(null);
                      if (!moved) {
                        if (bar.task) openDetail(bar.task);
                        return;
                      }
                      // Compute final dx from total mouse displacement
                      const finalDx = Math.round((me.clientX - sx) / cW);
                      const personId = bar.task.team[0] || origPerson;
                      const rawStart = addD(os, finalDx);
                      const rawEnd = addD(oe, finalDx);
                      const newStart = nextBD(rawStart);
                      const delta = diffD(rawStart, newStart);
                      const newEnd = addD(rawEnd, delta);
                      const movedByName = loggedInUser ? loggedInUser.name : "Admin";
                      // Revert first, then decide
                      setTasks(prev => {
                        let reverted = prev.map(t => {
                          if (taskPid) {
                            const pi2 = (t.subs || []).findIndex(s => s.id === taskPid);
                            if (pi2 >= 0) { const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => op.id === bar.task.id ? { ...op, start: os, end: oe } : op) }; return { ...t, subs: ns }; }
                          }
                          return t;
                        });
                        // Check locked
                        let isLocked = false;
                        reverted.forEach(j => (j.subs || []).forEach(pnl => (pnl.subs || []).forEach(op => { if (op.id === bar.task.id && op.locked) isLocked = true; })));
                        if (isLocked) { setTimeout(() => showLockedError([{ opTitle: bar.task.title, panelTitle: bar.task.panelTitle || "" }]), 0); return reverted; }
                        // Check PTO
                        const person = people.find(x => x.id === personId);
                        if (person) {
                          for (const to of (person.timeOff || [])) {
                            if (to.start <= newEnd && to.end >= newStart) {
                              setTimeout(() => showOverlapIfAny([{ person: person.name, isPto: true, panelTitle: to.reason || to.type || "PTO", start: to.start, end: to.end }]), 0);
                              return reverted;
                            }
                          }
                        }
                        // Build the moved task state (apply move + log) — defined outside setTasks for onConfirm
                        const applyMove = (tl) => tl.map(t => {
                          if (taskPid) {
                            const pi2 = (t.subs || []).findIndex(s => s.id === taskPid);
                            if (pi2 >= 0) { const ns = [...t.subs]; ns[pi2] = { ...ns[pi2], subs: (ns[pi2].subs || []).map(op => {
                              if (op.id === bar.task.id) {
                                const logEntry = { fromStart: os, fromEnd: oe, toStart: newStart, toEnd: newEnd, date: TD, movedBy: movedByName, reason: "Manual move" };
                                return { ...op, start: newStart, end: newEnd, moveLog: [...(op.moveLog || []), logEntry] };
                              }
                              return op;
                            }) }; return { ...t, subs: ns }; }
                          }
                          return t;
                        });
                        // Check for scheduling conflicts — hard block if person is double-booked
                        const schedConflicts = checkOverlapsPure(reverted, [{
                          personId, start: newStart, end: newEnd,
                          excludeOpId: bar.task.id, opTitle: bar.task.title, panelTitle: bar.task.panelTitle || ""
                        }]);
                        if (schedConflicts.length > 0) {
                          setTimeout(() => showOverlapIfAny(schedConflicts), 0);
                          return reverted;
                        }
                        // No conflicts — show confirmation before committing
                        setTimeout(() => setConfirmMove({
                          title: "Confirm Move",
                          message: `Move "${bar.task.title}" from ${fm(os)} → ${fm(oe)} to ${fm(newStart)} → ${fm(newEnd)}?`,
                          onCancel: () => setConfirmMove(null),
                          onConfirm: () => {
                            setConfirmMove(null);
                            setTasks(curr => recalcBounds(applyMove(curr), movedByName));
                            if (lastDropPid && lastDropPid !== origPerson) {
                              reassignTask(bar.task.id, origPerson, lastDropPid, taskPid);
                            }
                          }
                        }), 0);
                        return reverted;
                      });
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
                  return <div key={bar.id} title={bar.title + (bar.clientName ? ` (${bar.clientName})` : "") + (barLocked ? " 🔒 Locked" : "") + (hasMoveLog ? " 📋 Has schedule changes" : "") + (bar.hasSubs ? " (click to expand)" : "")}
                    onMouseDown={e => { if (e.button === 0) { e.stopPropagation(); handleTeamDrag(e); } }}
                    onContextMenu={e => { if (isPto && can("manageTeam")) { e.preventDefault(); setPtoCtx({ x: e.clientX, y: e.clientY, bar, personId: bar.personId, toIdx: bar.toIdx }); } else if (!isPto && bar.task) handleCtx(e, bar.task, "team"); }}
                    style={{ position: "absolute", top: 4, left: `calc(${x} + 2px)`, width: `calc(${w} - 4px)`, height: rH - 8, borderRadius: T.radiusXs, background: isPto ? `repeating-linear-gradient(135deg, ${bc}33, ${bc}33 4px, ${bc}18 4px, ${bc}18 8px)` : bc, border: barLocked ? `2px solid rgba(255,255,255,0.7)` : `1.5px solid ${isPto ? bc + "55" : bc}`, cursor: isPto ? (can("manageTeam") ? "grab" : "default") : barLocked ? "not-allowed" : can("moveJobs") ? "grab" : "pointer", display: "flex", alignItems: "center", padding: "0 12px", overflow: "hidden", zIndex: isPto ? 3 : 4, boxShadow: barLocked ? `0 0 8px rgba(255,255,255,0.15)` : isExp ? `0 2px 8px ${bc}44` : "none" }}
                    onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; }} onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
                    {can("moveJobs") && !barLocked && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleTeamResize(e, "left"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 14, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                    {can("moveJobs") && !barLocked && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { e.stopPropagation(); handleTeamResize(e, "right"); }} onMouseEnter={e => e.currentTarget.querySelector('.grip').style.opacity=1} onMouseLeave={e => e.currentTarget.querySelector('.grip').style.opacity=0}><div className="grip" style={{ width: 3, height: 14, borderRadius: 2, background: "rgba(255,255,255,0.7)", opacity: 0, transition: "opacity 0.15s", boxShadow: "0 0 4px rgba(0,0,0,0.3)" }} /></div>}
                    {barLocked && <span style={{ fontSize: 11, marginRight: 4, flexShrink: 0, position: "relative", zIndex: 3, opacity: 0.9 }}>🔒</span>}
                    {hasMoveLog && <span style={{ width: 6, height: 6, borderRadius: 3, background: "#f59e0b", flexShrink: 0, position: "relative", zIndex: 3, boxShadow: "0 0 4px #f59e0b66" }} title="Schedule was changed" />}
                    {bar.hasSubs && <span style={{ fontSize: 9, color: "#fff", marginRight: 4, opacity: 0.7, flexShrink: 0, position: "relative", zIndex: 3 }}>{isExp ? "▼" : "▶"}</span>}
                    <span style={{ fontSize: 11, color: isPto ? bar.color : "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative", zIndex: 3, flex: 1 }}>{isPto ? `${bar.ptoType === "UTO" ? "📋" : "🏖️"} ${bar.title}` : bar.jobNumber ? <>{bar.jobNumber && <span style={{ opacity: 0.75, fontWeight: 500, marginRight: 4 }}>{bar.jobNumber} ·</span>}{bar.title}</> : bar.title}</span>

                  </div>;
                })}
              </div>
            </div>;
          })}
          {/* Today line */}
          {TD >= tStart && TD <= tEnd && <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${lW}px + (100% - ${lW}px) * ${(diffD(tStart, TD) + 0.5) / days.length})`, width: 2, background: T.accent + "bb", zIndex: 12, pointerEvents: "none" }} />}
        </div>
      </div>
      </div>
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
        {can("editJobs") && <button onClick={() => openNew()} style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ New</button>}
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
    const mobileView = view === "gantt" ? "home" : view;

    const renderMobileHome = () => <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* My Tasks / View All toggle */}
      <SlidingPill
        options={[{value:"mytasks",label:"My Tasks"},{value:"viewall",label:"View All"}]}
        value={mobileTab}
        onChange={setMobileTab}
        style={{ margin:"8px 12px" }}
      />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
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
            <button onClick={() => delTask(t.id)} style={{ background: T.danger + "18", border: "none", borderRadius: 6, padding: "5px 7px", fontSize: 11, color: T.danger, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✕</button>
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
      return <div style={{ padding: "8px 12px", overflow: "auto", flex: 1 }}>
        {/* Engineering Queue */}
        {engQueueItems.length > 0 && <div style={{ marginBottom: 12 }}>
          <div onClick={() => setMobileExp(p => ({ ...p, eng_queue: !p.eng_queue }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#3b82f615", borderRadius: T.radiusSm, border: "1px solid #3b82f630", cursor: "pointer", marginBottom: mobileEngOpen ? 6 : 0 }}>
            <span style={{ fontSize: 14 }}>🔧</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6", flex: 1 }}>Engineering Queue</span>
            <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 700, background: "#3b82f620", borderRadius: 10, padding: "1px 8px" }}>{engQueueItems.length}</span>
            <span style={{ fontSize: 11, color: T.textDim, marginLeft: 4 }}>{mobileEngOpen ? "▲" : "▼"}</span>
          </div>
          {mobileEngOpen && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {engQueueItems.map(({ job, panel }) => {
              const e = panel.engineering || {};
              const activeStep = !e.designed ? "designed" : !e.verified ? "verified" : "sentToPerforex";
              return <div key={panel.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: "3px solid #3b82f6", borderRadius: T.radiusSm, padding: "11px 13px" }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 3, fontFamily: T.mono }}>{job.jobNumber ? `#${job.jobNumber} · ` : ""}{job.title}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>{panel.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {engSteps.map(step => {
                    const done = !!e[step.key];
                    const isActive = step.key === activeStep;
                    if (done) return <span key={step.key} style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>✓ {step.label}{canSignOffEngineering && <button onClick={() => revertEngineering(job.id, panel.id, step.key)} title="Revert" style={{ marginLeft: 2, padding: "1px 5px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 9, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>}</span>;
                    if (isActive && canSignOffEngineering) return <button key={step.key} onClick={() => signOffEngineering(job.id, panel.id, step.key)} style={{ padding: "5px 13px", borderRadius: 14, background: "#3b82f6", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>;
                    if (isActive) return <span key={step.key} style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>→ {step.label}</span>;
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
          {can("editJobs") && <button onClick={() => openNew()} style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ New Job</button>}
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
            {can("editJobs") && <button onClick={() => delTask(t.id)} style={{ background: T.danger + "18", border: "none", borderRadius: 6, padding: "5px 7px", fontSize: 11, color: T.danger, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>✕</button>}
          </div>)}
        </>}
      </div>;
    };

    const renderMobileClients = () => <div style={{ padding: "8px 12px", overflow: "auto", flex: 1 }}>
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

    const renderMobileTeam = () => <div style={{ padding: "8px 12px", overflow: "auto", flex: 1 }}>
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
      return <div style={{ padding: "8px 12px", overflow: "auto", flex: 1 }}>
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

    const renderMobileMore = () => <div style={{ padding: "8px 12px", overflow: "auto", flex: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { icon: "🏢", label: "Clients", sub: `${clients.length} client${clients.length !== 1 ? "s" : ""}`, action: () => setView("clients") },
          { icon: "📈", label: "Analytics", sub: "Charts & stats", action: () => setView("analytics") },
          ...(isAdmin ? [{ icon: "👤", label: "Users", sub: "Manage team access", action: () => setUsersOpen(true) }] : []),
          { icon: "⚙️", label: "Appearance", sub: "Theme & preferences", action: () => setSettingsOpen(p => !p) },
        ].map(item => <div key={item.label} onClick={item.action} style={{ display: "flex", gap: 14, padding: "16px 14px", background: T.card, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, cursor: "pointer", alignItems: "center" }} onTouchStart={e => e.currentTarget.style.background = T.accent + "10"} onTouchEnd={e => e.currentTarget.style.background = T.card}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{item.label}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{item.sub}</div>
          </div>
          <span style={{ fontSize: 18, color: T.textDim }}>›</span>
        </div>)}
        <div onClick={() => setConfirmLogout(true)} style={{ display: "flex", gap: 14, padding: "16px 14px", background: T.card, borderRadius: T.radiusSm, border: `1px solid ${T.danger}22`, cursor: "pointer", alignItems: "center", marginTop: 4 }} onTouchStart={e => e.currentTarget.style.background = T.danger + "10"} onTouchEnd={e => e.currentTarget.style.background = T.card}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🚪</span>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.danger }}>Log Out</div>
        </div>
      </div>
    </div>;

    const bottomTabs = [
      { id: "home", icon: "📅", label: "Home", setV: () => setView("gantt") },
      { id: "tasks", icon: "📋", label: "Jobs", setV: () => setView("tasks") },
      { id: "team", icon: "👥", label: "Team", setV: () => setView("team") },
      { id: "messages", icon: "💬", label: "Chat", setV: () => setView("messages"), badge: unreadMessages.length },
      { id: "more", icon: "⋯", label: "More", setV: () => setView("more") },
    ];
    const moreActive = mobileView === "more" || mobileView === "clients" || mobileView === "analytics";

    return <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Mobile header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 14, background: loggedInUser.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{loggedInUser.name[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{loggedInUser.name}</div>
          <div style={{ fontSize: 10, color: isAdmin ? T.accent : T.textDim }}>{isAdmin ? "Admin" : "Crew"}</div>
        </div>
        {can("editJobs") && <button onClick={() => openNew()} style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ New</button>}
        <button onClick={e => { e.stopPropagation(); setNotifOpen(p => !p); }} style={{ position: "relative", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 14 }}>
          🔔
          {unreadByThread.length > 0 && <span style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: 7, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff" }}>{unreadMessages.length > 9 ? "9+" : unreadMessages.length}</span>}
        </button>
        <button onClick={e => { e.stopPropagation(); setSettingsOpen(p => !p); }} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 14 }}>⚙️</button>
      </div>
      {/* Search bar */}
      <div style={{ padding: "8px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div ref={searchRef} style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: T.radiusSm, border: `1px solid ${searchOpen ? T.accent : T.border}`, background: T.bg, transition: "border 0.15s" }}>
            <span style={{ fontSize: 13, color: T.textDim }}>🔍</span>
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
              {personResults.slice(0, 4).map(p => <div key={p.id} onClick={() => { setSearchQ(""); setSearchOpen(false); setView("team"); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text, borderBottom: `1px solid ${T.border}22` }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
              </div>)}
              {clientResults.slice(0, 4).map(c => <div key={c.id} onClick={() => { setSearchQ(""); setSearchOpen(false); setView("clients"); setMobileExp(p => ({ ...p, ["c_" + c.id]: true })); }} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text, borderBottom: `1px solid ${T.border}22` }}>
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
      {/* Page title */}
      {mobileView !== "home" && mobileView !== "messages" && <div style={{ padding: "10px 16px 4px", flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{{ tasks: "📋 Jobs", clients: "🏢 Clients", team: "👥 Team", analytics: "📈 Analytics", more: "⋯ More" }[mobileView] || ""}</span>
      </div>}
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: mobileView === "messages" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
        {mobileView === "home" && renderMobileHome()}
        {mobileView === "tasks" && renderMobileTasks()}
        {mobileView === "clients" && renderMobileClients()}
        {mobileView === "team" && renderMobileTeam()}
        {mobileView === "analytics" && renderMobileAnalytics()}
        {mobileView === "messages" && renderMessages()}
        {mobileView === "more" && renderMobileMore()}
      </div>
      {/* Bottom tab bar */}
      <div style={{ display: "flex", background: T.surface, borderTop: `1px solid ${T.border}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {bottomTabs.map(tab => {
          const isActive = tab.id === "more" ? moreActive : mobileView === tab.id;
          return <button key={tab.id} onClick={tab.setV} style={{ flex: 1, padding: "10px 4px 8px", border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", color: isActive ? T.accent : T.textDim, fontFamily: T.font, position: "relative", transition: "color 0.15s" }}>
            {isActive && <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 2, background: T.accent, borderRadius: "0 0 2px 2px" }} />}
            <span style={{ fontSize: tab.icon === "⋯" ? 22 : 20, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 400 }}>{tab.label}</span>
            {tab.badge > 0 && <span style={{ position: "absolute", top: 6, right: "calc(50% - 16px)", minWidth: 14, height: 14, borderRadius: 7, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff", padding: "0 3px", boxSizing: "border-box" }}>{tab.badge > 9 ? "9+" : tab.badge}</span>}
          </button>;
        })}
      </div>
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
        if (icon === "👥") {
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
        <div style={{ width: 36, height: 36, borderRadius: 18, background: isActive ? T.accent + "30" : T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
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
          {can("editJobs") && <button onClick={() => setNewGroupModal(true)} title="New group" style={{ background: T.accent, border: "none", color: T.accentText, borderRadius: 6, width: 22, height: 22, fontSize: 14, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>}
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
            {renderThread(tk, (isPinned ? "📌 " : "") + g.name, latest, unreadCount(tk), "👥")}
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
            const icon = t.scope === "op" ? "🔧" : t.scope === "panel" ? "📦" : "🏗";
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
            <div style={{ fontSize: 48 }}>💬</div>
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
                <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
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
    const ov = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 24px", overflow: "auto" };
    const bx = (wide) => ({ background: T.card, borderRadius: 16, padding: 32, maxWidth: wide ? 1000 : 600, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" });
    const cls = <button onClick={closeModal} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", position: "absolute", top: 20, right: 24, padding: 4, lineHeight: 1 }}>✕</button>;
    if (modal.type === "edit") { const [ed, setEd] = [modal.data, d => setModal(p => ({ ...p, data: typeof d === "function" ? d(p.data) : d }))];
      const addPanels = (count) => {
        const isMatrix = (ed.templateMode || "matrix") === "matrix";
        const rawOps = isMatrix
          ? [{ title: "Wire", durationBD: 1 }, { title: "Cut", durationBD: 1 }, { title: "Layout", durationBD: 1 }]
          : (ed.customOps || []).filter(o => o.title && o.title.trim());
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
            opSubs.push({ id: null, title: op.title, start: opStart, end: opEnd, status: "Not Started", pri: "High", team: [], hpd: ed.hpd, notes: "", deps: [] });
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
          const isMatrix = (ed.templateMode || "matrix") === "matrix";
          const rawOps = isMatrix
            ? [{ title: "Wire", durationBD: 1 }, { title: "Cut", durationBD: 1 }, { title: "Layout", durationBD: 1 }]
            : (ed.customOps || []).filter(o => o.title && o.title.trim());
          const opsPerPanel = Math.max(rawOps.length, 1);
          const crew = isMatrix
            ? people.filter(p => p.userRole === "user" && p.role?.toLowerCase() === "shop" && !p.noAutoSchedule)
            : people.filter(p => p.userRole === "user" && !p.noAutoSchedule);
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
                const freeNow = crew.filter(p => isPersonFree(p.id, bStart, bEnd));
                const panelsThisBatch = Math.max(Math.floor(freeNow.length / opsPerPanel), 0);

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

      const isPanel = (ed.jobType || "panel") === "panel";
      const isMatrix = isPanel && (ed.templateMode || "matrix") === "matrix";
      const shopCrew = isMatrix
        ? people.filter(p => p.userRole === "user" && p.role?.toLowerCase() === "shop")
        : people.filter(p => p.userRole === "user");

      // Template save helper
      const saveAsTemplate = () => {
        const ops = (ed.customOps || []).filter(o => o.title && o.title.trim());
        if (!ops.length) return;
        const name = prompt("Template name:");
        if (!name || !name.trim()) return;
        persistTemplates([...templates, { id: uid(), name: name.trim(), ops }]);
      };
      const loadTemplate = (tpl) => {
        setEd(p => ({ ...p, customOps: tpl.ops.map(o => ({ ...o })) }));
      };
      const deleteTemplate = (tid) => {
        persistTemplates(templates.filter(t => t.id !== tid));
      };

      return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(true), position: "relative", maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>{cls}        {/* ── Header ── */}
        <h3 style={{ margin: "0 0 20px", color: T.text, fontSize: 22, fontWeight: 700 }}>{ed.id ? "Edit" : isPanel ? "New Job" : "New Task"}</h3>

        {/* ── Job Type toggle — centered, prominent ── */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <SlidingPill
            options={[{value:"panel",label:"Panel Job"},{value:"general",label:"General Task"}]}
            value={ed.jobType || "panel"}
            onChange={v => setEd(p => ({ ...p, jobType: v, subs: [] }))}
            size="lg"
          />
        </div>

        {/* ── Panel job fields ── */}
        {isPanel && <>
          <InputField label="Job Name" value={ed.title} onChange={v => setEd(p => ({ ...p, title: v }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InputField label="Job #" value={ed.jobNumber || ""} onChange={v => setEd(p => ({ ...p, jobNumber: v }))} placeholder="e.g. 2024-001" />
            <InputField label="PO #" value={ed.poNumber || ""} onChange={v => setEd(p => ({ ...p, poNumber: v }))} placeholder="e.g. PO-8821" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InputField label="Due Date (Customer)" value={ed.dueDate || ""} onChange={v => setEd(p => ({ ...p, dueDate: v }))} type="date" />
            <InputField label="Hours/day" value={ed.hpd} onChange={v => setEd(p => ({ ...p, hpd: +v }))} type="number" />
          </div>
          <SearchSelect label="Client" value={ed.clientId} onChange={v => setEd(p => ({ ...p, clientId: v }))} options={clients.map(c => ({ value: c.id, label: c.name, color: c.color, sub: c.contact }))} placeholder="Search clients..." />
        </>}

        {/* ── General task fields — simple ── */}
        {!isPanel && <>
          <InputField label="Task Name" value={ed.title} onChange={v => setEd(p => ({ ...p, title: v }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InputField label="Due Date (optional)" value={ed.dueDate || ""} onChange={v => setEd(p => ({ ...p, dueDate: v }))} type="date" />
            <InputField label="Hours/day" value={ed.hpd} onChange={v => setEd(p => ({ ...p, hpd: +v }))} type="number" />
          </div>
          <SearchSelect label="Client (optional)" value={ed.clientId} onChange={v => setEd(p => ({ ...p, clientId: v }))} options={clients.map(c => ({ value: c.id, label: c.name, color: c.color, sub: c.contact }))} placeholder="Search clients..." />
        </>}

        {/* ── Template toggle (panel only) — seamless pill switch ── */}
        {isPanel && <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: isMatrix ? 0 : 14 }}>
            <label style={{ fontSize: 13, color: T.textSec, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>Template</label>
            <SlidingPill
              options={[{value:"matrix",label:"Matrix"},{value:"custom",label:"Custom"}]}
              value={ed.templateMode || "matrix"}
              onChange={v => setEd(p => ({ ...p, templateMode: v, subs: [] }))}
            />
          </div>

          {/* Custom ops editor */}
          {(ed.templateMode || "matrix") === "custom" && <div style={{ marginTop: 12 }}>
            {/* Subtask cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {(ed.customOps || []).map((op, oi) => {
                const updateOp = (patch) => { const ops = [...(ed.customOps || [])]; ops[oi] = { ...ops[oi], ...patch }; setEd(p => ({ ...p, customOps: ops })); };
                return <div key={oi} style={{ background: T.bg, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, padding: 12 }}>
                  {/* Op title row */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: (op.subs || []).length ? 8 : 0 }}>
                    <input value={op.title} onChange={e => updateOp({ title: e.target.value })} placeholder="Subtask name" style={{ flex: 1, padding: "7px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
                    <button onClick={() => setEd(p => ({ ...p, customOps: (p.customOps || []).filter((_, j) => j !== oi) }))} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 13, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  {/* Nested sub-subtasks */}
                  {(op.subs || []).map((sub, si) => <div key={si} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, paddingLeft: 16 }}>
                    <div style={{ width: 2, height: 20, background: T.border, borderRadius: 2, flexShrink: 0 }} />
                    <input value={sub.title} onChange={e => { const subs = [...(op.subs || [])]; subs[si] = { ...subs[si], title: e.target.value }; updateOp({ subs }); }} placeholder="Sub-subtask name" style={{ flex: 1, padding: "5px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: T.font, boxSizing: "border-box" }} />
                    <button onClick={() => updateOp({ subs: (op.subs || []).filter((_, j) => j !== si) })} style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 12, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>)}
                  {/* Small add sub-subtask button */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: (op.subs || []).length ? 4 : 8 }}>
                    <button onClick={() => updateOp({ subs: [...(op.subs || []), { id: uid(), title: "" }] })} style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Add Subtask</button>
                  </div>
                </div>;
              })}
            </div>
            {/* Big centered + Add Subtask */}
            <button onClick={() => setEd(p => ({ ...p, customOps: [...(p.customOps || []), { title: "", durationBD: 1, subs: [] }] }))} style={{ display: "block", width: "100%", padding: "18px 0", borderRadius: T.radiusSm, border: `2px dashed #8b5cf655`, background: "#8b5cf608", color: "#8b5cf6", fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: T.font, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#8b5cf618"; e.currentTarget.style.borderColor = "#8b5cf6"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#8b5cf608"; e.currentTarget.style.borderColor = "#8b5cf655"; }}>
              + Add Subtask
            </button>
          </div>}
        </div>}

        {/* Panel count (matrix template only) */}
        {isPanel && isMatrix && !ed.id && <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 8, fontWeight: 500 }}>Number of Panels</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="number" min="1" max="50" value={(ed.subs || []).length || ""} onChange={e => { const n = Math.max(1, Math.min(50, parseInt(e.target.value) || 0)); if (n > 0) addPanels(n); }} style={{ width: 80, padding: "10px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 16, fontWeight: 700, fontFamily: T.mono, textAlign: "center", boxSizing: "border-box" }} />
            <span style={{ fontSize: 13, color: T.textDim }}>panels for this job</span>
          </div>
        </div>}

        {/* AI Schedule Suggestion (panel + matrix only) */}
        {isPanel && isMatrix && <div style={{ marginBottom: 20 }}>
          <button onClick={suggestSchedule} disabled={aiLoading || (ed.subs || []).length === 0} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 18px", borderRadius: T.radiusSm, border: "none", background: (ed.subs || []).length === 0 ? T.textDim + "33" : "#3b82f6", color: "#fff", fontSize: 15, fontWeight: 700, cursor: aiLoading || (ed.subs || []).length === 0 ? "not-allowed" : "pointer", fontFamily: T.font, transition: "all 0.2s", width: "100%", opacity: (ed.subs || []).length === 0 ? 0.5 : 1, boxShadow: (ed.subs || []).length > 0 ? "0 4px 14px rgba(59,130,246,0.35)" : "none", letterSpacing: "0.3px" }}>
            {aiLoading ? "⏳ Checking availability..." : "Check for Availability!"}
          </button>

          {aiSuggestion && <div style={{ marginTop: 12 }}>
            {/* Header message based on result */}
            {aiSuggestion.canMeetDue === true && <div style={{ padding: "12px 16px", background: "#10b98112", border: "1px solid #10b98133", borderRadius: T.radiusSm, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>✅</span>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>Yes! We can meet the {fm(aiSuggestion.dueDate)} deadline</div>
              <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>Found {aiSuggestion.slots.length} schedule option{aiSuggestion.slots.length > 1 ? "s" : ""} for {aiSuggestion.numPanels} panel{aiSuggestion.numPanels > 1 ? "s" : ""}</div></div>
            </div>}
            {aiSuggestion.canMeetDue === false && <div style={{ padding: "12px 16px", background: "#ef444412", border: "1px solid #ef444433", borderRadius: T.radiusSm, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
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
                      const _isMatrix = (p.templateMode || "matrix") === "matrix";
                      const _rawOps = _isMatrix
                        ? [{ title: "Wire", durationBD: 1 }, { title: "Cut", durationBD: 1 }, { title: "Layout", durationBD: 1 }]
                        : (p.customOps || []).filter(o => o.title && o.title.trim());
                      const opsPerPanel = Math.max(_rawOps.length, 1);
                      const bd = slot.businessDays || (diffBD(slot.start, slot.end) + 1);
                      const totalDur = _rawOps.reduce((s, o) => s + Math.max(o.durationBD || 1, 1), 0);
                      const scaledDurs = _rawOps.map(o => Math.max(Math.round(Math.max(o.durationBD || 1, 1) * bd / totalDur), 1));
                      scaledDurs[scaledDurs.length - 1] += bd - scaledDurs.reduce((s, d) => s + d, 0);

                      const allCrew = _isMatrix
                        ? people.filter(pp => pp.userRole === "user" && pp.role?.toLowerCase() === "shop" && !pp.noAutoSchedule)
                        : people.filter(pp => pp.userRole === "user" && !pp.noAutoSchedule);

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
        </div>}

        {/* Panel-only sections */}
        {isPanel && <>
          {/* Completion dates (filled by AI or manual) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><InputField label="Completion Start" value={ed.start} onChange={v => setEd(p => ({ ...p, start: v }))} type="date" /><InputField label="Completion End" value={ed.end} onChange={v => setEd(p => ({ ...p, end: v }))} type="date" /></div>

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
                    const opColor = assignedPerson ? assignedPerson.color : ["#3b82f6", "#f59e0b", "#10b981"][oi % 3];
                    return <div key={oi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: assignedPerson ? assignedPerson.color + "08" : T.bg, borderRadius: T.radiusXs, border: `1px solid ${assignedPerson ? assignedPerson.color + "44" : T.border}` }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: opColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, minWidth: 50 }}>{op.title}</span>
                      <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{fm(op.start)} → {fm(op.end)}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {shopCrew.map(p => {
                          const sel = op.team.includes(p.id);
                          const busy = !sel && isPersonBusy(p.id, op.start, op.end, pi, oi);
                          const isLead = p.isTeamLead && p.teamNumber;
                          return <button key={p.id} onClick={() => {
                            if (busy) return;
                            const newSubs = [...ed.subs];
                            const newOps = [...newSubs[pi].subs];
                            newOps[oi] = { ...newOps[oi], team: sel ? [] : [p.id] };
                            newSubs[pi] = { ...newSubs[pi], subs: newOps };
                            setEd(prev => ({ ...prev, subs: newSubs }));
                          }} title={busy ? `${p.name} is busy during this period` : isLead ? `${p.name} — Team ${p.teamNumber} Lead` : p.name} style={{ padding: "4px 10px", borderRadius: 8, border: `2px solid ${sel ? p.color : busy ? T.danger + "33" : T.border}`, background: sel ? p.color : busy ? T.danger + "08" : "transparent", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: sel ? "#fff" : busy ? T.danger + "88" : T.textSec, fontWeight: sel ? 700 : 400, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, transition: "all 0.15s", fontFamily: T.font, whiteSpace: "nowrap", textDecoration: busy ? "line-through" : "none" }}>
                            <span style={{ width: 18, height: 18, borderRadius: 6, background: sel ? "rgba(255,255,255,0.25)" : busy ? T.danger + "15" : p.color + "22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: sel ? "#fff" : busy ? T.danger + "88" : p.color, flexShrink: 0 }}>{p.name[0]}</span>
                            {p.name}
                            {isLead && <span style={{ fontSize: 10, opacity: sel ? 0.85 : 0.6 }}>⭐</span>}
                          </button>;
                        })}
                      </div>
                    </div>;
                  })}
                </div>
              </div>)}
            </div>
          </div>}
        </>}

        {/* Non-panel sections */}
        {!isPanel && <>
          {/* Start / End date row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InputField label="Start Date" value={ed.start} onChange={v => setEd(p => ({ ...p, start: v }))} type="date" />
            <InputField label="End Date" value={ed.end} onChange={v => setEd(p => ({ ...p, end: v }))} type="date" />
          </div>

          {/* Assigned To */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Assign To</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {people.filter(p => p.userRole === "user").map(p => {
                const sel = (ed.team || []).includes(p.id);
                const busy = !sel && ed.start && ed.end && isPersonBusy(p.id, ed.start, ed.end, -1, -1);
                const isLead = p.isTeamLead && p.teamNumber;
                return <button key={p.id} onClick={() => {
                  if (busy) return;
                  setEd(prev => ({ ...prev, team: sel ? (prev.team || []).filter(id => id !== p.id) : [...(prev.team || []), p.id] }));
                }} title={busy ? `${p.name} is busy during this period` : isLead ? `${p.name} — Team ${p.teamNumber} Lead` : p.name}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, border: `2px solid ${sel ? p.color : busy ? T.danger + "44" : T.border}`, background: sel ? p.color : busy ? T.danger + "08" : T.surface, color: sel ? "#fff" : busy ? T.danger + "88" : T.textSec, fontWeight: sel ? 700 : 400, fontSize: 13, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.55 : 1, transition: "all 0.15s", fontFamily: T.font, textDecoration: busy ? "line-through" : "none" }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, background: sel ? "rgba(255,255,255,0.25)" : busy ? T.danger + "15" : p.color + "22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: sel ? "#fff" : busy ? T.danger + "88" : p.color, flexShrink: 0 }}>{p.name[0]}</span>
                  {pName(p.id)}
                  {isLead && <span style={{ fontSize: 10, opacity: sel ? 0.85 : 0.6 }}>⭐</span>}
                  {busy && <span style={{ fontSize: 10 }}>✗</span>}
                </button>;
              })}
            </div>
            {(ed.team || []).length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: T.textSec }}>
              {(ed.team || []).length} person{(ed.team || []).length > 1 ? "s" : ""} assigned
            </div>}
          </div>

          {/* Flat subtask builder */}
          <div style={{ marginBottom: 20 }}>
            {(ed.subs || []).length === 0
              ? <button onClick={() => setEd(p => ({ ...p, subs: [...(p.subs || []), { id: uid(), title: "", start: p.start || TD, end: p.end || addD(TD, 3), status: "Not Started", pri: "Medium", team: [], hpd: p.hpd || 8, notes: "", deps: [] }] }))} style={{ display: "block", width: "100%", padding: "22px 0", borderRadius: T.radiusSm, border: `2px dashed ${T.accent}55`, background: T.accent + "08", color: T.accent, fontSize: 20, fontWeight: 800, cursor: "pointer", fontFamily: T.font, letterSpacing: "0.3px", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = T.accent + "18"; e.currentTarget.style.borderColor = T.accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.accent + "08"; e.currentTarget.style.borderColor = T.accent + "55"; }}>
                + Add Subtask
              </button>
              : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: T.textSec, fontWeight: 600 }}>Subtasks</label>
                  <button onClick={() => setEd(p => ({ ...p, subs: [...(p.subs || []), { id: uid(), title: "", start: p.start || TD, end: p.end || addD(TD, 3), status: "Not Started", pri: "Medium", team: [], hpd: p.hpd || 8, notes: "", deps: [] }] }))} style={{ padding: "5px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.accent}55`, background: T.accent + "10", color: T.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>+ Add Subtask</button>
                </div>
            }
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(ed.subs || []).map((sub, si) => <div key={sub.id || si} style={{ background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input value={sub.title} onChange={e => { const subs = [...ed.subs]; subs[si] = { ...subs[si], title: e.target.value }; setEd(p => ({ ...p, subs })); }} placeholder="Task name" style={{ flex: 1, padding: "7px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, boxSizing: "border-box" }} />
                  <input type="date" value={sub.start} onChange={e => { const subs = [...ed.subs]; subs[si] = { ...subs[si], start: e.target.value }; setEd(p => ({ ...p, subs })); }} style={{ colorScheme: T.colorScheme, padding: "7px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, boxSizing: "border-box" }} />
                  <span style={{ color: T.textDim, fontSize: 12 }}>→</span>
                  <input type="date" value={sub.end} onChange={e => { const subs = [...ed.subs]; subs[si] = { ...subs[si], end: e.target.value }; setEd(p => ({ ...p, subs })); }} style={{ colorScheme: T.colorScheme, padding: "7px 8px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, boxSizing: "border-box" }} />
                  <button onClick={() => setEd(p => ({ ...p, subs: p.subs.filter((_, j) => j !== si) }))} style={{ padding: "5px 9px", borderRadius: 6, border: `1px solid ${T.danger}33`, background: T.danger + "10", color: T.danger, fontSize: 13, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: T.textDim, marginRight: 4, alignSelf: "center" }}>Assign:</span>
                  {people.filter(p => p.userRole === "user").map(p => {
                    const sel = (sub.team || []).includes(p.id);
                    return <button key={p.id} onClick={() => { const subs = [...ed.subs]; subs[si] = { ...subs[si], team: sel ? (sub.team || []).filter(id => id !== p.id) : [...(sub.team || []), p.id] }; setEd(prev => ({ ...prev, subs })); }} style={{ padding: "3px 10px", borderRadius: 8, border: `2px solid ${sel ? p.color : T.border}`, background: sel ? p.color : "transparent", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: sel ? "#fff" : T.textSec, fontWeight: sel ? 700 : 400, cursor: "pointer", transition: "all 0.15s", fontFamily: T.font }}>
                      <span style={{ width: 16, height: 16, borderRadius: 5, background: sel ? "rgba(255,255,255,0.25)" : p.color + "22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: sel ? "#fff" : p.color, flexShrink: 0 }}>{p.name[0]}</span>
                      {p.name.split(" ")[0]}
                    </button>;
                  })}
                </div>
              </div>)}
            </div>
          </div>
        </>}

        <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Notes</label><textarea value={ed.notes} onChange={e => setEd(p => ({ ...p, notes: e.target.value }))} rows={3} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, resize: "vertical", boxSizing: "border-box" }} /></div>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}><Btn variant="ghost" onClick={closeModal}>Cancel</Btn><Btn onClick={() => saveTask(ed, modal.parentId)}>Save Job</Btn></div>
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
              <span style={{ fontSize: 14 }}>🔒</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>Locked</span>
            </div>}
          </div>
          {/* Title */}
          <h3 style={{ margin: "0 0 6px", color: T.text, fontSize: 22, fontWeight: 700 }}>{opData.title}{parentPanel ? ` – ${parentPanel.title}` : ""}</h3>
          {parentJob && <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: T.textDim, marginBottom: 6 }}>{parentJob.title}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {parentJob.jobNumber && <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>Job # {parentJob.jobNumber}</span>}
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
            {can("lockJobs") && parentPanel && <Btn variant={isOpLocked ? "warn" : "ghost"} onClick={() => { toggleLock(opData.id, parentPanel.id); closeModal(); }}>{isOpLocked ? "🔓 Unlock" : "🔒 Lock"}</Btn>}
            {parentJob && <Btn variant="ghost" onClick={() => { closeModal(); openDetail(parentJob); }}>View Full Job</Btn>}
          </div>
        </div></div>;
      }
      // Job-level detail (existing)
      const parent = tasks.find(x => x.id === fresh.id);
      return <div className="anim-modal-overlay" style={ov}><div className="anim-modal-box" style={{ ...bx(true), position: "relative", maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>{cls}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}><HealthIcon t={fresh} size={22} style={{ flexShrink: 0 }} /><h3 style={{ margin: 0, color: T.text, fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{fresh.title}</h3></div>
        {(fresh.jobNumber || fresh.poNumber) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>{fresh.jobNumber && <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}33`, borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>Job # {fresh.jobNumber}</span>}{fresh.poNumber && <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "#10b98115", border: "1px solid #10b98133", borderRadius: 6, padding: "3px 10px", fontFamily: T.mono }}>PO # {fresh.poNumber}</span>}</div>}
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
            return <div key={panel.id} style={{ background: T.surface, borderRadius: T.radiusSm, border: `1px solid ${engAllDone ? "#10b98133" : hasEng ? "#3b82f633" : T.border}`, padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <HealthIcon t={panel} size={14} />
                <span style={{ flex: 1, fontSize: 14, color: T.text, fontWeight: 600, fontFamily: T.mono }}>{panel.title}</span>
                <span style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>{fm(panel.start)} → {fm(panel.end)}</span>
              </div>
              {/* Engineering sign-off row — only for panel jobs */}
              {hasEng && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: T.radiusXs, marginBottom: 8, background: engAllDone ? "#10b98108" : "#3b82f608", border: `1px solid ${engAllDone ? "#10b98133" : "#3b82f622"}`, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textDim, marginRight: 4 }}>ENG:</span>
                {engSteps.map(step => {
                  const done = !!pEng[step.key];
                  const isActive = step.key === pActiveStep;
                  if (done) return <span key={step.key} style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>✓ <span style={{ color: T.textDim }}>{step.label}</span></span>;
                  if (isActive && canSignOffEngineering) return <button key={step.key} onClick={() => signOffEngineering(parent.id, panel.id, step.key)} style={{ padding: "3px 10px", borderRadius: 12, background: "#3b82f6", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>;
                  if (isActive) return <span key={step.key} style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>→ {step.label}</span>;
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

  return <div className={`traqs-${themeMode}`} style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font, display: "flex", flexDirection: "column" }}>
    {/* Slim search bar */}
    {!isMobile && <div style={{ padding: "16px 32px 8px", display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, borderBottom: `1px solid ${T.border}22` }}>
      <div ref={searchRef} style={{ position: "relative", width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 20, border: `1px solid ${searchOpen ? T.accent + "66" : T.border}`, background: T.bg, transition: "all 0.2s" }}>
          <span style={{ fontSize: 12, color: T.textDim }}>🔍</span>
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
              {personResults.slice(0, 5).map(p => <div key={p.id} onClick={() => { setSearchQ(""); setSearchOpen(false); setView("team"); }} style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>{p.name[0]}</div>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: T.textDim }}>{p.role}</span>
              </div>)}
            </div>}
            {clientResults.length > 0 && <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", borderTop: personResults.length > 0 ? `1px solid ${T.border}` : "none" }}>Clients</div>
              {clientResults.slice(0, 5).map(c => <div key={c.id} onClick={() => { setSearchQ(""); setSearchOpen(false); setView("clients"); setSelClient(c.id); }} style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.text }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "10"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
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
    </div>}
    {/* Main nav bar */}
    {!isMobile && <div className="anim-header" style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, position: "relative", zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={TRAQS_LOGO_WHITE} alt="TRAQS" style={{ height: 32, objectFit: "contain", display: "block", filter: T.colorScheme === "dark" ? "none" : "brightness(0)" }} />
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${canUndo ? T.border : "transparent"}`, background: canUndo ? T.bg : "transparent", cursor: canUndo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: canUndo ? 1 : 0.3, transition: "all 0.15s", color: T.textSec }}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${canRedo ? T.border : "transparent"}`, background: canRedo ? T.bg : "transparent", cursor: canRedo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: canRedo ? 1 : 0.3, transition: "all 0.15s", color: T.textSec }}>↪</button>
        </div>
      </div>
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, background: T.bg, borderRadius: T.radiusSm, padding: 3, isolation: "isolate" }}>
        {/* Sliding pill — repositioned via refs, animates on view change */}
        <div ref={navPillRef} style={{ position: "absolute", top: 3, bottom: 3, left: 0, borderRadius: T.radiusXs, background: T.accent, boxShadow: `0 4px 18px ${T.accent}55`, zIndex: 0, pointerEvents: "none" }} />
        {views.map(v => (
          <button key={v.id} ref={el => { navBtnRefs.current[v.id] = el; }} onClick={() => setView(v.id)}
            style={{ position: "relative", zIndex: 1, padding: "8px 16px", borderRadius: T.radiusXs, border: "none", fontSize: 13, fontWeight: view === v.id ? 700 : 400, cursor: "pointer", fontFamily: T.font, background: "transparent", color: view === v.id ? T.accentText : T.text, transition: "color 0.3s ease, font-weight 0.2s ease", whiteSpace: "nowrap" }}>
            {v.icon} {v.label}
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
              <span style={{ fontSize: 15, width: 22, textAlign: "center" }}>👥</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Users</div>
                <div style={{ fontSize: 11, color: T.textDim }}>Manage permissions & access</div>
              </div>
            </button>
            <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
            <button onClick={() => { setSettingsOpen(false); setConfirmLogout(true); }} style={{ width: "100%", padding: "11px 16px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 11, fontFamily: T.font, textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => e.currentTarget.style.background = "#ef444411"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 15, width: 22, textAlign: "center" }}>🚪</span>
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
      {isMobile ? renderMobileApp() : <AnimatedView viewKey={view} style={view === "messages" ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" } : undefined}>{view === "gantt" && <div style={{ flex: 1 }}>{renderGantt()}</div>}{view === "tasks" && renderTasks()}{view === "clients" && <div style={{ flex: 1 }}>{renderClients()}</div>}{view === "team" && renderTeam()}{view === "analytics" && renderAnalytics()}{view === "messages" && renderMessages()}</AnimatedView>}
    </div>
    {renderModal()}
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
                      {person.isEngineer && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "#3b82f620", color: "#3b82f6", border: "1px solid #3b82f633" }}>Eng</span>}
                      {person.noAutoSchedule && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b33" }}>No Auto</span>}
                    </div>
                    <span style={{ color: T.textDim, fontSize: 12, marginLeft: 4 }}>{isSelected ? "▲" : "▼"}</span>
                  </div>
                  {/* Expanded permissions */}
                  {isSelected && <div style={{ margin: "2px 0 4px", padding: "14px 16px", background: T.bg, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Admin toggle */}
                    <div onClick={() => updPerson(person.id, { userRole: isAdm ? "user" : "admin", adminPerms: isAdm ? undefined : {} })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${isAdm ? T.accent + "44" : T.border}`, background: isAdm ? T.accent + "08" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ fontSize: 15 }}>🔑</span>
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
                    <div onClick={() => updPerson(person.id, { isEngineer: !person.isEngineer })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${person.isEngineer ? "#3b82f644" : T.border}`, background: person.isEngineer ? "#3b82f608" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ fontSize: 15 }}>🔧</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Engineering Sign-Off Access</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>Can sign off Design, Verify & Perforex steps</div>
                      </div>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: person.isEngineer ? "#3b82f6" : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: 2, left: person.isEngineer ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                      </div>
                    </div>
                    {/* No Auto-Schedule toggle */}
                    <div onClick={() => updPerson(person.id, { noAutoSchedule: !person.noAutoSchedule })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${person.noAutoSchedule ? "#f59e0b44" : T.border}`, background: person.noAutoSchedule ? "#f59e0b08" : T.surface, transition: "all 0.15s" }}>
                      <span style={{ fontSize: 15 }}>⛔</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Exclude from Auto-Scheduling</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>Never auto-assigned by the scheduler</div>
                      </div>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: person.noAutoSchedule ? "#f59e0b" : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: 2, left: person.noAutoSchedule ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
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
    {uploadModal && <div className="anim-modal-overlay" onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setFastTraqsExiting(false); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>

      {/* ── Phase 1: FAST TRAQS splash intro ─────────────────────────── */}
      {fastTraqsPhase === "intro" && (
        <div className={fastTraqsExiting ? "ft-intro-exit" : "ft-intro-enter"} onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 24, padding: "44px 36px 36px", width: "100%", maxWidth: 500, border: `1px solid ${T.accent}44`, boxShadow: `0 48px 120px rgba(0,0,0,0.75), 0 0 80px ${T.accent}18`, textAlign: "center", position: "relative", overflow: "hidden" }}>
          {/* Ambient glow orb */}
          <div style={{ position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)", width: 400, height: 400, background: `radial-gradient(circle, ${T.accent}18 0%, transparent 65%)`, pointerEvents: "none" }} />
          {/* Close */}
          <button onClick={() => { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); }} style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, zIndex: 2 }}>✕</button>

          {/* TRAQS Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
            <img src={TRAQS_LOGO_WHITE} alt="TRAQS" style={{ height: 40, objectFit: "contain", filter: T.colorScheme === "dark" ? "none" : "brightness(0)" }} />
          </div>

          {/* Title */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 36, fontWeight: 900, color: T.accent, letterSpacing: "-0.02em", fontFamily: T.font, textShadow: `0 0 28px ${T.accent}77` }}>FAST TRAQS</h2>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: T.text, fontFamily: T.font }}>Intelligent Document Import</p>
          <p style={{ margin: "0 0 32px", fontSize: 13, color: T.textSec, fontFamily: T.font, lineHeight: 1.7, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
            Drop in any document, spreadsheet, or paste your notes — FAST TRAQS reads it all and instantly builds your schedule, assigns your crew, and imports your clients.
          </p>

          {/* Feature grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32, textAlign: "left" }}>
            {[
              { icon: "📄", title: "Docs & Receipts",  desc: "PDFs, invoices, job orders, spreadsheets" },
              { icon: "👥", title: "Team Members",      desc: "Detects people and assigns them to roles" },
              { icon: "🏢", title: "Clients",           desc: "Identifies and imports contacts" },
              { icon: "📅", title: "Your Timeline",     desc: "Builds your full schedule automatically" },
            ].map((f, i) => (
              <div key={f.title} style={{ background: T.bg, borderRadius: 14, padding: "14px 16px", border: `1px solid ${T.border}`, animation: `ftFeaturePop 0.5s cubic-bezier(0.34,1.56,0.64,1) ${0.12 + i * 0.08}s both` }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{f.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font, marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: T.textSec, fontFamily: T.font, lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            ))}
          </div>

          {/* BEGIN button */}
          <button
            onClick={() => { setFastTraqsExiting(true); setTimeout(() => { setFastTraqsPhase("input"); setFastTraqsExiting(false); }, 420); }}
            style={{ width: "100%", padding: "17px 0", borderRadius: 16, border: "none", background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, color: T.accentText, fontSize: 18, fontWeight: 900, cursor: "pointer", fontFamily: T.font, letterSpacing: "0.06em", animation: "glow-pulse 2.4s ease-in-out infinite", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, transition: "transform 0.15s ease" }}
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
              <div style={{ fontSize: 12, color: T.textSec, fontFamily: T.font, marginTop: 1 }}>Drop in your documents or paste information below</div>
            </div>
            <button onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, flexShrink: 0 }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: "20px 24px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 8 }}>Paste information</label>
            <textarea value={uploadText} onChange={e => setUploadText(e.target.value)} placeholder={"Paste scheduling data, team lists, job details, client info...\n\nExample:\nTeam: Caleb, Draven, Sean, Jason, Howie, Tyler, Quincy, Brayden\nJob 501200 for Wheeler CAT, due Mar 15\n2 panels, Wire→Cut→Layout each 2 days\nStart Feb 24"} style={{ width: "100%", minHeight: 160, padding: "12px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, fontFamily: T.font, resize: "vertical", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }} disabled={uploadProcessing} />

            <div style={{ marginTop: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 8 }}>Or upload files</label>
              <div style={{ border: `2px dashed ${T.border}`, borderRadius: T.radiusSm, padding: "20px 16px", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }} onClick={() => document.getElementById("traqs-file-input").click()} onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }} onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }} onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv") || f.name.endsWith(".pdf") || f.name.endsWith(".txt") || f.name.endsWith(".png") || f.name.endsWith(".jpg") || f.name.endsWith(".jpeg")); setUploadFiles(prev => [...prev, ...files]); }}>
                <input id="traqs-file-input" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt,.png,.jpg,.jpeg" style={{ display: "none" }} onChange={e => { const files = Array.from(e.target.files); setUploadFiles(prev => [...prev, ...files]); e.target.value = ""; }} />
                <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>Drop files here or click to browse</div>
                <div style={{ fontSize: 11, color: T.textSec, marginTop: 4 }}>Supports Excel (.xlsx, .xls), CSV, PDF, images (.png, .jpg), and text files</div>
              </div>
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
          <div style={{ padding: "16px 24px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn variant="ghost" onClick={() => { if (!uploadProcessing) { setUploadModal(false); setFastTraqsPhase("intro"); setUploadResult(null); setUploadText(""); setUploadFiles([]); } }}>Cancel</Btn>
            <Btn onClick={processUpload} disabled={uploadProcessing || (!uploadText.trim() && uploadFiles.length === 0)} style={{ opacity: uploadProcessing || (!uploadText.trim() && uploadFiles.length === 0) ? 0.5 : 1 }}>
              {uploadProcessing ? "⏳ Processing with AI..." : "Process & Import"}
            </Btn>
          </div>
        </div>
      )}
    </div>}
    {/* ─── Clear/Delete chat confirmation ─── */}
    {confirmClearChat && <div onClick={() => setConfirmClearChat(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 400, width: "100%", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 16 }}>🗑️</div>
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
      <button onClick={() => setLightboxAtt(null)} style={{ position: "absolute", top: 18, right: 22, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%", width: 38, height: 38, color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</button>
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
                <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
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
          <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>🗑️</span>
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
          <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>🗑️</span>
          <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Clear Chat</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Delete all messages in this thread</div></div>
        </div>}
      </div>
    </div>}

    {/* Shared context menu */}
    {ctxMenu && <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: isMobile ? 16 : Math.min(ctxMenu.x, window.innerWidth - 260), ...(isMobile ? { bottom: 16, right: 16 } : ctxMenu.y + 400 > window.innerHeight ? { bottom: window.innerHeight - ctxMenu.y } : { top: ctxMenu.y }), zIndex: 9999, minWidth: isMobile ? "auto" : 260, width: isMobile ? "calc(100% - 32px)" : "auto", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: "6px 0", boxShadow: "0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)", fontFamily: T.font }}>
      <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ctxMenu.item.title}</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>{fm(ctxMenu.item.start)} → {fm(ctxMenu.item.end)}</div>
      </div>
      {can("editJobs") && <CtxMenuItem icon="✏️" label="Edit Job" onClick={() => {
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

      <CtxMenuItem icon="💬" label="Open Chat" sub={ctxMenu.item.level === 2 ? "Chat with op assignee + admins" : ctxMenu.item.level === 1 ? "Chat with panel team + admins" : "Chat with full job team"} onClick={() => openChat(ctxMenu.item)} />
      {can("editJobs") && <CtxMenuItem icon="🔔" label="Send Reminder" sub="Notify all team members on this job" onClick={() => { setReminderModal({ item: ctxMenu.item }); setCtxMenu(null); }} />}
      <CtxMenuItem icon="👁" label="View Details" onClick={() => { openDetail(ctxMenu.item); setCtxMenu(null); }} />
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
        return <CtxMenuItem icon="📋" label={logCount > 0 ? `Schedule Log (${logCount})` : "Schedule Log"} sub={logCount > 0 ? "View move history" : "No changes recorded"} onClick={() => { openDetail(ctxMenu.item); setCtxMenu(null); }} />;
      })()}
      {can("lockJobs") && (ctxMenu.item.level === 2 || (ctxMenu.item.isSub && ctxMenu.item.pid)) && <CtxMenuItem icon={ctxMenu.item.locked ? "🔓" : "🔒"} label={ctxMenu.item.locked ? "Unlock Job" : "Lock Job"} sub={ctxMenu.item.locked ? "Allow this job to be moved" : "Prevent this job from being moved"} onClick={() => { const it = ctxMenu.item; toggleLock(it.id, it.pid); setCtxMenu(null); }} />}
      <CtxMenuItem icon="📋" label="Copy" sub={`Copy this ${ctxMenu.item.level === 2 ? "operation" : ctxMenu.item.level === 1 ? "panel" : "job"} to clipboard`} onClick={() => copyItem(ctxMenu.item)} />
      <div style={{ borderTop: `1px solid ${T.border}`, margin: "4px 0" }} />
      {can("editJobs") && <div onClick={() => { const it = ctxMenu.item; setCtxMenu(null); setConfirmDelete({ id: it.id, title: it.title, pid: it.isSub ? it.pid : null }); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.danger + "15"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>🗑️</span>
        <div><div style={{ fontSize: 14, color: T.danger, fontWeight: 500 }}>Delete Task</div><div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>Permanently remove this task</div></div>
      </div>}
    </div>}
    {/* Paste confirmation popup */}
    {pasteConfirm && <div onClick={() => setPasteConfirm(null)} style={{ position: "fixed", inset: 0, zIndex: 9997 }}>
      <div className="anim-ctx" onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(pasteConfirm.x, window.innerWidth - 310), top: Math.min(pasteConfirm.y, window.innerHeight - 170), zIndex: 9998, width: 300, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm, padding: 18, boxShadow: "0 16px 48px rgba(0,0,0,0.7)", fontFamily: T.font }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>📋 Paste here?</div>
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
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>📅 {ptoCtx.bar.title}</div>
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
        <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>🗑️</span>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InputField label="Contact Person" value={ed.contact} onChange={v => setClientModal(p => ({ ...p, contact: v }))} />
            <InputField label="Phone" value={ed.phone} onChange={v => setClientModal(p => ({ ...p, phone: v }))} />
          </div>
          <InputField label="Email" value={ed.email} onChange={v => setClientModal(p => ({ ...p, email: v }))} />
          <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 13, color: T.textSec, marginBottom: 6, fontWeight: 500 }}>Notes</label><textarea value={ed.notes} onChange={e => setClientModal(p => ({ ...p, notes: e.target.value }))} rows={3} style={{ width: "100%", padding: "12px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, resize: "vertical", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}><Btn variant="ghost" onClick={() => setClientModal(null)}>Cancel</Btn><Btn onClick={() => saveClient(ed)}>Save Client</Btn></div>
        </div>
      </div>;
    })()}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
              <span style={{ fontSize: 16 }}>⭐</span>
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
              <label style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>📅 Time Off / Unavailable Dates</label>
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
        <h3 style={{ margin: "0 0 20px", color: T.text, fontSize: 20, fontWeight: 700 }}>✏️ Edit Time Off</h3>
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
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>🗑️</div>
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
          <Btn variant="danger" onClick={() => { delTask(confirmDelete.id, confirmDelete.pid); setConfirmDelete(null); }} style={{ minWidth: 120, background: T.danger, color: "#fff", border: "none" }}>Delete Forever</Btn>
        </div>
      </div>
    </div>}

    {/* Overlap Error Modal */}
    {overlapError && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 520, width: "100%", border: `1px solid ${T.danger}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${T.danger}11`, position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.danger + "15", border: `2px solid ${T.danger}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>{overlapError.message.includes("Locked") ? "🔒" : "⚠️"}</div>
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

    {/* Confirm Move Modal */}
    {confirmMove && <div className="anim-modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} >
      <div className="anim-modal-box" style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 480, width: "100%", border: `1px solid ${T.accent}33`, boxShadow: `0 24px 60px rgba(0,0,0,0.5)`, position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: T.accent + "15", border: `2px solid ${T.accent}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>📋</div>
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
        <div style={{ width: 56, height: 56, borderRadius: 28, background: "#f59e0b15", border: "2px solid #f59e0b33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>⚠️</div>
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
          <Btn onClick={saveNewGroup} disabled={!newGroupName.trim()}>Create Group</Btn>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>🔔 Send Reminder</div>
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>{item.title}{item.end ? ` · Due ${fm(item.end)}` : ""}</div>
          </div>
          <div style={{ padding: "16px 24px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Notifying {recipients.length} team member{recipients.length !== 1 ? "s" : ""}</div>
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
      <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 22, fontWeight: 700 }}>🔍 Availability Finder</h3>
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
      <h3 style={{ margin: "0 0 8px", color: T.text, fontSize: 22, fontWeight: 700 }}>📅 Manage Time Off</h3>
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
