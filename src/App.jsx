import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import TRAQS from "./TRAQS.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
// Only the banded header (org-code / login steps) still uses an image wordmark;
// the redesigned roster screen sets it as live text — see TraqsLockup.
import { UL_LOGO_WHITE } from "./logo.js";
import TRAQS_BARS from "./traqs-bars.png";
import { fetchOrgConfig, createOrg, forgotOrgCode, fetchPeople } from "./api.js";

const LS_CODE = "tq_org_code";
const LS_CONFIG = "tq_org_config";
const LS_PEOPLE = "tq_team_people";

// Org identity (code, config, roster) is stored in localStorage so it survives
// an app relaunch. Capacitor's WKWebView wipes sessionStorage every time the app
// is terminated, which is why returning users used to get bounced back to the
// org-code screen on every launch. localStorage persists across launches, so the
// code is entered once on first install and then remembered. (Per-session state
// like the selected person / re-auth throttle stays in sessionStorage.)
const persist = window.localStorage;

// ─── Brand ────────────────────────────────────────────────────────────────────
// The login screen renders before a theme is resolved, so it carries its own
// accent. Matches the sky the light ("frost") theme now uses, and the sky baked
// into the bars asset, so login and app agree.
const LOGIN_BLUE = "#38BDF8";

/**
 * The TRAQS lockup: wordmark then the bars mark, per the lockup spec.
 *
 * The wordmark is LIVE TEXT (Space Grotesk 700, -.05em, thickened with
 * -webkit-text-stroke), not the logo.js image. That is what makes the bars line
 * up: `align-items: baseline` aligns the image's bottom edge to the text's real
 * baseline. Against an image wordmark there is no baseline to align to — only
 * the PNG's bottom edge, which sits below it by the tail of the "q" — so the
 * position had to be guessed at, and it read wrong at every size.
 *
 * Bars are the brand asset, which already carries the sky accent on the third
 * bar. Stroke scales with size the way the spec's ladder does (84px→1.5px,
 * 22px→0.4px); text-stroke is cleared on the image so it isn't outlined.
 */
function TraqsLockup({ size = 84, color = INK, stroke = 1.5, bars = true }) {
  return (
    <span
      aria-label="TRAQS"
      style={{
        display: "inline-flex",
        alignItems: "baseline",       // the bars image aligns its BOTTOM to the text baseline
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        fontWeight: 700,
        letterSpacing: "-.05em",
        lineHeight: 1,
        fontSize: size,
        color,
        WebkitTextStroke: `${stroke}px ${color}`,
      }}
    >
      traqs
      {bars && (
        <img
          src={TRAQS_BARS}
          alt=""
          aria-hidden="true"
          style={{
            height: ".52em",          // x-height, per the lockup spec
            width: "auto",
            marginLeft: ".07em",
            transform: "translateY(.01em)",
            WebkitTextStroke: 0,
          }}
        />
      )}
    </span>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
// Paper palette from the Login Redesign: warm off-white ground, near-black ink,
// stone-grey secondary. Deliberately not #fff/#0f172a — the design's warmth is
// what separates it from a generic auth screen.
const PAPER = "#EDEAE3";
const CARD_BG = "#FBFAF7";
const INK = "#0B0B0C";
const STONE = "#8A867E";
const HAIRLINE = "rgba(16,24,40,.08)";

const PAGE = {
  minHeight: "100vh",
  position: "relative",
  background: PAPER,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "48px 20px",
  boxSizing: "border-box",
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

const CARD = {
  width: "100%",
  maxWidth: 420,
  background: "#ffffff",
  borderRadius: 20,
  border: "1px solid #e2e8f0",
  boxShadow: "0 24px 60px rgba(15,23,42,0.10)",
  overflow: "hidden",
};

const CARD_HEADER = {
  padding: "32px 28px 24px",
  textAlign: "center",
  background: "linear-gradient(135deg, #4169e1, #06b6d4)",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
};

const CARD_BODY = { padding: "28px 28px 24px" };

const CARD_FOOTER = {
  padding: "12px 24px 18px",
  textAlign: "center",
  borderTop: "1px solid rgba(15,23,42,0.06)",
  fontSize: 11,
  color: "#64748b",
};

const INPUT_STYLE = {
  width: "100%",
  padding: "12px 14px",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  color: "#0f172a",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
};

const BTN = {
  width: "100%",
  padding: "13px 0",
  background: "linear-gradient(135deg, #4169e1, #06b6d4)",
  border: "none",
  borderRadius: 10,
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "0.02em",
  boxShadow: "0 4px 20px rgba(65,105,225,0.33)",
  transition: "all 0.2s",
};

const LINK_BTN = {
  background: "none",
  border: "none",
  color: "#4169e1",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
  padding: 0,
  textDecoration: "underline",
};

const LABEL = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: 6,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const ERR_BOX = {
  background: "rgba(239,68,68,0.1)",
  border: "1px solid rgba(239,68,68,0.3)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "#fca5a5",
  fontSize: 13,
  marginBottom: 16,
};

const SUCCESS_BOX = {
  background: "rgba(16,185,129,0.1)",
  border: "1px solid rgba(16,185,129,0.3)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "#6ee7b7",
  fontSize: 13,
  marginBottom: 16,
};

const HINT = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 6,
};

// ─── Paper styles ─────────────────────────────────────────────────────────────
// The redesign's card/input/button, shared by every step that has been moved
// onto the paper ground. Kept separate from the older CARD/INPUT_STYLE/BTN so
// the steps still on the banded layout keep working untouched.
const PAPER_CARD = {
  background: CARD_BG,
  borderRadius: 28,
  border: "1px solid rgba(16,24,40,.07)",
  boxShadow: "0 30px 70px rgba(16,24,40,.10)",
  padding: "30px 32px 26px",
  boxSizing: "border-box",
};

const PAPER_INPUT = {
  width: "100%",
  padding: "13px 15px",
  background: "#fff",
  border: "1px solid rgba(16,24,40,.12)",
  borderRadius: 14,
  color: INK,
  fontSize: 15,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
};

const PAPER_LABEL = {
  display: "block",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: STONE,
  marginBottom: 8,
};

const PAPER_BTN = {
  width: "100%",
  padding: "13px 0",
  background: INK,
  border: "none",
  borderRadius: 999,
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "-.01em",
};

const PAPER_LINK = {
  background: "none",
  border: "none",
  color: STONE,
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
  padding: 0,
  textDecoration: "underline",
};

// ─── Load-up sequence (org-code screen) ───────────────────────────────────────
// The lockup fades in at the centre of the screen, travels up into place, then
// the copy types and the card bounces in.
//
// The travel uses a per-keyframe timing function so the fade and the move can
// have different curves in ONE animation: the hold is linear, then the move
// runs easeInOutQuint — slow, fast, slow — rather than a single curve applied
// across both phases, which would have made the fade drift upward.
// `--tq-rise` is how far BELOW its resting place the lockup starts. The content
// block is vertically centred, so the logo rests roughly a card-height above
// screen centre — clamped rather than a flat vh, because a percentage that
// centres the logo on a laptop drops it well below centre on a tall monitor.
const LOADUP_CSS = `
@keyframes tqLogoIn {
  0%   { opacity: 0; transform: translateY(var(--tq-rise)) scale(.97); animation-timing-function: cubic-bezier(.33,0,.2,1); }
  40%  { opacity: 1; transform: translateY(var(--tq-rise)) scale(1); }
  46%  { opacity: 1; transform: translateY(var(--tq-rise)) scale(1); animation-timing-function: cubic-bezier(.83,0,.17,1); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes tqFadeUp {
  from { opacity: 0; transform: translateY(7px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes tqFadeIn { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .tq-logo-in, .tq-fade { animation: none !important; opacity: 1 !important; transform: none !important; }
}
`;

// Load-up timeline, in ms.
//
// The logo runs 2.4s: ~960ms fading in at centre (40%), a brief hold, then the
// travel up. Everything after it fades in one at a time rather than typing, so
// the eye is led down the page: greeting, instructions, card, then the
// strapline once the rest has settled.
const LOGO_MS = 2400;
// Greeting and instructions share one slow fade (COPY_MS) and are only 150ms
// apart, so they read as one gesture arriving in succession rather than two
// separate events. The card follows on the same curve — a fade, not a bounce.
const COPY_MS = 760;
const TITLE_AT = 2150;   // starts just before the logo lands
const BLURB_AT = TITLE_AT + 150;
const CARD_AT = BLURB_AT + 330;
const FOOT_AT = CARD_AT + 620;
// inline-block so the translate in tqFadeUp actually applies — transforms are
// ignored on inline boxes.
const FADE = (delay, ms = 520, name = "tqFadeUp") =>
  ({ display: "inline-block", opacity: 0, animation: `${name} ${ms}ms cubic-bezier(.22,1,.36,1) ${delay}ms both` });

// Mono strapline under the card, matching the roster screen's org-code line.
const PAPER_FOOT = {
  marginTop: 16,
  textAlign: "center",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: ".08em",
  color: "#B4B0A7",
};

/**
 * Brand block. `outside` renders the redesign's arrangement — lockup and
 * greeting sit on the page above the card, not inside a coloured header band.
 * The banded form is kept for the other auth steps, which still use CARD.
 */
function LogoHeader({ subtitle, hint, outside = false, right = null, animate = false }) {
  // The rise is MEASURED, not guessed. Any fixed vh/px start lands wherever the
  // content height happens to put it, which is why earlier attempts drifted past
  // centre. This reads the lockup's resting position and computes the exact
  // offset to the viewport's centre, so the fade always happens dead centre
  // whatever the screen or the step's content height.
  //
  // useLayoutEffect so the measure + re-render happen BEFORE paint — with a
  // plain effect the logo flashes at its resting place for one frame first.
  const logoRef = useRef(null);
  const [rise, setRise] = useState(null);
  useLayoutEffect(() => {
    if (!animate) return;
    const el = logoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRise(Math.round(window.innerHeight / 2 - (r.top + r.height / 2)));
  }, [animate]);

  const measured = rise != null;
  if (outside) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, marginBottom: 28 }}>
        <span
          ref={logoRef}
          className={animate ? "tq-logo-in" : undefined}
          style={animate ? {
            display: "block",
            willChange: "transform, opacity",
            // Hidden until measured so it can't appear in the wrong place first.
            opacity: measured ? undefined : 0,
            ...(measured ? { "--tq-rise": `${rise}px`, animation: `tqLogoIn ${LOGO_MS}ms both` } : null),
          } : undefined}
        >
          <TraqsLockup size={84} />
        </span>
        {right}
        {/* minHeight reserves the line boxes up front. Without it the block grows
            as the copy types and shoves the card down mid-bounce. */}
        <div style={{ textAlign: "center" }}>
          {subtitle && (
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: INK, minHeight: animate ? 26 : undefined }}>{subtitle}</div>
          )}
          {hint && <div style={{ marginTop: 5, fontSize: 13.5, color: STONE, minHeight: animate ? 18 : undefined }}>{hint}</div>}
        </div>
      </div>
    );
  }
  return (
    <div style={CARD_HEADER}>
      <img src={UL_LOGO_WHITE} alt="TRAQS" style={{ height: 72, objectFit: "contain", marginBottom: 14 }} />
      {subtitle && (
        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.75)", letterSpacing: "0.06em" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function Spinner({ label }) {
  return (
    <div style={{ ...PAGE, flexDirection: "column", color: "#0f172a" }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "3px solid #4169e133", borderTop: "3px solid #4169e1",
        animation: "spin 0.8s linear infinite", marginBottom: 20,
      }} />
      {label && <div style={{ fontSize: 14, color: "#94a3b8" }}>{label}</div>}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function BtnPrimary({ children, loading, loadingLabel, onClick, type = "submit", style = {} }) {
  return (
    <button
      type={type}
      disabled={loading}
      onClick={onClick}
      style={{ ...BTN, opacity: loading ? 0.7 : 1, ...style }}
      onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(65,105,225,0.44)"; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(65,105,225,0.33)"; }}
    >
      {loading ? (loadingLabel || "Loading…") : children}
    </button>
  );
}

// ─── Step 1: Enter org code ───────────────────────────────────────────────────
function OrgCodeStep({ onContinue, onCreateOrg, onForgot }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError("Please enter an organization code."); return; }
    setLoading(true); setError("");
    try {
      const config = await fetchOrgConfig(trimmed);
      persist.setItem(LS_CODE, trimmed);
      persist.setItem(LS_CONFIG, JSON.stringify(config));
      onContinue(trimmed, config);
    } catch (err) {
      setError(err.message.includes("not found")
        ? "Organization not found. Check your code or create a new organization."
        : err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={PAGE}>
      <style>{LOADUP_CSS}</style>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Same brand block as the roster screen — lockup on the paper ground,
            greeting beneath it, card below. Sequenced on first paint: logo in,
            logo up, copy types, card bounces. */}
        <LogoHeader
          outside
          animate
          subtitle={<span className="tq-fade" style={FADE(TITLE_AT, COPY_MS)}>Welcome</span>}
          hint={<span className="tq-fade" style={FADE(BLURB_AT, COPY_MS)}>Enter your organization code to get started.</span>}
        />
        <div className="tq-fade" style={{ ...PAPER_CARD, ...FADE(CARD_AT, COPY_MS), display: "block" }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.28)",
                borderRadius: 12, padding: "10px 14px", color: "#B42318", fontSize: 13, marginBottom: 16,
              }}>{error}</div>
            )}
            <label style={PAPER_LABEL}>Organization Code</label>
            <input
              style={PAPER_INPUT}
              type="text"
              placeholder="Enter your organization code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onFocus={e => { e.currentTarget.style.borderColor = LOGIN_BLUE; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(16,24,40,.12)"; }}
              autoFocus
              autoComplete="off"
              maxLength={20}
            />
            <button
              type="submit"
              disabled={loading}
              style={{ ...PAPER_BTN, marginTop: 18, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer" }}
            >
              {loading ? "Looking up…" : "Continue"}
            </button>
          </form>
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <span style={{ fontSize: 12.5, color: "#B4B0A7" }}>
              New organizations coming soon
            </span>
          </div>
        </div>
        {/* Last in, once the card has settled. */}
        <div className="tq-fade" style={{ ...PAPER_FOOT, ...FADE(FOOT_AT, 620, "tqFadeIn"), display: "block" }}>
          Secured by Auth0 · TRAQS
        </div>
      </div>
    </div>
  );
}

// ─── Forgot org code ──────────────────────────────────────────────────────────
function ForgotOrgStep({ onBack }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) { setError("Please enter a valid email address."); return; }
    setLoading(true); setError("");
    try {
      await forgotOrgCode(trimmed);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={PAGE}>
      <div style={CARD}>
        <LogoHeader subtitle="Forgot Organization Code" />
        <div style={CARD_BODY}>
          {sent ? (
            <>
              <div style={SUCCESS_BOX}>
                If an organization is associated with that email address, you will receive your org code shortly.
              </div>
              <BtnPrimary type="button" onClick={onBack}>Back to Sign In</BtnPrimary>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && <div style={ERR_BOX}>{error}</div>}
              <p style={{ margin: "0 0 20px", fontSize: 14, color: "#94a3b8", lineHeight: 1.6 }}>
                Enter your work email address and we'll send your organization code to that address.
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={LABEL}>Work Email Address</label>
                <input
                  style={INPUT_STYLE}
                  type="email"
                  placeholder="you@yourcompany.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                />
              </div>
              <BtnPrimary loading={loading} loadingLabel="Sending…">Send My Org Code</BtnPrimary>
            </form>
          )}
          {!sent && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button style={LINK_BTN} onClick={onBack}>← Back</button>
            </div>
          )}
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
      </div>
    </div>
  );
}

// ─── Create org form ──────────────────────────────────────────────────────────
function CreateOrgStep({ onSuccess, onBack }) {
  const [form, setForm] = useState({ code: "", name: "", domain: "", adminEmail: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const domain = form.domain.trim().toLowerCase().replace(/^@/, "");
    const adminEmail = form.adminEmail.trim();
    if (!code || !name || !domain || !adminEmail) { setError("All fields are required."); return; }
    if (!/^[a-zA-Z0-9]{3,20}$/.test(code)) { setError("Org code must be 3–20 letters and numbers only."); return; }
    if (!domain.includes(".")) { setError("Please enter a valid domain, e.g. yourcompany.com"); return; }
    setLoading(true); setError("");
    try {
      await createOrg({ code, name, domain, adminEmail });
      const config = { name, domain, adminEmail, createdAt: new Date().toISOString() };
      persist.setItem(LS_CODE, code);
      persist.setItem(LS_CONFIG, JSON.stringify(config));
      onSuccess(code, config);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={PAGE}>
      <div style={{ ...CARD, maxWidth: 460 }}>
        <LogoHeader subtitle="Create Your Organization" />
        <div style={CARD_BODY}>
          <form onSubmit={handleSubmit}>
            {error && <div style={ERR_BOX}>{error}</div>}

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Organization Name</label>
              <input style={INPUT_STYLE} type="text" placeholder="Acme Corp" value={form.name} onChange={set("name")} autoFocus autoComplete="off" />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Org Code</label>
              <input
                style={INPUT_STYLE}
                type="text"
                placeholder="ACME"
                value={form.code.toUpperCase()}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                autoComplete="off"
                maxLength={20}
              />
              <div style={HINT}>3–20 letters and numbers. This is what your team types to log in.</div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Email Domain</label>
              <input style={INPUT_STYLE} type="text" placeholder="acmecorp.com" value={form.domain} onChange={set("domain")} autoComplete="off" />
              <div style={HINT}>Only users with this email domain can log in to your organization.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={LABEL}>Admin Email</label>
              <input style={INPUT_STYLE} type="email" placeholder="admin@acmecorp.com" value={form.adminEmail} onChange={set("adminEmail")} autoComplete="email" />
              <div style={HINT}>Used for account recovery and org code lookup emails.</div>
            </div>

            <BtnPrimary loading={loading} loadingLabel="Creating…">Create Organization</BtnPrimary>
          </form>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button style={LINK_BTN} onClick={onBack}>← Back</button>
          </div>
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
      </div>
    </div>
  );
}

// ─── Login step ───────────────────────────────────────────────────────────────
function LoginStep({ orgCode, orgConfig, onSwitch, loginWithRedirect }) {
  return (
    <div style={PAGE}>
      <div style={CARD}>
        <LogoHeader />
        <div style={CARD_BODY}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 16px", background: "rgba(65,105,225,0.12)",
              borderRadius: 20, marginBottom: 10,
              border: "1px solid rgba(65,105,225,0.22)",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: "#10b981", boxShadow: "0 0 6px #10b98155" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#4169e1" }}>{orgConfig.name}</span>
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>@{orgConfig.domain} accounts only</div>
            <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 6 }}>Sign in to access your schedule</div>
          </div>
          <BtnPrimary
            type="button"
            onClick={() => loginWithRedirect(orgConfig.connection
              ? { authorizationParams: { connection: orgConfig.connection } }
              : undefined)}
          >
            Sign in with Microsoft
          </BtnPrimary>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button style={LINK_BTN} onClick={onSwitch}>Switch organization</button>
          </div>
        </div>
        <div style={CARD_FOOTER}>Org code: {orgCode} · Secured by Auth0</div>
      </div>
    </div>
  );
}

// ─── Domain mismatch error ────────────────────────────────────────────────────
function DomainError({ userEmail, orgDomain, onLogout }) {
  return (
    <div style={PAGE}>
      <div style={CARD}>
        <LogoHeader subtitle="Access Denied" />
        <div style={CARD_BODY}>
          <div style={{ ...ERR_BOX, marginBottom: 0 }}>
            <strong>Email domain mismatch</strong>
            <p style={{ margin: "6px 0 0" }}>
              Your account <strong>{userEmail}</strong> is not authorized for this organization.<br />
              This org requires <strong>@{orgDomain}</strong> email addresses.
            </p>
          </div>
          <BtnPrimary
            type="button"
            onClick={onLogout}
            style={{ marginTop: 20, background: "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: "0 4px 20px rgba(239,68,68,0.33)" }}
          >
            Sign Out &amp; Try Again
          </BtnPrimary>
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
      </div>
    </div>
  );
}

// ─── Team roster step ─────────────────────────────────────────────────────────
// Labels and confirmation copy for every kiosk clock action.
const CLOCK_MODE_META = {
  clockIn:    { title: "Clock In",     verb: "IN",        verbColor: "#10b981", successMsg: "Clocked in successfully!" },
  clockOut:   { title: "Clock Out",    verb: "OUT",       verbColor: "#ef4444", successMsg: "Clocked out successfully!" },
  lunchStart: { title: "Start Lunch",  verb: "ON LUNCH",  verbColor: "#f59e0b", successMsg: "Lunch started!" },
  lunchEnd:   { title: "Back From Lunch", verb: "OFF LUNCH", verbColor: "#10b981", successMsg: "Welcome back!" },
  breakStart: { title: "Start Break",  verb: "ON BREAK",  verbColor: "#f59e0b", successMsg: "Break started!" },
  breakEnd:   { title: "End Break",    verb: "OFF BREAK", verbColor: "#f59e0b", successMsg: "Break ended!" },
};

function TeamSelectStep({ orgCode, orgConfig, teamPeople, onSelectPerson, onAdminLogin, onSwitch, onRefresh }) {
  const [clockMode, setClockMode] = useState(null); // null | "clockIn" | "clockOut" | "lunchStart" | "lunchEnd" | "breakStart" | "breakEnd"
  const [view, setView] = useState("login"); // "login" (roster sign-in) | "clock" (clock in/out kiosk) — toggled bottom-right
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [confirmedPerson, setConfirmedPerson] = useState(null);
  const [clockDone, setClockDone] = useState(false);
  // Records the action actually performed after Confirm — drives the success message.
  // For Clock Out the worker now picks between "lunchStart" (going to lunch) and "clockOut"
  // (end of day), so the meta we show on success depends on what they chose, not on clockMode.
  const [completedAction, setCompletedAction] = useState(null);

  function openClock(mode) {
    setClockMode(mode);
    setPinValue("");
    setPinError("");
    setConfirmedPerson(null);
    setClockDone(false);
    setCompletedAction(null);
  }

  function closeClockModal() {
    setClockMode(null);
    setPinValue("");
    setPinError("");
    setConfirmedPerson(null);
    setClockDone(false);
    setCompletedAction(null);
  }

  async function handlePinConfirm() {
    if (!pinValue.trim()) { setPinError("Please enter your PIN."); return; }
    setPinLoading(true);
    setPinError("");
    try {
      const res = await fetch("/.netlify/functions/timeclock", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Code": orgCode },
        body: JSON.stringify({ action: "identify", pin: pinValue }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPinError("PIN not recognized. Please try again.");
        setPinValue("");
      } else {
        setConfirmedPerson({ name: data.name, personId: data.personId, activeClockIn: data.activeClockIn || null });
      }
    } catch {
      setPinError("Connection error. Please try again.");
    } finally {
      setPinLoading(false);
    }
  }

  async function handleClockYes(actionOverride) {
    setPinLoading(true);
    setPinError("");
    try {
      const action = actionOverride || clockMode;
      const body = action === "clockIn"
        ? { action, personId: confirmedPerson.personId, pin: pinValue, jobRefs: [] }
        : { action, personId: confirmedPerson.personId, pin: pinValue };
      const res = await fetch("/.netlify/functions/timeclock", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Code": orgCode },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPinError(data.error || "Clock action failed. Please try again.");
      } else {
        setCompletedAction(action);
        setClockDone(true);
        // Pull a fresh roster so the status pills update right away for this kiosk.
        if (onRefresh) onRefresh();
      }
    } catch {
      setPinError("Connection error. Please try again.");
    } finally {
      setPinLoading(false);
    }
  }

  function getInitials(name) {
    const parts = (name || "?").trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  return (
    <>
      <div style={PAGE}>
        {/* Flat paper ground, no wash — the design's warmth carries it. */}
        <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 1060 }}>
          <LogoHeader
            outside
            subtitle={view === "clock" ? "Clock In / Out" : "Who are you?"}
            hint={view === "clock" ? "Pick your name to clock in or out." : "Pick your name to log in or clock in."}
            right={
              <button type="button" onClick={onSwitch} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: INK,
                background: "#fff", border: "1px solid rgba(16,24,40,.1)", borderRadius: 999,
                padding: "9px 16px", cursor: "pointer", boxShadow: "0 2px 6px rgba(16,24,40,.05)",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E" }} />
                {orgConfig.name}
                <span style={{ color: STONE, fontWeight: 500, borderLeft: "1px solid rgba(16,24,40,.12)", paddingLeft: 10, marginLeft: 2 }}>Switch</span>
              </button>
            }
          />
          <div style={{ background: CARD_BG, borderRadius: 32, border: "1px solid rgba(16,24,40,.07)", boxShadow: "0 30px 70px rgba(16,24,40,.10)", padding: "32px 40px 26px", boxSizing: "border-box" }}>

            {view === "login" && (teamPeople.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 14, color: "#64748b", marginBottom: 16 }}>No team members yet.</div>
                <BtnPrimary type="button" onClick={onAdminLogin}>Admin Login</BtnPrimary>
              </div>
            ) : (() => {
              const admins = teamPeople.filter(p => p.userRole === "admin");
              const employees = teamPeople.filter(p => p.userRole !== "admin");

              // Derive the live status shown on each person card.
              // online = clocked in, no open lunch/break. lunch/break = on that.
              const getStatus = (person) => {
                if (!person.activeClockIn) return "offline";
                const events = person.activeClockIn.events || [];
                const lastLunch = [...events].reverse().find(e => e.type === "lunchStart" || e.type === "lunchEnd");
                if (lastLunch?.type === "lunchStart") return "lunch";
                const lastBreak = [...events].reverse().find(e => e.type === "breakStart" || e.type === "breakEnd");
                if (lastBreak?.type === "breakStart") return "break";
                return "online";
              };
              const STATUS_STYLE = {
                offline: { label: "Offline", dot: "#94a3b8", text: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" },
                online:  { label: "Online",  dot: "#10b981", text: "#047857", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.35)" },
                lunch:   { label: "Lunch",   dot: "#f59e0b", text: "#b45309", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.35)" },
                break:   { label: "Break",   dot: "#f59e0b", text: "#b45309", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.35)" },
              };

              const PersonBtn = ({ person }) => {
                const status = getStatus(person);
                const s = STATUS_STYLE[status];
                // The status pill is gone: the design puts presence on the avatar
                // as a corner dot and folds the wording into the role line, which
                // keeps the row to two elements instead of three.
                const online = status !== "offline";
                return (
                <button
                  type="button"
                  onClick={() => onSelectPerson(person)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px",
                    background: "#fff",
                    border: "1px solid rgba(16,24,40,.07)",
                    borderRadius: 16,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 24px rgba(16,24,40,.10)"; e.currentTarget.style.borderColor = `${LOGIN_BLUE}80`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "rgba(16,24,40,.07)"; }}
                >
                  <span style={{
                    position: "relative",
                    width: 42, height: 42, borderRadius: "50%",
                    background: person.color || LOGIN_BLUE,
                    display: "grid", placeItems: "center",
                    flexShrink: 0,
                    fontSize: 14, fontWeight: 700, color: "#fff",
                  }}>
                    {getInitials(person.name)}
                    <span style={{
                      position: "absolute", right: -1, bottom: -1,
                      width: 11, height: 11, borderRadius: "50%",
                      border: "2px solid #fff", boxSizing: "border-box",
                      background: online ? s.dot : "#C9C5BC",
                    }} />
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden" }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15, letterSpacing: "-.01em", color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {person.name}
                    </span>
                    <span style={{ display: "block", fontSize: 12, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: online ? "#16A34A" : STONE, fontWeight: online ? 600 : 400 }}>
                      {online
                        ? [s.label, person.userRole === "admin" ? "Admin" : person.department].filter(Boolean).join(" · ")
                        : (person.userRole === "admin" ? "Admin" : (person.department || "No department"))}
                    </span>
                  </span>
                </button>
                );
              };

              // Mono eyebrow with a rule running to the right edge — the design's
              // section marker, replacing the plain label + separate divider.
              const SectionLabel = ({ label, first = false }) => (
                <div style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase",
                  color: STONE, margin: first ? "0 2px 12px" : "26px 2px 12px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {label}
                  <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
                </div>
              );

              // The section rule now carries the separation the divider used to.
              const Divider = () => null;

              return (
                <div style={{ marginBottom: 4 }}>
                  {admins.length > 0 && (
                    <div>
                      <SectionLabel label="Admins" first />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
                        {admins.map(p => <PersonBtn key={p.id ?? p.name} person={p} />)}
                      </div>
                    </div>
                  )}
                  {admins.length > 0 && employees.length > 0 && <Divider />}
                  {employees.length > 0 && (
                    <div>
                      <SectionLabel label="Employees" />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
                        {employees.map(p => <PersonBtn key={p.id ?? p.name} person={p} />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })())}

            {view === "clock" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button
                  type="button"
                  onClick={() => openClock("clockIn")}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 112, padding: "22px 0", width: "100%", background: "linear-gradient(135deg, #10b981, #059669)", border: "none", borderRadius: 16, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(16,185,129,0.32)", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 30px rgba(16,185,129,0.45)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(16,185,129,0.32)"; }}
                >
                  <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.01em" }}>Clock In</span>
                  <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>Start your shift</span>
                </button>
                <button
                  type="button"
                  onClick={() => openClock("clockOut")}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 112, padding: "22px 0", width: "100%", background: "linear-gradient(135deg, #ef4444, #dc2626)", border: "none", borderRadius: 16, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(239,68,68,0.32)", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 30px rgba(239,68,68,0.45)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(239,68,68,0.32)"; }}
                >
                  <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.01em" }}>Clock Out</span>
                  <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>End shift, lunch or break</span>
                </button>
              </div>
            )}

            {/* "Powered by" lockup, inside the card as in the design. The org
                switcher moved up into the header pill, so it isn't repeated here. */}
            <div style={{ marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: STONE }}>
                Powered by
                {/* Wordmark only — the bars are the mark, and repeating them in a
                    footer credit competes with the real lockup up top. */}
                <TraqsLockup size={17} color={STONE} stroke={0.3} bars={false} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, textAlign: "center", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: ".08em", color: "#B4B0A7" }}>
            Org code: {orgCode} · Secured by Auth0
          </div>
        </div>
      </div>

      {/* Lower-right toggle: switch between the roster sign-in and the clock-in/out kiosk */}
      <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 50, display: "flex", gap: 4, padding: 4, background: "#fff", border: "1px solid rgba(16,24,40,.1)", borderRadius: 999, boxShadow: "0 8px 24px rgba(16,24,40,.14)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        {[["login", "Log In"], ["clock", "Clock In"]].map(([key, label]) => {
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 999, color: active ? "#fff" : STONE, background: active ? LOGIN_BLUE : "transparent", boxShadow: active ? `0 4px 14px ${LOGIN_BLUE}55` : "none", transition: "all 0.18s" }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {clockMode && (() => {
        const meta = CLOCK_MODE_META[clockMode] || CLOCK_MODE_META.clockIn;
        const doneMeta = CLOCK_MODE_META[completedAction] || meta;
        const isClockIn = clockMode === "clockIn";
        const yesGradient = isClockIn
          ? "linear-gradient(135deg, #10b981, #059669)"
          : "linear-gradient(135deg, #ef4444, #dc2626)";
        const yesShadow = isClockIn
          ? "0 4px 20px rgba(16,185,129,0.33)"
          : "0 4px 20px rgba(239,68,68,0.33)";
        return (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'DM Sans', system-ui, sans-serif" }}
          onClick={closeClockModal}
        >
          <div style={{ ...CARD, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <LogoHeader subtitle={meta.title} />
            <div style={CARD_BODY}>
              {clockDone ? (
                <div style={{ textAlign: "center" }}>
                  <div style={SUCCESS_BOX}>{`✓ ${doneMeta.successMsg}`}</div>
                  <BtnPrimary type="button" onClick={closeClockModal}>Done</BtnPrimary>
                </div>
              ) : confirmedPerson ? (() => {
                // Derive lunch state from the latest lunchStart/lunchEnd in active events.
                const events = confirmedPerson.activeClockIn?.events || [];
                const lastLunch = [...events].reverse().find(e => e.type === "lunchStart" || e.type === "lunchEnd");
                const onLunch = !!confirmedPerson.activeClockIn && lastLunch?.type === "lunchStart";
                // Clock In + on lunch → offer "Back from lunch" instead of starting a fresh shift.
                if (clockMode === "clockIn" && onLunch) {
                  return (
                    <div>
                      {pinError && <div style={ERR_BOX}>{pinError}</div>}
                      <p style={{ fontSize: 14, color: "#64748b", marginBottom: 8, textAlign: "center", lineHeight: 1.6 }}>
                        <strong style={{ color: "#0f172a", fontSize: 17 }}>{confirmedPerson.name.toUpperCase()}</strong> is currently on lunch.
                      </p>
                      <button
                        type="button"
                        disabled={pinLoading}
                        onClick={() => handleClockYes("lunchEnd")}
                        style={{ width: "100%", padding: "14px 16px", marginTop: 16, background: "linear-gradient(135deg, #10b981, #059669)", border: "none", borderRadius: 10, color: "#fff", cursor: pinLoading ? "default" : "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(16,185,129,0.32)", opacity: pinLoading ? 0.7 : 1 }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>← Back From Lunch</div>
                        <div style={{ fontSize: 12, opacity: 0.92, marginTop: 3 }}>Resume work for the day</div>
                      </button>
                      <div style={{ textAlign: "center", marginTop: 14 }}>
                        <button type="button" style={LINK_BTN} onClick={() => { setConfirmedPerson(null); setPinValue(""); setPinError(""); }}>Back</button>
                      </div>
                    </div>
                  );
                }
                // Clock Out — choose Lunch (coming back) or End of Day.
                if (clockMode === "clockOut") {
                  return (
                    <div>
                      {pinError && <div style={ERR_BOX}>{pinError}</div>}
                      <p style={{ fontSize: 14, color: "#64748b", marginBottom: 8, textAlign: "center", lineHeight: 1.6 }}>
                        <strong style={{ color: "#0f172a", fontSize: 17 }}>{confirmedPerson.name.toUpperCase()}</strong>, what are you clocking out for?
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
                        <button
                          type="button"
                          disabled={pinLoading}
                          onClick={() => handleClockYes("lunchStart")}
                          style={{ padding: "14px 16px", background: "linear-gradient(135deg, #f59e0b, #d97706)", border: "none", borderRadius: 10, color: "#fff", cursor: pinLoading ? "default" : "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(245,158,11,0.32)", textAlign: "left", opacity: pinLoading ? 0.7 : 1 }}
                        >
                          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>🍽  Lunch</div>
                          <div style={{ fontSize: 12, opacity: 0.92, marginTop: 3 }}>Clock out — coming back later</div>
                        </button>
                        <button
                          type="button"
                          disabled={pinLoading}
                          onClick={() => handleClockYes("clockOut")}
                          style={{ padding: "14px 16px", background: "linear-gradient(135deg, #ef4444, #dc2626)", border: "none", borderRadius: 10, color: "#fff", cursor: pinLoading ? "default" : "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(239,68,68,0.32)", textAlign: "left", opacity: pinLoading ? 0.7 : 1 }}
                        >
                          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>👋  End of Day</div>
                          <div style={{ fontSize: 12, opacity: 0.92, marginTop: 3 }}>Done for the day</div>
                        </button>
                      </div>
                      <div style={{ textAlign: "center", marginTop: 14 }}>
                        <button type="button" style={LINK_BTN} onClick={() => { setConfirmedPerson(null); setPinValue(""); setPinError(""); }}>Back</button>
                      </div>
                    </div>
                  );
                }
                // Default Clock In confirmation.
                return (
                  <div>
                    {pinError && <div style={ERR_BOX}>{pinError}</div>}
                    <p style={{ fontSize: 14, color: "#64748b", marginBottom: 8, textAlign: "center", lineHeight: 1.6 }}>
                      Is <strong style={{ color: "#0f172a", fontSize: 17 }}>{confirmedPerson.name.toUpperCase()}</strong> going <strong style={{ color: meta.verbColor }}>{meta.verb}</strong>?
                    </p>
                    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                      <button
                        type="button"
                        onClick={() => { setConfirmedPerson(null); setPinValue(""); setPinError(""); }}
                        style={{ flex: 1, padding: "13px 0", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, color: "#64748b", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                      >No</button>
                      <BtnPrimary
                        type="button"
                        loading={pinLoading}
                        loadingLabel="Saving…"
                        onClick={() => handleClockYes()}
                        style={{ flex: 1, background: yesGradient, boxShadow: yesShadow }}
                      >Yes</BtnPrimary>
                    </div>
                  </div>
                );
              })() : (
                <>
                  {pinError && <div style={ERR_BOX}>{pinError}</div>}
                  <div style={{ marginBottom: 20 }}>
                    <label style={LABEL}>Enter your PIN</label>
                    <input
                      type="password"
                      value={pinValue}
                      onChange={e => { setPinValue(e.target.value); setPinError(""); }}
                      onKeyDown={e => e.key === "Enter" && handlePinConfirm()}
                      placeholder="PIN"
                      autoFocus
                      autoComplete="off"
                      style={{ ...INPUT_STYLE, letterSpacing: "0.25em", fontSize: 18 }}
                    />
                  </div>
                  <BtnPrimary type="button" loading={pinLoading} loadingLabel="Checking…" onClick={handlePinConfirm}>Confirm</BtnPrimary>
                  <div style={{ textAlign: "center", marginTop: 12 }}>
                    <button type="button" style={LINK_BTN} onClick={closeClockModal}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}

// ─── Not-in-team error ────────────────────────────────────────────────────────
function NotInTeamError({ userEmail, onLogout }) {
  return (
    <div style={PAGE}>
      <div style={CARD}>
        <LogoHeader subtitle="Access Denied" />
        <div style={CARD_BODY}>
          <div style={{ ...ERR_BOX, marginBottom: 0 }}>
            <strong>Not in team roster</strong>
            <p style={{ margin: "6px 0 0" }}>
              Your account <strong>{userEmail}</strong> is not in the team roster.<br />
              Contact your organization admin to be added.
            </p>
          </div>
          <BtnPrimary
            type="button"
            onClick={onLogout}
            style={{ marginTop: 20, background: "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: "0 4px 20px rgba(239,68,68,0.33)" }}
          >
            Sign Out
          </BtnPrimary>
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
      </div>
    </div>
  );
}

// ─── Wrong user error ─────────────────────────────────────────────────────────
function WrongUserError({ loggedInEmail, selectedName, selectedEmail, onLogout }) {
  return (
    <div style={PAGE}>
      <div style={CARD}>
        <LogoHeader subtitle="Access Denied" />
        <div style={CARD_BODY}>
          <div style={{ ...ERR_BOX, marginBottom: 0 }}>
            <strong>Wrong account</strong>
            <p style={{ margin: "6px 0 0" }}>
              You selected <strong>{selectedName}</strong> but signed in as <strong>{loggedInEmail}</strong>.<br />
              Please sign in with <strong>{selectedEmail}</strong>.
            </p>
          </div>
          <BtnPrimary
            type="button"
            onClick={onLogout}
            style={{ marginTop: 20, background: "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: "0 4px 20px rgba(239,68,68,0.33)" }}
          >
            Sign Out &amp; Try Again
          </BtnPrimary>
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
      </div>
    </div>
  );
}

// ─── Auth gate with multi-tenant org flow ─────────────────────────────────────
function AuthGate() {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();

  // "org" | "create-org" | "forgot-org" | "team" | "domain-error" | "not-in-team"
  const [step, setStep] = useState(() => {
    return persist.getItem(LS_CODE) ? "team" : "org";
  });
  const [orgCode, setOrgCode] = useState(() => persist.getItem(LS_CODE) || "");
  const [orgConfig, setOrgConfig] = useState(() => {
    try { return JSON.parse(persist.getItem(LS_CONFIG) || "null"); } catch { return null; }
  });
  const [teamPeople, setTeamPeople] = useState(() => {
    try { return JSON.parse(persist.getItem(LS_PEOPLE) || "[]"); } catch { return []; }
  });
  const [selectedPerson, setSelectedPerson] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
  });

  // On mount: re-fetch config + people from S3 (keeps data fresh)
  useEffect(() => {
    const savedCode = persist.getItem(LS_CODE);
    if (savedCode) {
      fetchOrgConfig(savedCode)
        .then(async cfg => {
          setOrgConfig(cfg);
          setOrgCode(savedCode);
          persist.setItem(LS_CONFIG, JSON.stringify(cfg));
          try {
            const people = await fetchPeople(null, savedCode);
            setTeamPeople(people);
            persist.setItem(LS_PEOPLE, JSON.stringify(people));
          } catch {
            // non-fatal: keep cached people
          }
          if (!isAuthenticated) setStep("team");
        })
        .catch((e) => {
          // Only clear the org code if the org truly doesn't exist (404).
          // For transient errors (network, 500), keep the code so the user
          // isn't forced to re-enter it on every blip.
          if (e?.status === 404) {
            persist.removeItem(LS_CODE);
            persist.removeItem(LS_CONFIG);
            persist.removeItem(LS_PEOPLE);
            setOrgCode("");
            setOrgConfig(null);
          }
          setStep("org");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After Auth0 returns: validate the selected person matches the logged-in
  // email, then check the email domain matches the org's configured domain.
  // These two checks need no server round-trip.
  useEffect(() => {
    if (!isAuthenticated || !user || !orgConfig) return;
    const saved = selectedPerson || (() => {
      try { return JSON.parse(sessionStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
    })();
    if (saved && user.email?.toLowerCase() !== saved.email?.toLowerCase()) {
      setStep("wrong-user");
      return;
    }
    const emailDomain = user.email?.split("@")[1]?.toLowerCase();
    if (emailDomain !== orgConfig.domain?.toLowerCase()) {
      setStep("domain-error");
    }
  }, [isAuthenticated, user, orgConfig?.domain, selectedPerson]);

  // Authenticated server check: who is this user vis-à-vis this org? The
  // /org-config endpoint requires `requireOrgMember`, so a 200 here means
  // either we're in the roster or our email equals the org's adminEmail —
  // the server knows; the client doesn't have to compare emails locally.
  // Runs once per (isAuthenticated, orgCode) pair to avoid hitting the
  // endpoint on every teamPeople poll.
  useEffect(() => {
    if (!isAuthenticated || !orgCode) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(`/.netlify/functions/org-config`, {
          headers: { Authorization: `Bearer ${token}`, "X-Org-Code": orgCode },
        });
        if (cancelled) return;
        if (res.status === 403 || res.status === 404) {
          setStep("not-in-team");
          return;
        }
        if (!res.ok) return;
        const fullConfig = await res.json();
        setOrgConfig(prev => ({ ...(prev || {}), ...fullConfig }));
      } catch {
        // Network or Auth0 hiccup — leave the user where they are; downstream
        // API calls will surface a clearer error if it's persistent.
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, orgCode, getAccessTokenSilently]);

  // Roster membership re-check: triggers whenever the team roster refreshes
  // (kiosk poll, post-login fetch, admin adds someone). Uses the server-set
  // `isAdmin` flag from /org-config — falls back to true while we wait for
  // that fetch so we don't briefly flash "not in team" right after login.
  useEffect(() => {
    if (!isAuthenticated || !user || !orgConfig) return;
    const roster = teamPeople.length > 0 ? teamPeople : (() => {
      try { return JSON.parse(persist.getItem(LS_PEOPLE) || "[]"); } catch { return []; }
    })();
    const inRoster = roster.some(p => p.email?.toLowerCase() === user.email?.toLowerCase());
    const rosterIsEmpty = roster.length === 0;
    // `isAdmin` is set by /org-config; while it's undefined we treat the
    // user as potentially-admin so the UI doesn't flicker.
    const isAdminUnknownYet = !("isAdmin" in (orgConfig || {}));
    const isAdmin = orgConfig.isAdmin === true || isAdminUnknownYet;
    if (!inRoster && !isAdmin && !rosterIsEmpty) {
      setStep("not-in-team");
    }
  }, [isAuthenticated, user, orgConfig, teamPeople]);

  function handleOrgResolved(code, config) {
    setOrgCode(code);
    setOrgConfig(config);
    fetchPeople(null, code)
      .then(people => {
        setTeamPeople(people);
        persist.setItem(LS_PEOPLE, JSON.stringify(people));
      })
      .catch(() => {});
    setStep("team");
  }

  // Pull the latest people roster — used by polling and by the kiosk clock flow to
  // refresh the status pills the moment someone clocks in/out/lunches.
  const refreshTeamPeople = useCallback(() => {
    if (!orgCode) return Promise.resolve();
    return fetchPeople(null, orgCode)
      .then(people => {
        setTeamPeople(people);
        persist.setItem(LS_PEOPLE, JSON.stringify(people));
      })
      .catch(() => {});
  }, [orgCode]);

  // While the team-select kiosk is on screen, refresh every 5s so status pills (Online,
  // Lunch, Break, Offline) reflect what's happening on other workers' devices in near real-time.
  useEffect(() => {
    if (isAuthenticated) return;
    if (step !== "team") return;
    if (!orgCode) return;
    const iv = setInterval(() => { refreshTeamPeople(); }, 5000);
    return () => clearInterval(iv);
  }, [isAuthenticated, step, orgCode, refreshTeamPeople]);

  function handlePersonSelect(person) {
    setSelectedPerson(person);
    sessionStorage.setItem("tq_selected_person", JSON.stringify(person));
    loginWithRedirect({
      authorizationParams: {
        login_hint: person.email,
        ...(orgConfig?.connection ? { connection: orgConfig.connection } : {}),
      },
    });
  }

  function handleAdminLogin() {
    loginWithRedirect(
      orgConfig?.connection
        ? { authorizationParams: { connection: orgConfig.connection } }
        : undefined
    );
  }

  function handleSwitch() {
    persist.removeItem(LS_CODE);
    persist.removeItem(LS_CONFIG);
    persist.removeItem(LS_PEOPLE);
    sessionStorage.removeItem("tq_selected_person");
    setOrgCode("");
    setOrgConfig(null);
    setTeamPeople([]);
    setSelectedPerson(null);
    setStep("org");
    if (isAuthenticated) {
      logout({ logoutParams: { returnTo: window.location.origin } });
    }
  }

  function handleDomainLogout() {
    persist.removeItem(LS_CODE);
    persist.removeItem(LS_CONFIG);
    persist.removeItem(LS_PEOPLE);
    sessionStorage.removeItem("tq_selected_person");
    setOrgCode("");
    setOrgConfig(null);
    setTeamPeople([]);
    setSelectedPerson(null);
    setStep("org");
    logout({ logoutParams: { returnTo: window.location.origin } });
  }

  if (isLoading) return <Spinner label="Loading TRAQS…" />;

  if (!isAuthenticated) {
    if (step === "org" || !orgCode || !orgConfig) {
      return (
        <OrgCodeStep
          onContinue={handleOrgResolved}
          onCreateOrg={() => setStep("create-org")}
          onForgot={() => setStep("forgot-org")}
        />
      );
    }
    if (step === "create-org") {
      return <CreateOrgStep onSuccess={handleOrgResolved} onBack={() => setStep("org")} />;
    }
    if (step === "forgot-org") {
      return <ForgotOrgStep onBack={() => setStep("org")} />;
    }
    // step === "team" (or "login" as legacy fallback)
    return (
      <TeamSelectStep
        orgCode={orgCode}
        orgConfig={orgConfig}
        teamPeople={teamPeople}
        onSelectPerson={handlePersonSelect}
        onAdminLogin={handleAdminLogin}
        onSwitch={handleSwitch}
        onRefresh={refreshTeamPeople}
      />
    );
  }

  if (step === "wrong-user") {
    const saved = selectedPerson || (() => {
      try { return JSON.parse(sessionStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
    })();
    return (
      <WrongUserError
        loggedInEmail={user.email}
        selectedName={saved?.name || "that user"}
        selectedEmail={saved?.email || "their email"}
        onLogout={handleDomainLogout}
      />
    );
  }

  if (step === "domain-error") {
    return (
      <DomainError
        userEmail={user.email}
        orgDomain={orgConfig?.domain}
        onLogout={handleDomainLogout}
      />
    );
  }

  if (step === "not-in-team") {
    return (
      <NotInTeamError
        userEmail={user.email}
        onLogout={handleDomainLogout}
      />
    );
  }

  // If authenticated but org code is missing, go back to org step
  if (!orgCode || step === "create-org" || step === "forgot-org") {
    if (step === "create-org") {
      return <CreateOrgStep onSuccess={handleOrgResolved} onBack={() => setStep("org")} />;
    }
    if (step === "forgot-org") {
      return <ForgotOrgStep onBack={() => setStep("org")} />;
    }
    return (
      <OrgCodeStep
        onContinue={handleOrgResolved}
        onCreateOrg={() => setStep("create-org")}
        onForgot={() => setStep("forgot-org")}
      />
    );
  }

  // Wrap getAccessTokenSilently so a dead/expired refresh token redirects the
  // user back through Auth0 login instead of leaving them stuck on "Unsaved".
  const safeGetToken = async (opts) => {
    try {
      return await getAccessTokenSilently(opts);
    } catch (e) {
      const msg = String(e?.error_description || e?.message || e || "");
      const code = e?.error || "";
      // A dead/rotated refresh token (403 on /oauth/token) or a failed prompt=none silent
      // auth (400 on /authorize) means the session can't be renewed and the API is
      // unreachable. Treat all of these as fatal and send the user through a full
      // interactive login to recover — guarded by a timestamp so a login that itself keeps
      // failing doesn't put us in a redirect loop.
      const fatal = code === "login_required" || code === "consent_required" || code === "invalid_grant"
        || code === "missing_refresh_token" || code === "access_denied"
        || /refresh token|forbidden|403|invalid_grant|login required/i.test(msg);
      if (fatal) {
        const last = Number(sessionStorage.getItem("tq_reauth_at") || 0);
        if (Date.now() - last > 15000) {
          sessionStorage.setItem("tq_reauth_at", String(Date.now()));
          try { await loginWithRedirect({ appState: { returnTo: window.location.pathname } }); } catch {}
        }
      }
      throw e;
    }
  };

  return (
    <ErrorBoundary>
      <TRAQS
        auth0User={user}
        getToken={safeGetToken}
        logout={logout}
        orgCode={orgCode}
        orgConfig={orgConfig}
      />
    </ErrorBoundary>
  );
}

export default function App() {
  return <AuthGate />;
}
