// READ-ONLY. WHERE EVERY BAR ON ONE ROW ACTUALLY LANDS.
//
// Builds the row the way the schedule builds it -- the person's own ops PLUS the cross-row
// records for work they did on other people's ops, open clock included -- then runs the
// shipped rowPushHours over it and prints each bar's push and its position relative to the
// cursor. Leaving the records out of a reconstruction hides the collisions they cause, which
// is how a live clock-in ended up drawn three days into the future with no visible reason.
//
//   node tools/diag-row-place.mjs treysen

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


import { rowPushHours, barLengthHours, workedSpansByPersonOp, spansDurationMs, productiveHoursBetween } from "../src/statsMath.js";

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
const person=people.find(p=>String(p.name||"").toLowerCase().includes(WHO));
if (!person) { console.error("no person matching " + JSON.stringify(WHO)); process.exit(2); }
const opById=new Map();
for (const job of tasks) for (const panel of job.subs||[]) for (const op of panel.subs||[]) opById.set(String(op.id),{op,panel,job});

const ops=[];
for (const [,{op,panel}] of opById) {
  if (!(op.team||[]).some(x=>String(x)===String(person.id))) continue;
  if (!op.start||!op.end||op.status==="Finished") continue;
  if (op.end < TODAY) continue;   // history does not render
  const size=Math.max(1,(op.team||[]).length);
  const worked=Math.max(producedByOp.get(String(op.id))||0,Number(op.loggedHours)||0);
  ops.push({id:op.id,title:(panel.title+" / "+op.title).slice(0,26),start:op.start,end:op.end,
    startHour:op.startHour??WORK_START,hpd:Number(op.hpd)||0,teamSize:size,workedHoursShown:worked,
    isFullyWorked:false,locked:!!op.locked,isRecord:false,
    ownWorkedHours:spansDurationMs(perPersonSpans.get(String(person.id))?.get(String(op.id))||[])/3600000,
    // THIS person's own session, matching the shipped rule -- a colleague's clock puts no
    // worked time on this row, so it must not exempt this row's bar from the cursor push.
    hasActiveSession:!!(person.activeJobClock&&person.activeJobClock.clockIn
      &&String(person.activeJobClock.opId)===String(op.id))});
}

const spansByOp=new Map();
for (const [opId,sp] of (perPersonSpans.get(String(person.id))||new Map())) spansByOp.set(String(opId),sp.slice());
const jc=person.activeJobClock;
if (jc&&jc.clockIn) {
  const k=String(jc.opId);
  spansByOp.set(k,[...(spansByOp.get(k)||[]),[Date.parse(jc.clockIn),Date.now()]]);
}
const dstr=t=>{const d=new Date(t);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
for (const [opId,raw] of spansByOp) {
  const f=opById.get(opId); if(!f) continue;
  if ((f.op.team||[]).some(x=>String(x)===String(person.id))) continue;  // on team -> its own bar
  if (f.op.status==="Finished") continue;
  const sp=raw.slice().sort((p,q)=>p[0]-q[0]);
  const xS=sp[0][0], xE=sp[sp.length-1][1];
  const sd=new Date(xS);
  ops.push({id:"xrow-"+opId,title:"REC  "+(f.panel.title+" / "+f.op.title).slice(0,20),
    start:dstr(xS),end:dstr(xE),startHour:sd.getHours()+sd.getMinutes()/60,
    hpd:Math.max(0.25,productiveHoursBetween(xS,Math.min(xE,Date.now()),
      {workStartH:WORK_START,workEndH:WORK_END,productiveHoursPerDay:PHPD,workDays:[1,2,3,4,5],holidays:[]})),teamSize:1,
    workedHoursShown:0,isFullyWorked:false,locked:false,ownWorkedHours:0,isRecord:true,
    hasActiveSession:!!(jc&&String(jc.opId)===opId)});
}

ops.sort((a,b)=>String(a.start).localeCompare(String(b.start))||(a.startHour-b.startHour));
const {pushes,atCursor}=rowPushHours({ops,nowDay:TODAY,nowHour,cfg});
const base=ops[0];
const frac=h=>(h-WORK_START)*PHPD/(WORK_END-WORK_START);
const prodAt=(ds,h)=>diffBD(base.start,ds)*PHPD+frac(h)-frac(base.startHour);
const nowProd=prodAt(TODAY,nowHour);
console.log(person.name+"   cursor "+TODAY+" "+nowHour.toFixed(2)+"   (" + nowProd.toFixed(2) + "h on the row axis)");
console.log("");
console.log("bar".padEnd(28)+"start".padEnd(12)+"sH".padStart(6)+"push".padStart(8)+"len".padStart(8)+"   vs cursor");
for (const o of ops) {
  const push=pushes.get(String(o.id))||0;
  const s=prodAt(o.start,o.startHour)+push;
  const len=barLengthHours({...o,
  // Capped at the hours worked, as the shipped rule does -- a pinned bar is not
    // stretched to the cursor on elapsed time alone.
    elapsedToCursorH:o.isRecord?null:Math.min(Math.max(0,-rel),o.ownWorkedHours||0)});
  const rel=s-nowProd;
  console.log(o.title.padEnd(28)+o.start.padEnd(12)+o.startHour.toFixed(1).padStart(6)+
    push.toFixed(2).padStart(8)+len.toFixed(2).padStart(8)+"   "+(rel>=0?"+":"")+rel.toFixed(2)+"h"+
    (atCursor.has(String(o.id))?"  AT-CURSOR":"")+(push>0?"  (pushed "+(push/PHPD).toFixed(2)+"d)":""));
}