import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const wb = XLSX.readFile('../OneDrive - Matrix Systems/Documents/TRAQS INFO UPDATED.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
const headers = rows[0];
console.log('Headers:', headers);

function score(header, high, med) {
  const h = String(header||'').toLowerCase().replace(/[_.\\/-]/g,' ').trim();
  let s = 0;
  for(const t of high) { if(h===t) s+=20; else if(h.includes(t)||t.includes(h)) s+=10; }
  for(const t of med)  { if(h===t) s+=6;  else if(h.includes(t)) s+=3; else if(t.includes(h)&&h.length>2) s+=1; }
  return s;
}

const FIELDS = {
  poNumber:   { high:['purchase order','po #','po#','po number'], med:['po','purchase'] },
  startDate:  { high:['start date','begin date','planned start','date start'], med:['start','begin'] },
  dueDate:    { high:['ship date','due date','required date','delivery date','target date'], med:['due','ship','delivery','deadline'] },
  endDate:    { high:['end date','finish date','completion date'], med:['end','finish'] },
  client:     { high:['customer name','client name','end user'], med:['client','customer','cust','company','account'] },
  assignedTo: { high:['assigned to','project manager','responsible party'], med:['assign','tech','engineer','pm','manager','worker','team'] },
  title:      { high:['job name','job title','project name','mtx project','project title'], med:['title','name','project','scope','task'] },
  jobNumber:  { high:['work order','wo #','job #','job number','mtx project','project number'], med:['job','order','wo','wor'] },
  notes:      { high:['special instructions','additional notes','job notes'], med:['note','comment','remark','memo'] },
};

const claimed = new Set();
for(const [field, {high,med}] of Object.entries(FIELDS)) {
  const ranked = headers.map((h,i)=>({col:i,h,s:score(h,high,med)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);
  const best = ranked.find(x => !claimed.has(x.col));
  if(best) { claimed.add(best.col); console.log(field, '->', best.h, '(score:'+best.s+')'); }
  else console.log(field, '-> NOT FOUND');
}

const levelCol = headers.findIndex(h=>['sh','level','lvl','lv','indent','hierarchy','tier'].includes(String(h||'').toLowerCase().trim()));
console.log('levelCol:', levelCol, '->', headers[levelCol]);

// Show splitJobTitle logic
const testVals = ['401964 - Thacker pass', '401944', '401944-01 (1)', 'CUT'];
for(const v of testVals) {
  const m = v.match(/^([A-Z]{0,3}\d[\d-]*?)\s*[-–]\s*([^-].*)$/);
  if(m) console.log('split:', v, '->', 'num:', m[1], 'title:', m[2]);
  else if(/^\d+$/.test(v.trim())) console.log('split:', v, '->', 'num:', v, 'title:', v);
  else console.log('split:', v, '->', 'op/panel (no split)');
}
