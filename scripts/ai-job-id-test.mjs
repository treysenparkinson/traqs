// The AI's job edits match the job id the way their existence check does — #469.
//
// assign_person_to_job / remove_person_from_job decided "applied" with jobExists (sameId — loose,
// on purpose: the id comes from the MODEL, typed however the tool call emitted it) and then
// edited with `t.id === input.job_id` — strict. A number-typed job_id passed the check, matched
// nothing, and the user was told "Changes applied successfully" over an unchanged board. #436
// fixed the PERSON id on these same lines and left the job id. Both edits now use sameId.
//
// Scoped to each handler, comments stripped (R4).
//
//   node scripts/ai-job-id-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const handler = (name, next) => { const a = S.indexOf(`case "${name}":\n`); return a < 0 ? "" : S.slice(a, S.indexOf(`case "${next}"`, a + 10)); };
const add = handler("assign_person_to_job", "remove_person_from_job");
const rem = S.slice(S.indexOf('case "remove_person_from_job":\n'), S.indexOf("break;", S.indexOf('case "remove_person_from_job":\n')));
for (const [label, body] of [["assign_person_to_job", add], ["remove_person_from_job", rem]]) {
  ok(`${label} is found`, body.length > 0);
  ok(`#469 ${label} decides "applied" loosely (jobExists)`, /changed = jobExists\(input\.job_id\)/.test(body));
  ok(`#469 ${label} edits by the same loose match`, /sameId\(t\.id, input\.job_id\)/.test(body));
  ok(`#469 ${label} has no strict job-id match left`, !/t\.id === input\.job_id/.test(body));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
