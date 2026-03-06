const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');

// Find our unique marker
const marker = 'e.stopPropagation(); // prevent pan handler from also activating';
const markerPos = c.indexOf(marker);
if (markerPos < 0) { console.log('MARKER NOT FOUND'); process.exit(1); }

// Find "if (!bar.task) return;" BEFORE the marker
const startText = '                    if (!bar.task) return;';
const startPos = c.lastIndexOf(startText, markerPos);
if (startPos < 0) { console.log('START NOT FOUND'); process.exit(1); }

// Find the second "document.addEventListener("mouseup", onU);" AFTER the marker
// (first one is PTO drag, second is bar drag)
const endText = '                    document.addEventListener("mouseup", onU);';
let endPos = c.indexOf(endText, markerPos);
if (endPos < 0) { console.log('END NOT FOUND'); process.exit(1); }
endPos += endText.length;

console.log(`Replacing ${endPos - startPos} chars`);

// Build new section — live updTask in onM like the working resize handler
const nl = '\r\n';
const I = '                    ';   // 20 spaces - base
const J = '                      ';  // 22 spaces - inside onM/onU
const K = '                        '; // 24 spaces - deeper

const newSection = [
  `${I}if (!bar.task) return;`,
  `${I}e.preventDefault();`,
  `${I}e.stopPropagation();`,
  `${I}const sx = e.clientX, sy = e.clientY;`,
  `${I}const os = bar.task.start, oe = bar.task.end;`,
  `${I}const taskPid = bar.task.pid || null;`,
  `${I}const origPerson = p.id;`,
  `${I}let moved = false, lastDropPid = null, lastDx = 0;`,
  `${I}const gridEl = teamRef.current;`,
  `${I}const onM = me => {`,
  `${J}const pxDx = me.clientX - sx;`,
  `${J}const pxDy = me.clientY - sy;`,
  `${J}const dx = Math.round(pxDx / cW);`,
  `${J}if (Math.abs(pxDx) > 2 || Math.abs(pxDy) > 8) moved = true;`,
  `${J}// Live state update on column change — same approach as working resize handler`,
  `${J}if (dx !== lastDx) {`,
  `${K}lastDx = dx;`,
  `${K}updTask(bar.task.id, { start: addD(os, dx), end: addD(oe, dx) }, taskPid);`,
  `${J}}`,
  `${J}// Detect target row for reassign`,
  `${J}if (gridEl) {`,
  `${K}const personRows = gridEl.querySelectorAll("[data-rowtype='person']");`,
  `${K}let found = null;`,
  `${K}personRows.forEach(el => {`,
  `${K}  const rect = el.getBoundingClientRect();`,
  `${K}  if (me.clientY >= rect.top && me.clientY <= rect.bottom) found = el.getAttribute("data-rowid");`,
  `${K}});`,
  `${K}if (found !== lastDropPid) { lastDropPid = found; setDropTarget(found); }`,
  `${J}}`,
  `${J}// Ghost overlay at snap position`,
  `${J}const rawS = addD(os, dx);`,
  `${J}const rawE = addD(oe, dx);`,
  `${J}const snapS = nextBD(rawS);`,
  `${J}const snapDelta = diffD(rawS, snapS);`,
  `${J}const snapE = snapDelta > 0 ? addD(rawE, snapDelta) : rawE;`,
  `${J}const targetPid = lastDropPid || origPerson;`,
  `${J}const movingTaskId = bar.task?.id;`,
  `${J}let hasOverlap = false;`,
  `${J}outerTeam: for (const job of tasks) {`,
  `${K}for (const panel of (job.subs || [])) {`,
  `${K}  for (const op of (panel.subs || [])) {`,
  `${K}    if (op.id === movingTaskId || op.status === "Finished") continue;`,
  `${K}    if (!(op.team || []).includes(targetPid)) continue;`,
  `${K}    if (op.start <= snapE && op.end >= snapS) { hasOverlap = true; break outerTeam; }`,
  `${K}  }`,
  `${K}}`,
  `${J}}`,
  `${J}setTeamDragInfo({ barId: bar.id, snapStart: snapS, snapEnd: snapE, targetPersonId: targetPid, hasOverlap, cursorX: me.clientX, cursorY: me.clientY, taskTitle: bar.task?.title || "", barColor: bar.color || T.accent });`,
  `${I}};`,
  `${I}const onU = me => {`,
  `${J}document.removeEventListener("mousemove", onM);`,
  `${J}document.removeEventListener("mouseup", onU);`,
  `${J}setDropTarget(null); setTeamDragInfo(null);`,
  `${J}if (!moved) { if (bar.task) openDetail(bar.task); return; }`,
  `${J}// Final snap to business day (onM used raw dates for smooth live feedback)`,
  `${J}const finalDx = Math.round((me.clientX - sx) / cW);`,
  `${J}const rawStart = addD(os, finalDx);`,
  `${J}const rawEnd = addD(oe, finalDx);`,
  `${J}const newStart = nextBD(rawStart);`,
  `${J}const snapDelta2 = diffD(rawStart, newStart);`,
  `${J}const newEnd = snapDelta2 > 0 ? addD(rawEnd, snapDelta2) : rawEnd;`,
  `${J}updTask(bar.task.id, { start: newStart, end: newEnd }, taskPid);`,
  `${J}// Expand visible range if needed (functional update = always reads current state)`,
  `${J}setTStart(prev => newStart < prev ? newStart : prev);`,
  `${J}setTEnd(prev => newEnd > prev ? newEnd : prev);`,
  `${J}// Handle reassign to different person`,
  `${J}const isReassign = !!(lastDropPid && lastDropPid !== origPerson);`,
  `${J}if (isReassign) reassignTask(bar.task.id, origPerson, lastDropPid, taskPid);`,
  `${I}};`,
  `${I}document.addEventListener("mousemove", onM);`,
  `${I}document.addEventListener("mouseup", onU);`,
].join(nl);

c = c.substring(0, startPos) + newSection + c.substring(endPos);
fs.writeFileSync(path, c, 'utf8');
console.log('Done. Bar drag handler rewritten — live updTask in onM (same as resize handler).');
