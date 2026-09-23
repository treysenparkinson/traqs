// The signup wizard's screens. The RULES live in orgSignup.js — this file is a
// rendering of them, so a change to what is required happens in one place and
// is testable without rendering anything.
//
// Styles come in as props rather than being imported: they are module-level
// consts in App.jsx, and exporting them just to reach them here would widen
// that module's surface for no gain.

import { useState } from "react";
import {
  SIGNUP_STEPS, PAY_PERIODS, COMPANY_SIZES, CURRENCIES, INDUSTRIES,
  validateStep,
} from "./orgSignup.js";

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
const MONO = "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

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
export function StepDots({ current }) {
  const i = SIGNUP_STEPS.findIndex((s) => s.id === current);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: MUTED, textTransform: "uppercase" }}>
        {`Step ${i + 1} of ${SIGNUP_STEPS.length}`}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {SIGNUP_STEPS.map((s, j) => (
          <div key={s.id} aria-hidden style={{
            width: 7, height: 7, borderRadius: "50%",
            background: j <= i ? INK : HAIR, transition: "background 0.2s",
          }} />
        ))}
      </div>
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

const selectStyle = (S) => ({ ...S.INPUT_STYLE, appearance: "none", cursor: "pointer" });

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
      <Field label="Email Domain" hint="Only people with this email domain can sign in."
        err={errors.domain} S={S}>
        <input style={S.INPUT_STYLE} type="text" placeholder="acmefab.com"
          value={form.domain} onChange={(e) => set("domain", e.target.value)} autoComplete="off" />
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
        <button type="button" className="tq-noanim" style={S.LINK_BTN}
          onClick={() => set("extraAdmins", [...extras, ""])}>+ Add administrator</button>
        <div style={S.HINT}>Each one is sent their own invite after the organization is created.</div>
      </div>
    </>
  );
}

export function BasicsStep({ form, set, errors, S }) {
  return (
    <>
      <Field label="Industry" err={errors.industry} S={S}>
        <select style={selectStyle(S)} value={form.industry} onChange={(e) => set("industry", e.target.value)}>
          <option value="">Select…</option>
          {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
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
      <Field label="Country / time zone" hint="Schedules and pay periods are calculated in this zone."
        err={errors.country || errors.timeZone} S={S}>
        <div style={{ display: "flex", gap: 10 }}>
          <input style={{ ...S.INPUT_STYLE, flex: 1 }} type="text" placeholder="United States"
            value={form.country} onChange={(e) => set("country", e.target.value)} autoComplete="country-name" />
          <input style={{ ...S.INPUT_STYLE, flex: 1 }} type="text" placeholder="America/Denver"
            value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} autoComplete="off" />
        </div>
      </Field>
      <Field label="Currency · for HR export" err={errors.currency} S={S}>
        <select style={selectStyle(S)} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
          {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
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
      <Field label="First Pay Period Starts"
        hint="Later periods are counted forward from this date."
        err={errors.payPeriodStart} S={S}>
        <input style={S.INPUT_STYLE} type="date"
          value={form.payPeriodStart} onChange={(e) => set("payPeriodStart", e.target.value)} />
      </Field>
      <div style={{ ...S.HINT, marginTop: 10 }}>All of this can be changed later in Settings.</div>
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
        <Row label="Domain" value={form.domain} />
        <Row label="Other admins" value={extras.length ? extras.join(", ") : "None"} />
      </Section>
      <Section title="Organization basics" onEdit={() => goTo("basics")} S={S}>
        <Row label="Industry" value={form.industry} />
        <Row label="Size" value={size ? `${size.label} people` : ""} />
        <Row label="Country" value={form.country} />
        <Row label="Time zone" value={form.timeZone} />
        <Row label="Currency" value={form.currency} />
      </Section>
      <Section title="Payroll" onEdit={() => goTo("payroll")} S={S}>
        <Row label="Pay period" value={period?.label} />
        <Row label="First period starts" value={form.payPeriodStart} />
      </Section>
      {/* Invites are sent after the org exists — there is nothing to attach them
          to until it does — so this states what will happen rather than doing it. */}
      <div style={{
        border: `1.5px solid ${INK}`, borderRadius: 999, padding: "11px 0",
        textAlign: "center", fontSize: 13, fontWeight: 700, color: INK, marginTop: 14,
      }}>
        {inviteCount > 0
          ? `✉ ${inviteCount} invite${inviteCount === 1 ? "" : "s"} will be sent`
          : "✉ No invites to send"}
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
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 22, fontWeight: 700, letterSpacing: "0.06em", color: "#2b2926",
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
