// Measures the two DONE-badge flex structures EXACTLY as src/TRAQS.jsx writes
// them, in a real engine, with no auth. This cannot see a nested wrapper the
// real app might add -- it answers only "does the CSS as written give a gap?".
import { chromium } from "playwright-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await chromium.launch({ executablePath: CHROME, channel: "chrome", headless: true });
const page = await b.newPage();
await page.setContent(`<body style="margin:0">
<!-- DAY MODE, TRAQS.jsx:15624-15625 -->
<div id="day" style="position:relative;width:420px;height:34px;border-radius:6px;background:#4a7ebb;display:flex;align-items:center;padding:0 16px;overflow:hidden">
  <div style="position:absolute;left:0;top:0;bottom:0;width:12px"></div>
  <span id="dayBadge" style="font-size:9px;font-weight:800;color:#fff;letter-spacing:0.05em;flex-shrink:0;margin-right:6px;opacity:0.85">DONE</span>
  <span id="dayLabel" style="font-size:10px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left;position:relative;z-index:5">8h · Developement</span>
</div>
<!-- WEEK/MONTH MODE, TRAQS.jsx:17402-17403 -->
<div id="wk" style="position:relative;width:420px;height:34px;border-radius:6px;background:#4a7ebb;display:flex;align-items:center;overflow:hidden;padding:0 12px">
  <span id="wkBadge" style="flex-shrink:0;margin-right:6px;font-size:9px;font-weight:800;letter-spacing:0.05em;opacity:0.85;color:#fff">DONE</span>
  <span id="wkLabel" style="font-size:11px;color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;z-index:5;flex:1;padding-left:12px;padding-right:8px">Phase 1</span>
</div></body>`);
const r = await page.evaluate(() => {
  const m = (bid, lid, pid) => {
    const bd = document.getElementById(bid).getBoundingClientRect();
    const lb = document.getElementById(lid);
    const lr = lb.getBoundingClientRect();
    const pl = parseFloat(getComputedStyle(lb).paddingLeft);
    return { parentLeft: +document.getElementById(pid).getBoundingClientRect().left.toFixed(1),
      badgeLeft: +bd.left.toFixed(1), badgeRight: +bd.right.toFixed(1),
      labelBorderLeft: +lr.left.toFixed(1), labelPaddingLeft: pl,
      gapBadgeToLabelBox: +(lr.left - bd.right).toFixed(2),
      gapBadgeToLabelTEXT: +((lr.left + pl) - bd.right).toFixed(2) };
  };
  return { day: m("dayBadge","dayLabel","day"), week: m("wkBadge","wkLabel","wk") };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
