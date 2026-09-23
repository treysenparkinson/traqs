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

export function StepDots({ current }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 18 }}>
      {SIGNUP_STEPS.map((s) => (
        <div key={s.id} aria-hidden style={{
          width: s.id === current ? 22 : 7, height: 7, borderRadius: 4,
          background: s.id === current ? "#0a84ff" : "#d8d4cc",
          transition: "width 0.2s, background 0.2s",
        }} />
      ))}
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
      <Field label="Company Size" err={errors.companySize} S={S}>
        <select style={selectStyle(S)} value={form.companySize} onChange={(e) => set("companySize", e.target.value)}>
          <option value="">Select…</option>
          {COMPANY_SIZES.map((c) => <option key={c.value} value={c.value}>{c.label} people</option>)}
        </select>
      </Field>
      <Field label="Country" err={errors.country} S={S}>
        <input style={S.INPUT_STYLE} type="text" placeholder="United States"
          value={form.country} onChange={(e) => set("country", e.target.value)} autoComplete="country-name" />
      </Field>
      <Field label="Time Zone" hint="Schedules and pay periods are calculated in this zone."
        err={errors.timeZone} S={S}>
        <input style={S.INPUT_STYLE} type="text" placeholder="America/Denver"
          value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Currency" err={errors.currency} S={S}>
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
      <Field label="Pay Period" err={errors.payPeriodType} S={S}>
        <select style={selectStyle(S)} value={form.payPeriodType}
          onChange={(e) => set("payPeriodType", e.target.value)}>
          {PAY_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </Field>
      {/* A DATE, not a weekday. Every period boundary is counted forward from
          this anchor, so a day name would leave nothing to count from. */}
      <Field label="First Pay Period Starts"
        hint="Later periods are counted forward from this date."
        err={errors.payPeriodStart} S={S}>
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
      <Section title="Organization" onEdit={() => goTo("basics")} S={S}>
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
