// Web permission gates ask for the key the server enforces — root cause 4.
//
//   node scripts/web-gates-test.mjs
//
// STRUCTURAL, not behavioural: these gates are UI conditions and function guards
// inside one 36k-line React component with no DOM harness, so this reads the
// source. Each check names a gate from PERMISSIONS_AUDIT.md and the exact guard it
// must now carry (and, where one existed, the wrong guard it must no longer have).
// It proves the key each gate asks for, not that the UI behaves; a behavioural
// change to a gate belongs in a test that executes it (see save-rollback-test).
import { readFileSync } from "node:fs";
// WEB_GATES_SRC points the check at another copy (e.g. the committed file) to show it fails there.
//
// NEWLINES NORMALISED, and it is not cosmetic. git checks this repo out with
// core.autocrlf=true, so the working copy is CRLF while the index and every literal in
// this file are LF. Any multi-line pattern below therefore could not match on Windows:
// three `has:` checks failed for that reason alone and, far worse, four `not:` checks
// passed VACUOUSLY — a `not:` that can never match reports a gate as correct without
// looking at it. Four permission gates read green here for a week while checking nothing.
// The source is left alone; what is compared is normalised.
const SRC = readFileSync(process.env.WEB_GATES_SRC || new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// A canary for the above. If the normalisation is ever removed, every multi-line pattern in
// this file silently stops matching -- and the `not:` ones stop being able to fail at all,
// which is the failure mode that hides a missing gate. This one asserts a multi-line pattern
// that IS in the source, so losing the normalisation fails loudly instead of quietly.
if (!SRC.includes('const handleTeamResize = (e, side) => {\n')) {
  console.error("FAIL  multi-line patterns cannot match the source — newline normalisation is broken");
  process.exit(2);
}

// The body of the arrow function declared at `anchor` (brace-matched).
function body(anchor) {
  const at = SRC.indexOf(anchor);
  if (at < 0) { console.error("anchor not found in TRAQS.jsx:", anchor); process.exit(2); }
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  return SRC.slice(at, i + 1);
}

let pass = 0, fail = 0;
const check = (label, text, { has = [], not = [] }) => {
  const missing = has.filter(s => !text.includes(s));
  const present = not.filter(s => text.includes(s));
  const good = !missing.length && !present.length;
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}`);
  for (const s of missing) console.log(`         missing: ${s}`);
  for (const s of present) console.log(`         still has: ${s}`);
  good ? pass++ : fail++;
};

console.log("\n1. Task writes — guards inside the function that writes");
// The Gantt's own day-bar drag gate retired with renderGantt (root cause 9, #132). The DAY
// VIEW's drag is a different handler, handleTeamDayBarDrag, gated separately — see
// "Day-view drag toasts when refused" below, which still runs.
check("Drop in Schedule needs moveJobs and reassign", body("const placeTaskAt = (personId, dayStr)"), { has: ['"moveJobs"', '"reassign"', 'can('] });
check("Pending tray drop needs editJobs, moveJobs and reassign", body("const handlePendingItemDrop = (itemId"), { has: ['"editJobs"', '"moveJobs"', '"reassign"', 'can('] });
check("Reassigning (any bar drag onto another row) needs reassign", body("const reassignTask = (taskId"), { has: ['if (!can("reassign")) return'] });
check("Inline cell edits ask for the key of the field", body("const commitCellEdit = (id, key, val, pid)"), { has: ['if (!can(need)) return', '"moveJobs"', '"reassign"'] });
check("Edit Job save asks the shared classifier what the edit needs", body("const saveTask = (ed, parentId)"), { has: ["classifyTaskActions("] });
check("Engineering sign-off needs admin or engineer (as the server)", body("const signOffEngineering = (jobId"), { has: ["if (!canEngineer) return"], not: ["if (!canApprove) return;"] });
check("Engineering revert needs admin or engineer", body("const revertEngineering = (jobId"), { has: ["if (!canEngineer) return"], not: ["if (!canApprove) return;"] });
check("Hours → Admin Approve needs approveCompletions", body("const approveFinish = (job, panel, op)"), { has: ['if (!can("approveCompletions")) return'] });
check("Hours → Admin Decline needs approveCompletions", body("const rejectFinish = (job, panel, op)"), { has: ['if (!can("approveCompletions")) return'] });
check("Undo approval needs approveCompletions (as its button)", body("const adminUndoJobFinish = async (jobId"), { has: ['!can("approveCompletions")'], not: ["if (!isAdmin || !loggedInUser) return;"] });

console.log("\n2. Task writes — UI gates");
check("Engineering buttons show for admin or engineer", SRC, { not: ["isActive && canApprove) return <button key={step.key} onClick={() => signOffEngineering("] });
check("Status → Finished needs approveCompletions", SRC, { has: ['if (s === "Finished" && !can("approveCompletions")) return'], not: ['if (s === "Finished" && !isAdmin) return;'] });
check("Schedule bulk Select needs editJobs", SRC, { has: ['{can("editJobs") && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>\n          <Btn size="sm" variant={barSelectMode'],
  not: ['{isAdmin && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>\n          <Btn size="sm" variant={barSelectMode'] });
check("Jobs bulk Select needs editJobs (list and cards)", SRC, { has: ['{can("editJobs") && <Btn size="sm" variant={jobSelectMode ? "primary" : "secondary"} style={{ minWidth: 78 }}', '{can("editJobs") && <Btn size="sm" variant={jobSelectMode ? "primary" : "secondary"} onClick'] });
check("Dependencies toggle and editor need editJobs", SRC, { has: ["{showDepToggle && can(\"editJobs\") && <button", '{isOp && can("editJobs") && (() => {'] });

check("Panel approval-step menu (edit / remove the chain) needs editJobs", SRC, { has: ['const openApprCtx = (ev) => {\n                // Editing or removing a panel\'s steps changes the chain itself: editJobs.\n                if (!can("editJobs")) return'] });
check("Project Plan Assign needs reassign", SRC.slice(SRC.indexOf("Same assign control the Gantt rows use"), SRC.indexOf("Same assign control the Gantt rows use") + 1500), { has: ['<button disabled={!can("reassign")}'], not: ['<button disabled={!can("editJobs")}'] });

console.log("\n3. People, clients, settings");
check("+ Add Member needs manageTeam", SRC, { has: ["{canManageTeam && <Btn style={{ marginTop: 8 }} onClick={() => setPersonModal({ id: null"], not: ["{isAdmin && <Btn style={{ marginTop: 8 }} onClick={() => setPersonModal({ id: null"] });
check("Mobile Add Member / person edit need manageTeam", SRC, { not: ['{can("editJobs") && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>\n        <button onClick={() => setPersonModal(', '{can("editJobs") && <div style={{ marginTop: 10 }}>\n              <button onClick={() => setPersonModal({ ...p })}'] });
check("Employees card menu (Edit / Delete) needs manageTeam", SRC, { has: ["if (canManageTeam) setEmpCtx({ x: e.clientX, y: e.clientY, person: p });"] });
check("PTO bar drag/resize needs manageTeam", SRC, { has: ['if (!can(isPto ? "manageTeam" : "moveJobs")) {', 'const handleTeamResize = (e, side) => {\n                    if (!can(isPto ? "manageTeam" : "moveJobs")) return'] });
check("User Permissions needs manageTeam", SRC, { has: ["{canManageTeam && <button onClick={() => { setSettingsOpen(false); setUsersOpen(true);"] });
check("Mobile client add/edit need manageClients", SRC, { not: ['{can("editJobs") && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>\n        <button onClick={() => openClientEdit(', '{can("editJobs") && <button onClick={() => openClientEdit({ ...c })}'] });
check("Mobile Scheduling / Sign Off / Departments settings need orgSettings", SRC, { has: ['{can("orgSettings") && <button onClick={() => { setSettingsOpen(false); setPrefOpen(false); setOrgSettingsOpen(true); }}',
  '{can("orgSettings") && <button onClick={() => { setSettingsOpen(false); setPrefOpen(false); setSignOffSettingsOpen(true); }}', '{can("orgSettings") && <button onClick={() => { setSettingsOpen(false); setRolesSettingsOpen(true); }}'] });
check("Mobile org-code panel hidden like the desktop's", SRC, { has: ["{ORG_CODE_RENAME_ENABLED && isAdmin && <button onClick={() => { setOrgCodeInput("] });
check("FAST TRAQS import filters by manageTeam / manageClients", SRC, { has: ["if (keptNewPeople.length && canManageTeam) setPeople(", 'if (keptNewClients.length && can("manageClients")) setClients('] });
check("Time-off Approve/Deny buttons need approveTimeOff", SRC, { has: ['{can("approveTimeOff") && toPending && (denying'], not: ["{isAdmin && toPending && (denying"] });
check("Time-off bell needs approveTimeOff", body("const timeOffNotifs = useMemo(() =>"), { has: ['!can("approveTimeOff")'], not: ["!isAdmin) return [];"] });
check("unclosedAt stamps others' sessions as the server allows (admin)", SRC, { has: ["if (!sameId(person.id, loggedInUser?.id) && !isAdmin) continue;"] });
check("No-approvers fallback uses approveCompletions (as the audience)", SRC, { not: ['const adminParticipants = people.filter(p => p.userRole === "admin");'] });

console.log("\n4. Chat groups — creator or admin");
check("Group menu Edit / Delete need creator or admin", SRC, { has: ["{canManageGroup(groups.find(g => g.id === groupCtxMenu.groupId)) && <>"] });
check("Clear Chat on a group needs creator or admin", SRC, { has: ["canManageGroup(groupOfThread(threadCtxMenu.threadKey))"] });

console.log("\n5. A refused action says so — a toast, never a silent no-op or a hidden control");
check("denied() helper toasts \"You don't have permission to <action>.\"", SRC, { has: ["const denied = (action) => toast(`You don't have permission to ${action}.`);"] });
check("Approve (Hours → Admin) toasts when refused", body("const approveFinish = (job, panel, op)"), { has: ['if (!can("approveCompletions")) return denied("approve completions");'] });
check("Decline (Hours → Admin) toasts when refused", body("const rejectFinish = (job, panel, op)"), { has: ['if (!can("approveCompletions")) return denied("decline completions");'] });
check("Jobs List inline cell edit toasts when refused", body("const commitCellEdit = (id, key, val, pid)"), { has: ["if (!can(need)) return denied(PERM_VERB[need]);"] });
check("Drop in Schedule toasts when refused", body("const placeTaskAt = (personId, dayStr)"), { has: ["return denied(PERM_VERB[", 'const lacking = ["moveJobs", "reassign"].find(k => !can(k));'] });
check("Pending-tray drop toasts when refused", body("const handlePendingItemDrop = (itemId"), { has: ["return denied(PERM_VERB[", 'const lacking = ["editJobs", "moveJobs", "reassign"].find(k => !can(k));'] });
// (the Gantt day-bar refusal toast retired with renderGantt — root cause 9, #132.)
check("Reassign toasts when refused", body("const reassignTask = (taskId"), { has: ['if (!can("reassign")) return denied(PERM_VERB.reassign);'] });
check("Engineering sign-off / revert toast when refused", body("const signOffEngineering = (jobId") + body("const revertEngineering = (jobId"), { has: ['if (!canEngineer) return denied("sign off engineering steps");'] });
check("Chat Approve toasts when refused", body("const adminApproveJobFinish = async (jobId"), { has: ['denied("approve completions")'] });
check("Chat Decline toasts when refused", body("const adminDeclineJobFinish = async (jobId"), { has: ['denied("decline completions")'] });
check("Undo approval toasts when refused", body("const adminUndoJobFinish = async (jobId"), { has: ['denied("undo an approval")'] });
check("Status → Finished toasts when refused", SRC, { has: ['if (s === "Finished" && !can("approveCompletions")) return denied("mark work Finished");'] });
check("Approval-step menu toasts when refused", SRC, { has: ['if (!can("editJobs")) return denied("edit approval steps");'] });
check("PTO drag / resize toast when refused", SRC, { has: ['if (isPto) denied(PERM_VERB.manageTeam);', 'if (!can(isPto ? "manageTeam" : "moveJobs")) return denied(isPto ? PERM_VERB.manageTeam : PERM_VERB.moveJobs);'] });
check("Edit Job save toasts (not alert) when refused", body("const saveTask = (ed, parentId)"), { has: ["return denied(missing.map(k => PERM_VERB[k] || k).join(\" or \"));"], not: ["alert(`You don't have permission to save this change"] });

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no checks ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
