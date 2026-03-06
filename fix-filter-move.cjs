const fs = require('fs');
let c = fs.readFileSync('C:/Users/treysen/traqs/src/TRAQS.jsx', 'utf8');
const NL = '\r\n';

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Find the JSX div block starting at `start` (position of the opening '<'),
// and return the position just after its closing tag.
function findDivEnd(src, start) {
  let depth = 0, i = start;
  while (i < src.length) {
    if (src[i] === '<') {
      if (src[i+1] === '/') { depth--; if (depth === 0) { while (src[i] !== '>') i++; return i + 1; } }
      else if (src[i+1] !== '!' && src[i+1] !== '?') depth++;
    }
    i++;
  }
  return -1;
}

// ─── Locate Gantt filter block ───────────────────────────────────────────────
const G_CMT = '{/* Filter button + panel */}';
const gCmtIdx = c.indexOf(G_CMT);
if (gCmtIdx < 0) { console.log('MISS: Gantt filter comment'); process.exit(1); }
// The div starts right after the comment + CRLF
const gDivIdx = c.indexOf('<div', gCmtIdx);
const gDivEnd  = findDivEnd(c, gDivIdx);
const gFullBlock = c.substring(gCmtIdx - 10, gDivEnd); // include leading spaces

// ─── Locate Team filter block ────────────────────────────────────────────────
const T_CMT = '{/* Filter button + panel (Team view) */}';
const tCmtIdx = c.indexOf(T_CMT);
if (tCmtIdx < 0) { console.log('MISS: Team filter comment'); process.exit(1); }
const tDivIdx = c.indexOf('<div', tCmtIdx);
const tDivEnd  = findDivEnd(c, tDivIdx);

console.log('Gantt block found:', gDivEnd - gDivIdx, 'chars');
console.log('Team  block found:', tDivEnd - tDivIdx, 'chars');

// ─── Extract the panel content from the Gantt block ──────────────────────────
const ganttDiv = c.substring(gDivIdx, gDivEnd);
// Panel starts at {filterOpen
const panelStart = ganttDiv.indexOf('{filterOpen');
if (panelStart < 0) { console.log('MISS: panel content'); process.exit(1); }
const rawPanel = ganttDiv.substring(panelStart, ganttDiv.lastIndexOf('\n')).trimEnd();

// Fix dropdown anchor: right: 0 → left: 0
const panelLeft = rawPanel.replace('"absolute", right: 0,', '"absolute", left: 0,');

// ─── Build icon-only filter button ───────────────────────────────────────────
function makeBtn(indent, withRef) {
  const i1 = indent;                    // outer div indent
  const i2 = indent + '  ';            // button indent
  const i3 = indent + '    ';          // svg/badge indent
  const ref = withRef ? ' ref={filterRef}' : '';
  const lines = [
    `${i1}<div${ref} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>`,
    `${i2}<button onClick={() => setFilterOpen(p => !p)} title="Filters" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 9px", borderRadius: T.radiusSm, border: \`1px solid \${activeFilterCount > 0 ? T.accent + "88" : T.border}\`, background: activeFilterCount > 0 ? T.accent + "15" : "transparent", color: activeFilterCount > 0 ? T.accent : T.textSec, cursor: "pointer", transition: "all 0.15s", position: "relative" }}>`,
    `${i3}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    `${i3}{activeFilterCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: T.accent, color: T.accentText, borderRadius: 8, minWidth: 16, height: 16, fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center", padding: "0 4px" }}>{activeFilterCount}</span>}`,
    `${i2}</button>`,
    `${i2}${panelLeft}`,
    `${i1}</div>`,
  ];
  return lines.join(NL);
}

const ganttBtn = makeBtn('          ', true);   // 10-space indent, keeps filterRef
const teamBtn  = makeBtn('        ',  false);   // 8-space indent, no ref

// ─── GANTT: remove old block, insert icon btn in left side ───────────────────
// Remove old block from right side (from the leading spaces + comment to end of div)
const gRemoveStart = gCmtIdx - 10;  // include "          " before comment
const gRemoveEnd   = gDivEnd;
c = c.substring(0, gRemoveStart) + c.substring(gRemoveEnd);

// Insert after nav arrows </div> (now search again since offsets shifted)
// Anchor: "          </div>\r\n        </div>\r\n        {/* Center:"
const ganttAnchor = `          </div>${NL}        </div>${NL}        {/* Center:`;
const ganttReplacement = `          </div>${NL}${ganttBtn}${NL}        </div>${NL}        {/* Center:`;
if (c.includes(ganttAnchor)) {
  c = c.replace(ganttAnchor, ganttReplacement);
  console.log('OK: Gantt filter moved to left side');
} else {
  console.log('MISS: Gantt insert anchor — searching alternatives...');
  // Try without the Center comment
  const alt = `          </div>${NL}        </div>`;
  const altIdx = c.indexOf(alt, c.indexOf('SlidingPill'));
  if (altIdx >= 0) {
    c = c.substring(0, altIdx + `          </div>${NL}`.length) + ganttBtn + NL + c.substring(altIdx + `          </div>${NL}`.length);
    console.log('OK: Gantt filter inserted via alt anchor');
  }
}

// ─── TEAM: remove old block, insert icon btn after Time Off ──────────────────
// Re-find team block (offsets shifted after gantt edit)
const tCmtIdx2 = c.indexOf(T_CMT);
if (tCmtIdx2 < 0) { console.log('MISS: Team filter comment (pass 2)'); process.exit(1); }
const tDivIdx2 = c.indexOf('<div', tCmtIdx2);
const tDivEnd2 = findDivEnd(c, tDivIdx2);
const tRemoveStart = tCmtIdx2 - 10;
c = c.substring(0, tRemoveStart) + c.substring(tDivEnd2);

// Insert after Time Off button, before the closing </div>} of admin controls
const teamAnchor = `>📅 Time Off</Btn>${NL}        </div>}`;
const teamReplacement = `>📅 Time Off</Btn>${NL}${teamBtn}${NL}        </div>}`;
if (c.includes(teamAnchor)) {
  c = c.replace(teamAnchor, teamReplacement);
  console.log('OK: Team filter moved next to Time Off');
} else {
  console.log('MISS: Team insert anchor');
}

fs.writeFileSync('C:/Users/treysen/traqs/src/TRAQS.jsx', c, 'utf8');
console.log('\nDone.');
