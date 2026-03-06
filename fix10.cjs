const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

// ── Fix: getAttribute("data-rowid") returns a STRING, but p.id is a NUMBER.
// That makes `"99" !== 99` always true, so isReassign is ALWAYS true —
// even on a same-row drag — causing reassignTask to corrupt op.team from
// [99] (number) to ["99"] (string), which then fails getPersonBars includes().
// Fix: after capturing the found row ID from the DOM attribute, look up the
// actual person object so lastDropPid uses the real ID type (number).
rep(
  `                        if (found !== lastDropPid) { lastDropPid = found; setDropTarget(found); }`,
  `                        if (found !== null) { const pObj = people.find(x => String(x.id) === found); if (pObj) found = pObj.id; }
                        if (found !== lastDropPid) { lastDropPid = found; setDropTarget(found); }`,
  'Fix string/number type mismatch in lastDropPid from getAttribute'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
