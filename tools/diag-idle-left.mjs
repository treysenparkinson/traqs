// READ-ONLY. THE IDLE-LEFT INVARIANT, measured on production data.
//
// RULE: left of the cursor a bar shows WORKED TIME AND NOTHING ELSE. Unworked time that has
// already passed is not drawn -- an unstarted job slides to the cursor instead of sitting
// behind it in muted grey.
//
// Reports, per row, every bar with unworked extent behind the cursor and how many hours of it.
// Exit code is the violation count, so this can gate a change.
//
//   node tools/diag-idle-left.mjs          every row
//   node tools/diag-idle-left.mjs howie    one row

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [tasks, people, prod] = await Promise.all([
  get("orgs/MTX2026TRAQS/tasks.json"), get("orgs/MTX2026TRAQS/people.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const who = (process.argv[2] || "").toLowerCase();
const PHPD = 7.5, WORK_START = 8, WORK_END = 16;
const hourTs = (ds, h) => new Date(ds + "T00:00:00").getTime() + h * 3600000;
const dayMs = 86400000;
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
const parse = (ds) => new Date(ds + "T12:00:00").getTime();
// Business days forward from a date, weekends only.
const addBD = (ds, n) => {
  let t = parse(ds), left = Math.max(0, Math.round(n));
  while (left > 0) { t += dayMs; const wd = new Date(t).getDay(); if (wd !== 0 && wd !== 6) left--; }
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};


import { rowPushHours, barLengthHours, workedSpansByPersonOp, spansDurationMs, productiveHoursBetween, idleLeftOfCursorH } from "../src/statsMath.js";

const now = new Date();
const nowHour = now.getHours() + now.getMinutes() / 60;
const perPersonSpans = workedSpansByPersonOp(prod || []);

const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null)
  producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));

// Anyone on the clock, keyed by op, from any row -- the same fact the render feeds in.
const activeByOp = new Map();
for (const p of people) {
  const jc = p.activeJobClock;
  if (jc && jc.clockIn && jc.opId != null) activeByOp.set(String(jc.opId), true);
}

// Business days between two dates, weekends only -- the counterpart to addBD above.
const diffBD = (a, b) => {
  if (a === b) return 0;
  const back = b < a;
  let [from, to] = back ? [b, a] : [a, b];
  let t = parse(from), n = 0;
  while (true) {
    t += dayMs;
    const wd = new Date(t).getDay();
    if (wd !== 0 && wd !== 6) n++;
    const d = new Date(t);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (ds >= to) break;
  }
  return back ? -n : n;
};

const cfg = { workStartH: WORK_START, totalWorkH: WORK_END - WORK_START, productiveHoursPerDay: PHPD, diffBD };
const WHO=(process.argv[2]||"").toLowerCase();
const opById=new Map();
for (const job of tasks) for (const panel of job.subs||[]) for (const op of panel.subs||[]) opById.set(String(op.id),{op,panel,job});
const DAYCFG={workStartH:WORK_START,workEndH:WORK_END,productiveHoursPerDay:PHPD,workDays:[1,2,3,4,5],holidays:[]};
const NOW=Date.now();
// A moment, as productive hours relative to the cursor: negative behind it, positive ahead.
const relOfMs=(ms)=>ms<=NOW?-productiveHoursBetween(ms,NOW,DAYCFG):productiveHoursBetween(NOW,ms,DAYCFG);

let violations=0, worstRow=null, atFloor=0;
for (const person of people) {
  if (WHO && !String(person.name||"").toLowerCase().includes(WHO)) continue;
  const ops=[];
  for (const [,{op,panel}] of opById) {
    if (!(op.team||[]).some(x=>String(x)===String(person.id))) continue;
    if (!op.start||!op.end||op.status==="Finished") continue;
    if (op.end < TODAY) continue;
    const size=Math.max(1,(op.team||[]).length);
    const worked=Math.max(producedByOp.get(String(op.id))||0,Number(op.loggedHours)||0);
    ops.push({id:op.id,title:(panel.title+" / "+op.title).slice(0,30),start:op.start,end:op.end,
      startHour:op.startHour??WORK_START,hpd:Number(op.hpd)||0,teamSize:size,workedHoursShown:worked,
      isFullyWorked:false,locked:!!op.locked,isRecord:false,
      ownWorkedHours:spansDurationMs(perPersonSpans.get(String(person.id))?.get(String(op.id))||[])/3600000,
      // THIS person's own session, matching the shipped rule. Keying on anyone's clock
      // models the behaviour that produced the muted slab, not the one that ships.
      hasActiveSession: !!(person.activeJobClock && person.activeJobClock.clockIn
        && String(person.activeJobClock.opId) === String(op.id))});
  }
  if (!ops.length) continue;
  ops.sort((a,b)=>String(a.start).localeCompare(String(b.start))||(a.startHour-b.startHour));
  const {pushes}=rowPushHours({ops,nowDay:TODAY,nowHour,cfg});
  const base=ops[0];
  const frac=h=>(h-WORK_START)*PHPD/(WORK_END-WORK_START);
  const prodAt=(ds,h)=>diffBD(base.start,ds)*PHPD+frac(h)-frac(base.startHour);
  const nowProd=prodAt(TODAY,nowHour);
  const bad=[];
  for (const o of ops) {
    const rel=prodAt(o.start,o.startHour)+(pushes.get(String(o.id))||0)-nowProd;
    const len=barLengthHours({...o,
    // Capped at the hours worked, as the shipped rule does -- a pinned bar is not
    // stretched to the cursor on elapsed time alone.
    elapsedToCursorH:o.isRecord?null:Math.min(Math.max(0,-rel),o.ownWorkedHours||0)});
    const workedBehind=o.ownWorkedHours||0;
    const idle=idleLeftOfCursorH(rel,len,0,[[-workedBehind,0]]);
    const spans=(perPersonSpans.get(String(person.id))?.get(String(o.id))||[]);
    // THE ZERO-WIDTH FLOOR IS NOT A VIOLATION. barLengthHours never returns less than 0.25h,
    // because a bar with no extent cannot be clicked, dragged or seen. A pinned op with almost
    // nothing worked therefore keeps a quarter-hour sliver behind the cursor by design.
    // Counting it would leave this check permanently red and therefore useless.
    if (idle>0.26) bad.push({o,rel,len,idle,spans:spans.length});
    else if (idle>0.01) atFloor++;
  }
  if (!bad.length) continue;
  violations+=bad.length;
  const total=bad.reduce((a,b)=>a+b.idle,0);
  if (!worstRow||total>worstRow.total) worstRow={name:person.name,total};
  console.log("");
  console.log(person.name+"   "+bad.length+" bar(s) with idle behind the cursor");
  for (const b of bad) {
    console.log("    "+b.o.title.padEnd(32)+"starts "+b.rel.toFixed(1).padStart(8)+"h   len "+
      b.len.toFixed(1).padStart(7)+"h   IDLE-LEFT "+b.idle.toFixed(1).padStart(7)+"h   ("+b.spans+" worked span(s))");
  }
}
console.log("");
if (atFloor) console.log(atFloor+" bar(s) sitting at the 0.25h zero-width floor -- by design, not counted");
console.log("today "+TODAY+" "+nowHour.toFixed(2)+"   IDLE-LEFT violations: "+violations+
  (worstRow?"   worst row "+worstRow.name+" ("+worstRow.total.toFixed(1)+"h)":""));
process.exit(violations===0?0:1);