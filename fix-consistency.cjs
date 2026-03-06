const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); n++; console.log('OK :', label); }
  else console.log('MISS:', label);
}

// ═══════════════════════════════════════════════════════════════════
// HIGH #1 — #3b82f6 → T.accent (Engineering + related UI)
// ═══════════════════════════════════════════════════════════════════

// Desktop engineering heading (color + fontWeight 800→700)
rep(
  'fontSize: 18, fontWeight: 800, color: "#3b82f6" }}>Engineering Queue',
  'fontSize: 18, fontWeight: 700, color: T.accent }}>Engineering Queue',
  'Eng heading color + fontWeight'
);

// Desktop engineering count badge
rep(
  'color: "#3b82f6", background: "#3b82f620", borderRadius: 10, padding: "2px 10px", border: "1px solid #3b82f633"',
  'color: T.accent, background: `${T.accent}20`, borderRadius: 10, padding: "2px 10px", border: `1px solid ${T.accent}33`',
  'Eng count badge color/bg/border'
);

// Desktop engineering card borders
rep(
  'border: `1px solid #3b82f630`, borderTop: `3px solid #3b82f6`, borderRadius: T.radiusSm, padding: "14px 16px", boxShadow: `0 2px 12px #3b82f610`',
  'border: `1px solid ${T.accent}30`, borderTop: `3px solid ${T.accent}`, borderRadius: T.radiusSm, padding: "14px 16px", boxShadow: `0 2px 12px ${T.accent}10`',
  'Eng card border/shadow'
);

// Desktop active step button background
rep(
  'background: canSignOffEngineering ? "#3b82f6" : "#3b82f615", border: "none"',
  'background: canSignOffEngineering ? T.accent : `${T.accent}15`, border: "none"',
  'Eng active step button bg'
);

// Desktop active step button text
rep(
  'color: canSignOffEngineering ? "#fff" : "#3b82f6", flex: 1, textAlign: "left"',
  'color: canSignOffEngineering ? T.accentText : T.accent, flex: 1, textAlign: "left"',
  'Eng active step button text'
);

// Desktop inline step indicator (Gantt row)
rep(
  'fontSize: 10, color: "#3b82f6", fontWeight: 700',
  'fontSize: 10, color: T.accent, fontWeight: 700',
  'Eng inline step indicator (Gantt)'
);

// Active count text in client/job stats area
rep(
  '{active > 0 && <span style={{ color: "#3b82f6" }}>{active} active</span>}',
  '{active > 0 && <span style={{ color: T.accent }}>{active} active</span>}',
  'Active count text'
);

// Mobile engineering header row bg/border
rep(
  'background: "#3b82f615", borderRadius: T.radiusSm, border: "1px solid #3b82f630", cursor: "pointer"',
  'background: `${T.accent}15`, borderRadius: T.radiusSm, border: `1px solid ${T.accent}30`, cursor: "pointer"',
  'Mobile eng header bg/border'
);

// Mobile engineering title text
rep(
  'fontSize: 14, fontWeight: 700, color: "#3b82f6", flex: 1 }}>Engineering Queue',
  'fontSize: 14, fontWeight: 700, color: T.accent, flex: 1 }}>Engineering Queue',
  'Mobile eng title color'
);

// Mobile engineering count badge
rep(
  'fontSize: 12, color: "#3b82f6", fontWeight: 700, background: "#3b82f620", borderRadius: 10, padding: "1px 8px"',
  'fontSize: 12, color: T.accent, fontWeight: 700, background: `${T.accent}20`, borderRadius: 10, padding: "1px 8px"',
  'Mobile eng count badge'
);

// Mobile engineering card left border
rep(
  'borderLeft: "3px solid #3b82f6"',
  'borderLeft: `3px solid ${T.accent}`',
  'Mobile eng card left border'
);

// Mobile engineering sign-off button bg/color
rep(
  'borderRadius: 14, background: "#3b82f6", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>',
  'borderRadius: 14, background: T.accent, color: T.accentText, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>',
  'Mobile eng sign-off button'
);

// Mobile engineering active step text
rep(
  'fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>→ {step.label}</span>',
  'fontSize: 11, color: T.accent, fontWeight: 600 }}>→ {step.label}</span>',
  'Mobile eng active step text'
);

// AI schedule "Check for Availability" button color
rep(
  'background: (ed.subs || []).length === 0 ? T.textDim + "33" : "#3b82f6", color: "#fff"',
  'background: (ed.subs || []).length === 0 ? T.textDim + "33" : T.accent, color: T.accentText',
  'AI schedule button bg/text'
);
rep(
  'boxShadow: (ed.subs || []).length > 0 ? "0 4px 14px rgba(59,130,246,0.35)" : "none"',
  'boxShadow: (ed.subs || []).length > 0 ? `0 4px 14px ${T.accent}59` : "none"',
  'AI schedule button shadow'
);

// Engineering panel border in detail modal
rep(
  'border: `1px solid ${engAllDone ? "#10b98133" : hasEng ? "#3b82f633" : T.border}`',
  'border: `1px solid ${engAllDone ? "#10b98133" : hasEng ? T.accent + "33" : T.border}`',
  'Eng panel border in detail'
);

// Engineering panel active step bg/border in detail
rep(
  'background: engAllDone ? "#10b98108" : "#3b82f608", border: `1px solid ${engAllDone ? "#10b98133" : "#3b82f622"}`',
  'background: engAllDone ? "#10b98108" : T.accent + "08", border: `1px solid ${engAllDone ? "#10b98133" : T.accent + "22"}`',
  'Eng panel active step bg/border in detail'
);

// Engineering sign-off button in detail modal
rep(
  'borderRadius: 12, background: "#3b82f6", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>',
  'borderRadius: 12, background: T.accent, color: T.accentText, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>→ {step.label}</button>',
  'Eng sign-off button in detail modal'
);

// Engineering active step span in detail modal
rep(
  'fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>→ {step.label}</span>',
  'fontSize: 11, color: T.accent, fontWeight: 600 }}>→ {step.label}</span>',
  'Eng active step span in detail modal'
);

// Engineer badge in people list
rep(
  'background: "#3b82f620", color: "#3b82f6", border: "1px solid #3b82f633"',
  'background: T.accent + "20", color: T.accent, border: `1px solid ${T.accent}33`',
  'Engineer badge in people list'
);

// Engineer toggle border/bg
rep(
  'border: `1px solid ${person.isEngineer ? "#3b82f644" : T.border}`, background: person.isEngineer ? "#3b82f608" : T.surface',
  'border: `1px solid ${person.isEngineer ? T.accent + "44" : T.border}`, background: person.isEngineer ? T.accent + "08" : T.surface',
  'Engineer toggle border/bg'
);

// Engineer toggle thumb color
rep(
  'background: person.isEngineer ? "#3b82f6" : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0',
  'background: person.isEngineer ? T.accent : T.border, position: "relative", transition: "background 0.2s", flexShrink: 0',
  'Engineer toggle thumb'
);

// ═══════════════════════════════════════════════════════════════════
// HIGH #3 — Border radius: hardcoded 6 → T.radiusXs where inconsistent
// ═══════════════════════════════════════════════════════════════════

// Filter hpd quick-select buttons (borderRadius: 6 → T.radiusXs)
// Gantt view filter panel
rep(
  'padding: "3px 8px", borderRadius: 6, border: `1px solid ${fHpd === String(h) ? T.accent : T.border}`, background: fHpd === String(h) ? T.accent + "22"',
  'padding: "3px 8px", borderRadius: T.radiusXs, border: `1px solid ${fHpd === String(h) ? T.accent : T.border}`, background: fHpd === String(h) ? T.accent + "22"',
  'Gantt filter hpd button radius'
);
// Team view filter panel (duplicate of above pattern)
rep(
  'padding: "3px 8px", borderRadius: 6, border: `1px solid ${fHpd === String(h) ? T.accent : T.border}`, background: fHpd === String(h) ? T.accent + "22"',
  'padding: "3px 8px", borderRadius: T.radiusXs, border: `1px solid ${fHpd === String(h) ? T.accent : T.border}`, background: fHpd === String(h) ? T.accent + "22"',
  'Team filter hpd button radius'
);

// Engineering revert buttons (borderRadius: 6 → T.radiusXs)
rep(
  'borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>',
  'borderRadius: T.radiusXs, background: "transparent", border: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, cursor: "pointer", fontFamily: T.font }}>↩</button>',
  'Eng revert button radius'
);

// ═══════════════════════════════════════════════════════════════════
// MEDIUM #7 — Close button positioning: standardize to top:20, right:24
// ═══════════════════════════════════════════════════════════════════

// Upload modal close button (top:16, right:16 → top:20, right:24)
rep(
  'position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, zIndex: 2',
  'position: "absolute", top: 20, right: 24, width: 32, height: 32, borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.text, fontFamily: T.font, zIndex: 2',
  'Upload modal close button position'
);

// Lightbox close button (top:18, right:22 → top:20, right:24)
rep(
  'position: "absolute", top: 18, right: 22, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%"',
  'position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%"',
  'Lightbox close button position'
);

// ═══════════════════════════════════════════════════════════════════
// MEDIUM #9 — Z-index: filter panels from 1000 → 999 (avoid modal conflict)
// ═══════════════════════════════════════════════════════════════════

// Both filter panels (Gantt + Team view) are identical strings
// Replace both occurrences
c = c.replaceAll(
  'top: "calc(100% + 6px)", zIndex: 1000, width: 268, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm',
  'top: "calc(100% + 6px)", zIndex: 999, width: 268, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: T.radiusSm'
);
n++; console.log('OK : Filter panel z-index 1000 → 999 (both instances)');

// ═══════════════════════════════════════════════════════════════════
// LOW #11 — #10b981 (success green) consistency: already consistent,
//           but standardize two remaining places to use the same variable
// LOW #12 — already handled above (filter hpd buttons)
// LOW #13 — Section label 11px in filter panel → 12px to match calendar headers
// ═══════════════════════════════════════════════════════════════════

// Filter panel section labels: "Role / Area" and "Hours / Day" (both panels)
c = c.replaceAll(
  'fontSize: 11, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8',
  'fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8'
);
n++; console.log('OK : Filter panel section label fontSize 11→12 (all instances)');

// ═══════════════════════════════════════════════════════════════════
// Write
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone — ${n} change groups applied.`);
