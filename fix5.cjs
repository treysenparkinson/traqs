const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

// ── Fix 1: Add e.stopPropagation() to bar drag mousedown
// This prevents the teamRef pan handler from also activating during a bar drag,
// which was shifting tStart/tEnd and causing bars to go out of visible range.
rep(
  '                    if (!bar.task) return;\r\n                    e.preventDefault();\r\n                    const sx = e.clientX, sy = e.clientY;',
  '                    if (!bar.task) return;\r\n                    e.preventDefault();\r\n                    e.stopPropagation(); // prevent pan handler from also activating\r\n                    const sx = e.clientX, sy = e.clientY;',
  'Fix 1: add stopPropagation to bar drag mousedown'
);

// ── Fix 2: Remove console.log debug statements (no longer needed after fix)
rep(
  '                      console.log("[TRAQS drag]", { finalDx, taskPid, barId: bar.task?.id, os, oe, newStart, newEnd, tStart, tEnd });\r\n                      // Direct state update — find panel and op by ID, update dates',
  '                      // Direct state update — find panel and op by ID, update dates',
  'Fix 2: remove debug log line 1'
);

rep(
  '                        console.log("[TRAQS drag] state updated:", updated);\r\n                        return result;',
  '                        return result;',
  'Fix 2: remove debug log line 2'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
