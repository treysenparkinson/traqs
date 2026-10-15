// Preload for scripts/clock-shift-test.mjs: moves "now" to CLOCK_SHIFT_TO (an ISO instant)
// while leaving every explicit date alone. Loaded with NODE_OPTIONS="--import <this file>".
//
// Covers `new Date()`, `Date()` and `Date.now()`, which is how the server reads the clock.
// It does not reach engine-internal reads (`Intl.DateTimeFormat().format()` with no argument
// uses the real clock), so a "today" must come from one of the three above to be shifted.
const target = Date.parse(process.env.CLOCK_SHIFT_TO || "");
if (Number.isFinite(target)) {
  const RealDate = Date;
  // The REAL clock function, captured once. Reading `RealDate.now` at call time looped forever
  // under a suite that saves and restores Date.now (timeclock-itest: `const realNow = Date.now;
  // ... Date.now = realNow;`) — through this proxy the saved value is `now` itself, and the
  // restore writes it onto the real Date, so `now` then called `now`. Found when
  // timeclock-itest joined the build (#273): "Maximum call stack size exceeded" at every
  // shifted clock.
  const realNow = RealDate.now.bind(RealDate);
  const offset = target - realNow();
  const now = () => realNow() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (D, args, newTarget) => Reflect.construct(D, args.length ? args : [now()], newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (D, prop, recv) => (prop === "now" ? now : Reflect.get(D, prop, recv)),
  });
}
