// Pay periods by explicit day-of-month pair (orgSettings.payDates), lifted out of TRAQS.jsx
// so iOS can be held to the real code through fixtures/schedule-parity.json (`payPeriods`)
// rather than to a second hand-written copy.
//
// e.g. [5, 20] → periods are 5th–19th and 20th–4th of each month.
// `today` is a shop day, "YYYY-MM-DD"; the answer is shop days too. The Date maths below is
// the local-calendar kind, and only ever round-trips a calendar day, so it gives the same
// days in every zone.

const toDS = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

// Returns { start, end, periodNumber }.
export function getPayPeriodFromDates(payDates, today) {
  const dates = [...(payDates || [5, 20])].map(Number).sort((a, b) => a - b);
  const [d1, d2] = dates;
  const t = new Date(today + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth(), day = t.getDate();
  let start, end;
  if (day >= d1 && day < d2) {
    start = new Date(y, m, d1); end = new Date(y, m, d2 - 1);
  } else if (day >= d2) {
    start = new Date(y, m, d2); end = new Date(y, m + 1, d1 - 1);
  } else {
    start = new Date(y, m - 1, d2); end = new Date(y, m, d1 - 1);
  }
  const periodNumber = (y - 2020) * 24 + m * 2 + (day >= d2 ? 1 : day >= d1 ? 0 : -1) + 1;
  return { start: toDS(start), end: toDS(end), periodNumber: Math.max(1, periodNumber) };
}

// The period `offset` periods before (negative) or after the one containing `today`.
export function getPayPeriodAtOffsetFromDates(payDates, today, offset) {
  let period = getPayPeriodFromDates(payDates, today);
  for (let i = 0; i < Math.abs(offset); i++) {
    const ref = new Date((offset < 0 ? period.start : period.end) + "T00:00:00");
    ref.setDate(ref.getDate() + (offset < 0 ? -1 : 1));
    period = getPayPeriodFromDates(payDates, toDS(ref));
  }
  return period;
}
