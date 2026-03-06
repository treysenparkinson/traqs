const fs = require('fs');
const path = 'C:/Users/treysen/traqs/src/TRAQS.jsx';
let c = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(old, neu, label) {
  if (c.includes(old)) { c = c.replace(old, neu); console.log('OK:', label); n++; }
  else { console.log('MISS:', label); }
}

const nl = '\r\n';
const I = '                    ';   // 20 spaces
const J = '                      ';  // 22 spaces

// 1. Remove lastDx from declarations (no longer needed)
rep(
  `let moved = false, lastDropPid = null, lastDx = 0;`,
  `let moved = false, lastDropPid = null;`,
  'Remove lastDx from declarations'
);

// 2. Remove the updTask-in-onM block and move dx computation later
//    (was: compute dx at top of onM, call updTask on column change)
rep(
  `${I}const pxDx = me.clientX - sx;${nl}${I}const pxDy = me.clientY - sy;${nl}${I}const dx = Math.round(pxDx / cW);${nl}${I}if (Math.abs(pxDx) > 2 || Math.abs(pxDy) > 8) moved = true;${nl}${I}// Live state update on column change — same approach as working resize handler${nl}${I}if (dx !== lastDx) {${nl}${J}lastDx = dx;${nl}${J}updTask(bar.task.id, { start: addD(os, dx), end: addD(oe, dx) }, taskPid);${nl}${I}}`,
  `${I}const pxDx = me.clientX - sx;${nl}${I}const pxDy = me.clientY - sy;${nl}${I}if (Math.abs(pxDx) > 2 || Math.abs(pxDy) > 8) moved = true;`,
  'Remove live updTask from onM, keep only pxDx/pxDy/moved'
);

// 3. Add dx computation just before the ghost overlay section
rep(
  `${I}// Ghost overlay at snap position${nl}${I}const rawS = addD(os, dx);`,
  `${I}// Ghost overlay at snap position${nl}${I}const dx = Math.round(pxDx / cW);${nl}${I}const rawS = addD(os, dx);`,
  'Add dx computation before ghost section'
);

// 4. Store pxDx in teamDragInfo so bar can use CSS transform to follow cursor
rep(
  `setTeamDragInfo({ barId: bar.id, snapStart: snapS, snapEnd: snapE, targetPersonId: targetPid, hasOverlap, cursorX: me.clientX, cursorY: me.clientY, taskTitle: bar.task?.title || "", barColor: bar.color || T.accent });`,
  `setTeamDragInfo({ barId: bar.id, snapStart: snapS, snapEnd: snapE, targetPersonId: targetPid, hasOverlap, cursorX: me.clientX, cursorY: me.clientY, taskTitle: bar.task?.title || "", barColor: bar.color || T.accent, translateX: pxDx });`,
  'Add translateX to teamDragInfo for CSS transform'
);

// 5. Apply CSS transform to the dragging bar so it follows the cursor smoothly.
//    The bar stays at its original React-state position (left: x%) and the
//    transform adds the exact pixel offset — removed on mouseup when state updates.
rep(
  `zIndex: isPto ? 3 : 4, boxShadow:`,
  `zIndex: isPto ? 3 : 4, transform: teamDragInfo?.barId === bar.id ? \`translateX(\${(teamDragInfo.translateX || 0)}px)\` : undefined, willChange: teamDragInfo?.barId === bar.id ? "transform" : undefined, pointerEvents: teamDragInfo?.barId === bar.id ? "none" : undefined, boxShadow:`,
  'Add CSS transform to bar for smooth cursor following'
);

fs.writeFileSync(path, c, 'utf8');
console.log(`\nDone. ${n} changes applied.`);
