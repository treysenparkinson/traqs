const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

// ── Replace the custom setTasks block in onU with updTask + debug logs
rep(
  '                      // Direct state update — find panel and op by ID, update dates\r\n                      setTasks(prev => {\r\n                        let updated = false;\r\n                        const result = prev.map(job => {\r\n                          if (!taskPid) return job;\r\n                          const pi = (job.subs || []).findIndex(pnl => pnl.id === taskPid);\r\n                          if (pi < 0) return job;\r\n                          const panel = job.subs[pi];\r\n                          const oi = (panel.subs || []).findIndex(op => op.id === bar.task.id);\r\n                          if (oi < 0) return job;\r\n                          updated = true;\r\n                          const newOps = panel.subs.map((op, idx) => idx === oi ? { ...op, start: newStart, end: newEnd } : op);\r\n                          const earliest = newOps.reduce((a,b)=>a.start<b.start?a:b).start;\r\n                          const latest = newOps.reduce((a,b)=>a.end>b.end?a:b).end;\r\n                          const ns2 = [...job.subs]; ns2[pi] = { ...panel, subs: newOps, start: earliest, end: latest };\r\n                          return { ...job, subs: ns2 };\r\n                        });\r\n                        return result;\r\n                      });',
  '                      console.log(\'[DRAG DROP]\', { finalDx, taskPid, opId: bar.task?.id, os, oe, newStart, newEnd, tStart, tEnd });\r\n                      // Use updTask — same path as resize handler (known-working)\r\n                      updTask(bar.task.id, { start: newStart, end: newEnd }, taskPid);',
  'Replace custom setTasks with updTask + debug log'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
