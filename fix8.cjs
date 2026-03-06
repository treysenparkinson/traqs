const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

// ── Fix 1: Replace stale tStart/tEnd closure guards with functional updaters
// The old code: if (newStart < tStart) setTStart(newStart);
//               if (newEnd > tEnd) setTEnd(newEnd);
// Both `tStart` and `tEnd` here are captured at mousedown, potentially stale.
// A functional update like setTStart(prev => ...) always reads current state.
rep(
  '                      if (newStart < tStart) setTStart(newStart);\r\n                      if (newEnd > tEnd) setTEnd(newEnd);',
  '                      // Use functional updates so we compare against CURRENT tStart/tEnd, not stale closure\r\n                      setTStart(prev => newStart < prev ? newStart : prev);\r\n                      setTEnd(prev => newEnd > prev ? newEnd : prev);',
  'Fix stale tStart/tEnd closure in range guards'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
