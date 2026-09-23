// The signup wizard's screens. The RULES live in orgSignup.js — this file is a
// rendering of them, so a change to what is required happens in one place and
// is testable without rendering anything.
//
// Styles come in as props rather than being imported: they are module-level
// consts in App.jsx, and exporting them just to reach them here would widen
// that module's surface for no gain.

import { useState, useEffect, useRef } from "react";
import {
  SIGNUP_STEPS, PAY_PERIODS, COMPANY_SIZES, CURRENCIES, INDUSTRIES,
  validateStep,
} from "./orgSignup.js";
import { BASIC_FEATURES, BUSINESS_FEATURES } from "./tiers.js";

// A guess, offered so nobody has to know their IANA zone name. Editable.
export const guessTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};


// Tokens lifted from TRAQS Onboarding Wireframes.html. Scoped to the wizard's
// card rather than applied globally: the welcome and login screens are tagged
// “existing screen” in that document and restyling the whole auth flow is a
// bigger decision than implementing these steps.
const INK = "#141414";
const MUTED = "#8a8a86";
const HAIR = "#d7d3c9";
// One typeface, same rule as everywhere else -- see the note on FONT in
// App.jsx. What was here is not loaded by index.html, so the step counter and
// the tier badge rendered in a system face while the card two lines above them
// was DM Sans. Kept as a named constant rather than inherit, so the next person
// can see there is a rule being followed.
const FONT = "'DM Sans', system-ui, sans-serif";

// A selectable pill. The wireframe uses these for company size and pay period
// rather than dropdowns — every option stays visible, which is the point when
// there are only four.
function Pill({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="tq-noanim" aria-pressed={on}
      style={{
        flex: 1, padding: "9px 0", borderRadius: 999, cursor: "pointer",
        border: `1.5px solid ${on ? INK : HAIR}`,
        background: on ? INK : "#fff", color: on ? "#fff" : INK,
        fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: "inherit",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
      }}>{children}</button>
  );
}

function PillRow({ children }) {
  return <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>{children}</div>;
}
// STEP n OF m, then the dots — below the card, which is where the wireframe
// draws them. They were inside the card, above the fields, competing with the
// heading for the first thing you read.
export function StepDots({ current }) {
  const i = SIGNUP_STEPS.findIndex((s) => s.id === current);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18 }}>
      <div style={{
        fontFamily: FONT, fontSize: 10, letterSpacing: "0.2em", color: MUTED,
        textTransform: "uppercase",
      }}>
        {`Step ${i + 1} of ${SIGNUP_STEPS.length}`}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {SIGNUP_STEPS.map((s, j) => (
          <div key={s.id} aria-hidden style={{
            width: 7, height: 7, borderRadius: "50%",
            background: j <= i ? INK : HAIR,
            transition: "background 0.22s ease",
          }} />
        ))}
      </div>
    </div>
  );
}


// TRAQS-NATIVE DROPDOWN. A bare <select> hands the list to the operating
// system, which draws its own grey widget — on Windows that is visibly not
// this design. The trigger is styled as the paper input beside it and the
// panel is ours.
function PaperSelect({ value, onChange, options, placeholder = "Select…", S }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="tq-noanim" onClick={() => setOpen((o) => !o)}
        style={{
          ...S.INPUT_STYLE, textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          color: current ? undefined : MUTED,
        }}>
        <span>{current ? current.label : placeholder}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .16s ease" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40,
          background: "#fff", border: "1px solid rgba(16,24,40,.12)", borderRadius: 14,
          boxShadow: "0 18px 40px rgba(16,24,40,.16)", padding: 6, maxHeight: 230, overflowY: "auto",
        }}>
          {options.map((o) => (
            <button key={o.value} type="button" className="tq-noanim"
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 11px",
                borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                background: o.value === value ? INK : "transparent",
                color: o.value === value ? "#fff" : INK,
              }}
              onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = "rgba(16,24,40,.05)"; }}
              onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = "transparent"; }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// One labelled control. `err` is shown under the field rather than in a banner
// so it sits next to what it is about.
function Field({ label, hint, err, children, S }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={S.LABEL}>{label}</label>
      {children}
      {err
        ? <div style={{ ...S.HINT, color: "#c0392b" }}>{err}</div>
        : hint ? <div style={S.HINT}>{hint}</div> : null}
    </div>
  );
}


export function IdentityStep({ form, set, errors, S }) {
  const extras = form.extraAdmins || [];
  const setExtra = (i, v) => set("extraAdmins", extras.map((a, j) => (j === i ? v : a)));
  return (
    <>
      <Field label="Organization Name" err={errors.name} S={S}>
        <input style={S.INPUT_STYLE} type="text" placeholder="Acme Fabrication" autoFocus
          value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="organization" />
      </Field>
      <Field label="Your Name" err={errors.adminName} S={S}>
        <input style={S.INPUT_STYLE} type="text" placeholder="Dana Reyes"
          value={form.adminName} onChange={(e) => set("adminName", e.target.value)} autoComplete="name" />
      </Field>
      <Field label="Your Email" err={errors.adminEmail} S={S}>
        <input style={S.INPUT_STYLE} type="email" placeholder="dana@acmefab.com"
          value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} autoComplete="email" />
      </Field>

      <div style={{ marginBottom: 14 }}>
        <label style={S.LABEL}>Other Administrators</label>
        {extras.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={{ ...S.INPUT_STYLE, flex: 1 }} type="email" placeholder="sam@acmefab.com"
              value={a} onChange={(e) => setExtra(i, e.target.value)} autoComplete="off" />
            <button type="button" className="tq-noanim"
              onClick={() => set("extraAdmins", extras.filter((_, j) => j !== i))}
              style={{ ...S.LINK_BTN, padding: "0 10px" }} aria-label="Remove administrator">Remove</button>
          </div>
        ))}
        {errors.extraAdmins && <div style={{ ...S.HINT, color: "#c0392b" }}>{errors.extraAdmins}</div>}
        {/* A full-width outlined control rather than a text link. As a link it sat
            at body-copy size against a column of large inputs and read as a
            footnote, which is the opposite of an action. */}
        <button type="button" className="tq-noanim"
          onClick={() => set("extraAdmins", [...extras, ""])}
          style={{
            width: "100%", padding: "12px 0", marginTop: 2,
            background: "transparent", border: `1.5px dashed rgba(16,24,40,.22)`,
            borderRadius: 999, color: INK, fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>
          + Add administrator
        </button>
      </div>
    </>
  );
}

export function BasicsStep({ form, set, errors, S }) {
  return (
    <>
      <Field label="Industry" err={errors.industry} S={S}>
        <PaperSelect value={form.industry} onChange={(v) => set("industry", v)}
          options={INDUSTRIES.map((i) => ({ value: i, label: i }))} S={S} />
      </Field>
      {/* Pills, not a dropdown: four options, and the wireframe keeps them all
          visible so the range being chosen is legible without opening anything. */}
      <Field label="Company Size" err={errors.companySize} S={S}>
        <PillRow>
          {COMPANY_SIZES.map((c) => (
            <Pill key={c.value} on={form.companySize === c.value}
              onClick={() => set("companySize", c.value)}>{c.label}</Pill>
          ))}
        </PillRow>
      </Field>
      {/* Country and time zone share a row, as drawn. */}
      <Field label="Country / time zone" err={errors.country || errors.timeZone} S={S}>
        <div style={{ display: "flex", gap: 10 }}>
          <input style={{ ...S.INPUT_STYLE, flex: 1 }} type="text" placeholder="United States"
            value={form.country} onChange={(e) => set("country", e.target.value)} autoComplete="country-name" />
          <input style={{ ...S.INPUT_STYLE, flex: 1 }} type="text" placeholder="America/Denver"
            value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} autoComplete="off" />
        </div>
      </Field>
      <Field label="Currency" err={errors.currency} S={S}>
        <PaperSelect value={form.currency} onChange={(v) => set("currency", v)}
          options={CURRENCIES} S={S} />
      </Field>
    </>
  );
}

export function PayrollStep({ form, set, errors, S }) {
  return (
    <>
      {/* Two rows of two, as the wireframe lays them out — four periods on one
          line would leave each pill too narrow to read its own label. */}
      <Field label="Pay Period" err={errors.payPeriodType} S={S}>
        <PillRow>
          {PAY_PERIODS.slice(0, 2).map((p) => (
            <Pill key={p.value} on={form.payPeriodType === p.value}
              onClick={() => set("payPeriodType", p.value)}>{p.label}</Pill>
          ))}
        </PillRow>
        <PillRow>
          {PAY_PERIODS.slice(2).map((p) => (
            <Pill key={p.value} on={form.payPeriodType === p.value}
              onClick={() => set("payPeriodType", p.value)}>{p.label}</Pill>
          ))}
        </PillRow>
      </Field>
      {/* A DATE, not a weekday. Every period boundary is counted forward from
          this anchor, so a day name would leave nothing to count from. */}
      <Field label="First Pay Period Starts" err={errors.payPeriodStart} S={S}>
        <input style={S.INPUT_STYLE} type="date"
          value={form.payPeriodStart} onChange={(e) => set("payPeriodStart", e.target.value)} />
      </Field>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: "#8a8378" }}>{label}</span>
      <span style={{ color: "#2b2926", fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>
        {value || "—"}
      </span>
    </div>
  );
}

function Section({ title, onEdit, children, S }) {
  return (
    <div style={{ border: "1px solid #e6e1d8", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8a8378" }}>
          {title}
        </div>
        <button type="button" className="tq-noanim" style={{ ...S.LINK_BTN, fontSize: 12 }} onClick={onEdit}>Edit</button>
      </div>
      {children}
    </div>
  );
}

export function ConfirmStep({ form, goTo, errors, S }) {
  const inviteCount = (form.extraAdmins || []).map((a) => (a || "").trim())
    .filter(Boolean).filter((a) => a.toLowerCase() !== (form.adminEmail || "").trim().toLowerCase()).length;
  const period = PAY_PERIODS.find((p) => p.value === form.payPeriodType);
  const size = COMPANY_SIZES.find((c) => c.value === form.companySize);
  const extras = (form.extraAdmins || []).map((a) => a.trim()).filter(Boolean);
  const bad = Object.keys(errors).length > 0;
  return (
    <>
      {bad && (
        <div style={S.ERR_BOX}>
          Something above needs attention before this can be activated. Use Edit to go back.
        </div>
      )}
      <Section title="Identity" onEdit={() => goTo("identity")} S={S}>
        <Row label="Organization" value={form.name} />
        <Row label="Administrator" value={form.adminName} />
        <Row label="Email" value={form.adminEmail} />
        <Row label="Other admins" value={extras.length ? extras.join(", ") : "None"} />
      </Section>
      <Section title="Organization basics" onEdit={() => goTo("basics")} S={S}>
        <Row label="Industry" value={form.industry} />
        <Row label="Size" value={size ? `${size.label} people` : ""} />
        <Row label="Country" value={form.country} />
        <Row label="Time zone" value={form.timeZone} />
        <Row label="Currency" value={form.currency} />
      </Section>
      <Section title="Tier" onEdit={() => goTo("tier")} S={S}>
        <Row label="Plan" value={form.tier === "business" ? "Business" : "Basic"} />
      </Section>
      <Section title="Payroll" onEdit={() => goTo("payroll")} S={S}>
        <Row label="Pay period" value={period?.label} />
        <Row label="First period starts" value={form.payPeriodStart} />
      </Section>
      {/* Invites are sent after the org exists — there is nothing to attach them
          to until it does — so this states what will happen rather than doing it. */}
      <div style={{
        border: `1.5px solid ${INK}`, borderRadius: 999, padding: "11px 0",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: 13, fontWeight: 700, color: INK, marginTop: 14,
      }}>
        {/* Drawn, not a character. The envelope glyph renders as a colour emoji
            on some platforms and as a hairline outline on others, and neither
            matches the weight of the text beside it. */}
        <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden="true">
          <rect x="0.75" y="0.75" width="12.5" height="9.5" rx="1.5"
            fill="none" stroke={INK} strokeWidth="1.3" />
          <path d="M1 1.6 L7 6 L13 1.6" fill="none" stroke={INK}
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{inviteCount > 0
          ? `${inviteCount} invite${inviteCount === 1 ? "" : "s"} will be sent`
          : "No invites to send"}</span>
      </div>
      <div style={{ ...S.HINT, textAlign: "center", marginTop: 6 }}>
        Invites auto-create employee TRAQS accounts on accept.
      </div>
    </>
  );
}

// Shown once the org exists. The code is generated server-side and this is the
// only place it is presented, so it is made hard to miss and easy to copy.
export function ActivatedScreen({ code, orgName, onContinue, S }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked — the code is on screen to read */ }
  };
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#2b2926", marginBottom: 4 }}>
        {orgName} is live
      </div>
      <div style={{ fontSize: 13, color: "#8a8378", marginBottom: 18 }}>
        This is your organization code. Your team enters it to sign in.
      </div>
      <div style={{
        // The org code in the same face as everything else. A fixed-width face
        // here would be for telling characters apart, and the code alphabet
        // already does that job -- it contains no 0, O, 1, I or L. The
        // letterspacing is what makes it read as something to transcribe.
        fontFamily: FONT,
        fontSize: 22, fontWeight: 700, letterSpacing: "0.1em", color: "#2b2926",
        background: "#fff", border: "1.5px solid #0a84ff", borderRadius: 12,
        padding: "14px 10px", marginBottom: 10, userSelect: "all", wordBreak: "break-all",
      }}>{code}</div>
      <button type="button" className="tq-noanim" style={{ ...S.LINK_BTN, marginBottom: 18 }} onClick={copy}>
        {copied ? "Copied" : "Copy code"}
      </button>
      <div style={{ ...S.HINT, marginBottom: 18 }}>
        Write it down now. You can always find it again from the sign-in screen.
      </div>
      <button type="button" onClick={onContinue} style={{
        width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
        background: "#0a84ff", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
      }}>Continue to sign in</button>
    </div>
  );
}

export { validateStep, SIGNUP_STEPS };

// ---------------------------------------------------------------------------
// Tier.
//
// BUSINESS IS SHOWN BUT NOT SELECTABLE. It is drawn at full fidelity, dimmed,
// because the point of this screen is the comparison — a screen with one option
// on it is not a choice and does not explain what Basic is missing. The card is
// inert rather than absent so nothing has to be re-laid-out when it opens up.
//
// The feature lists are the ones in tiers.js, which are the same lists the
// Settings upgrade modal shows. One inventory, checked against the codebase,
// used in both places — a comparison table is a promise, and two copies of it
// drift.
function Check({ dim }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
      style={{ flex: "0 0 auto", marginTop: 3 }}>
      <path d="M2 6.4 L4.6 9 L10 3.2" fill="none" stroke={dim ? "#b4b0a6" : INK}
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TierCard({ name, price, note, features, on, disabled, badge, onClick }) {
  return (
    <button type="button" className="tq-noanim" onClick={disabled ? undefined : onClick}
      disabled={disabled} aria-pressed={on} aria-disabled={disabled || undefined}
      style={{
        display: "block", width: "100%", textAlign: "left", marginBottom: 10,
        padding: "13px 15px", borderRadius: 14, fontFamily: "inherit",
        border: `1.5px solid ${on ? INK : HAIR}`,
        background: disabled ? "#faf9f6" : "#fff",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.62 : 1,
        transition: "border-color 0.12s, background 0.12s",
      }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: disabled ? "#6f6b62" : INK }}>{name}</span>
        {badge
          ? <span style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
              color: MUTED, border: `1px solid ${HAIR}`, borderRadius: 999, padding: "2px 7px",
            }}>{badge}</span>
          : <span style={{ fontFamily: FONT, fontSize: 11, color: MUTED }}>{price}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{note}</div>
      <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
        {features.map((f) => (
          <div key={f} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.35,
            color: disabled ? "#7c786f" : "#2b2926" }}>
            <Check dim={disabled} />
            <span>{f}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

export function TierStep({ form, set, errors, S }) {
  return (
    <>
      <TierCard
        name="Basic" price="Included" note="Everything you need to run a crew."
        features={BASIC_FEATURES}
        on={form.tier === "basic"} onClick={() => set("tier", "basic")} />
      <TierCard
        name="Business" badge="Coming soon"
        note="Everything in Basic, plus:"
        features={BUSINESS_FEATURES}
        on={false} disabled />
      {errors.tier && <div style={S.ERR_BOX}>{errors.tier}</div>}
      <div style={{ fontSize: 11.5, color: MUTED, textAlign: "center", marginTop: 4 }}>
        You can move to Business later without starting over.
      </div>
    </>
  );
}
