const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

// Replace updTask call with inline setTasks that logs every step
rep(
  '                      console.log(\'[DRAG DROP]\', { finalDx, taskPid, opId: bar.task?.id, os, oe, newStart, newEnd, tStart, tEnd });\r\n                      // Use updTask — same path as resize handler (known-working)\r\n                      updTask(bar.task.id, { start: newStart, end: newEnd }, taskPid);',
  '                      console.log(\'[DRAG DROP]\', { finalDx, taskPid, opId: bar.task?.id, os, oe, newStart, newEnd, tStart, tEnd });\r\n                      // Inline setTasks with full diagnostic logging\r\n                      setTasks(prev => {\r\n                        let panelFound = false, opFound = false;\r\n                        const result = prev.map(t => {\r\n                          const pi = (t.subs || []).findIndex(s => s.id === taskPid);\r\n                          if (pi < 0) return t;\r\n                          panelFound = true;\r\n                          const panel = t.subs[pi];\r\n                          const oi = (panel.subs || []).findIndex(op => op.id === bar.task.id);\r\n                          if (oi < 0) { console.log(\'[DRAG] panel found but op NOT found\', { taskPid, opId: bar.task.id, panelSubs: (panel.subs||[]).map(o=>o.id) }); return t; }\r\n                          opFound = true;\r\n                          const newOps = panel.subs.map((op, idx) => idx === oi ? { ...op, start: newStart, end: newEnd } : op);\r\n                          const ns2 = [...t.subs]; ns2[pi] = { ...panel, subs: newOps };\r\n                          return { ...t, subs: ns2 };\r\n                        });\r\n                        console.log(\'[DRAG RESULT]\', { panelFound, opFound, tasksChanged: result !== prev });\r\n                        return result;\r\n                      });',
  'Replace updTask with inline setTasks + deep logging'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
