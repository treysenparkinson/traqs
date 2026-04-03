import { useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import TRAQS from "./TRAQS.jsx";
import { TRAQS_LOGO_BLUE, TRAQS_LOGO_WHITE, UL_LOGO_WHITE } from "./logo.js";
import { fetchOrgConfig, createOrg, forgotOrgCode, fetchPeople } from "./api.js";

const LS_CODE = "tq_org_code";
const LS_CONFIG = "tq_org_config";
const LS_PEOPLE = "tq_team_people";

// ─── Shared styles ────────────────────────────────────────────────────────────
const PAGE = {
  minHeight: "100vh",
  background: "#0f172a",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

const CARD = {
  width: "100%",
  maxWidth: 420,
  background: "#1e293b",
  borderRadius: 20,
  border: "1px solid #334155",
  boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
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
  borderTop: "1px solid rgba(255,255,255,0.06)",
  fontSize: 11,
  color: "#475569",
};

const INPUT_STYLE = {
  width: "100%",
  padding: "12px 14px",
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 10,
  color: "#f1f5f9",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
};

const BTN = {
  width: "100%",
  padding: "13px 0",
  background: "linear-gradient(135deg, #4169e1, #4169e1cc)",
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
  color: "#475569",
  marginTop: 6,
};

function LogoHeader({ subtitle }) {
  return (
    <div style={CARD_HEADER}>
      <img src={UL_LOGO_WHITE} alt="TRAQS" style={{ height: 36, objectFit: "contain", marginBottom: 8 }} />
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
    <div style={{ ...PAGE, flexDirection: "column", color: "#f1f5f9" }}>
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
      localStorage.setItem(LS_CODE, trimmed);
      localStorage.setItem(LS_CONFIG, JSON.stringify(config));
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
      <div style={CARD}>
        <LogoHeader subtitle="Team Resource & Queue Scheduling" />
        <div style={CARD_BODY}>
          <form onSubmit={handleSubmit}>
            {error && <div style={ERR_BOX}>{error}</div>}
            <div style={{ marginBottom: 6 }}>
              <label style={LABEL}>Organization Code</label>
              <input
                style={INPUT_STYLE}
                type="text"
                placeholder="Enter your organization code"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                autoFocus
                autoComplete="off"
                maxLength={20}
              />
              <div style={HINT}>Contact your organization for the custom code.</div>
            </div>
            <div style={{ marginBottom: 20 }} />
            <BtnPrimary loading={loading} loadingLabel="Looking up…">Continue</BtnPrimary>
          </form>
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <button disabled style={{ ...LINK_BTN, color: "#475569", cursor: "not-allowed", textDecoration: "none" }}>
              New organizations coming soon
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button type="button" style={LINK_BTN} onClick={onForgot}>
              Forgot your org code?
            </button>
          </div>
        </div>
        <div style={CARD_FOOTER}>Secured by Auth0 · TRAQS</div>
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
      localStorage.setItem(LS_CODE, code);
      localStorage.setItem(LS_CONFIG, JSON.stringify(config));
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
function TeamSelectStep({ orgCode, orgConfig, teamPeople, onSelectPerson, onAdminLogin, onSwitch }) {
  const [clockMode, setClockMode] = useState(null); // null | "clockIn" | "clockOut"
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [confirmedPerson, setConfirmedPerson] = useState(null);
  const [clockDone, setClockDone] = useState(false);

  function openClock(mode) {
    setClockMode(mode);
    setPinValue("");
    setPinError("");
    setConfirmedPerson(null);
    setClockDone(false);
  }

  function closeClockModal() {
    setClockMode(null);
    setPinValue("");
    setPinError("");
    setConfirmedPerson(null);
    setClockDone(false);
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
        setConfirmedPerson({ name: data.name, personId: data.personId });
      }
    } catch {
      setPinError("Connection error. Please try again.");
    } finally {
      setPinLoading(false);
    }
  }

  async function handleClockYes() {
    setPinLoading(true);
    setPinError("");
    try {
      const action = clockMode === "clockIn" ? "clockIn" : "clockOut";
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
        setClockDone(true);
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
        <div style={{ ...CARD, maxWidth: 520 }}>
          <LogoHeader subtitle="Who are you?" />
          <div style={CARD_BODY}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "6px 16px", background: "rgba(65,105,225,0.12)",
                borderRadius: 20, border: "1px solid rgba(65,105,225,0.22)",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: "#10b981", boxShadow: "0 0 6px #10b98155" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#4169e1" }}>{orgConfig.name}</span>
              </div>
            </div>

            {teamPeople.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 14, color: "#64748b", marginBottom: 16 }}>No team members yet.</div>
                <BtnPrimary type="button" onClick={onAdminLogin}>Admin Login</BtnPrimary>
              </div>
            ) : (() => {
              const admins = teamPeople.filter(p => p.userRole === "admin");
              const employees = teamPeople.filter(p => p.userRole !== "admin");

              const PersonBtn = ({ person }) => (
                <button
                  type="button"
                  onClick={() => onSelectPerson(person)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#1a2744"; e.currentTarget.style.borderColor = "#4169e1"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#0f172a"; e.currentTarget.style.borderColor = "#334155"; }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: person.color || "#4169e1",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 14, fontWeight: 700, color: "#fff",
                    boxShadow: `0 0 12px ${person.color || "#4169e1"}55`,
                  }}>
                    {getInitials(person.name)}
                  </div>
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {person.name}
                    </div>
                    <div style={{ fontSize: 12, color: person.userRole === "admin" ? "#64748b" : (person.department ? "#64748b" : "#334155"), marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {person.userRole === "admin" ? "Admin" : (person.department || "No department")}
                    </div>
                  </div>
                </button>
              );

              const SectionLabel = ({ label }) => (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                  {label}
                </div>
              );

              const Divider = () => (
                <div style={{ borderTop: "1px solid #1e293b", margin: "16px 0" }} />
              );

              return (
                <div style={{ marginBottom: 4 }}>
                  {admins.length > 0 && (
                    <div>
                      <SectionLabel label="Admins" />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {admins.map(p => <PersonBtn key={p.id ?? p.name} person={p} />)}
                      </div>
                    </div>
                  )}
                  {admins.length > 0 && employees.length > 0 && <Divider />}
                  {employees.length > 0 && (
                    <div>
                      <SectionLabel label="Employees" />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {employees.map(p => <PersonBtn key={p.id ?? p.name} person={p} />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => openClock("clockIn")}
                style={{ flex: 1, padding: "12px 0", background: "linear-gradient(135deg, #10b981, #059669)", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(16,185,129,0.3)", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(16,185,129,0.45)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(16,185,129,0.3)"; }}
              >Clock In</button>
              <button
                type="button"
                onClick={() => openClock("clockOut")}
                style={{ flex: 1, padding: "12px 0", background: "#0f172a", border: "1.5px solid rgba(239,68,68,0.4)", borderRadius: 10, color: "#ef4444", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.8)"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; e.currentTarget.style.background = "#0f172a"; }}
              >Clock Out</button>
            </div>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button style={LINK_BTN} onClick={onSwitch}>Switch organization</button>
            </div>
          </div>
          <div style={CARD_FOOTER}>Org code: {orgCode} · Secured by Auth0</div>
        </div>
      </div>

      {clockMode && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'DM Sans', system-ui, sans-serif" }}
          onClick={closeClockModal}
        >
          <div style={{ ...CARD, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <LogoHeader subtitle={clockMode === "clockIn" ? "Clock In" : "Clock Out"} />
            <div style={CARD_BODY}>
              {clockDone ? (
                <div style={{ textAlign: "center" }}>
                  <div style={SUCCESS_BOX}>
                    {clockMode === "clockIn" ? "✓ Clocked in successfully!" : "✓ Clocked out successfully!"}
                  </div>
                  <BtnPrimary type="button" onClick={closeClockModal}>Done</BtnPrimary>
                </div>
              ) : confirmedPerson ? (
                <div>
                  {pinError && <div style={ERR_BOX}>{pinError}</div>}
                  <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 8, textAlign: "center", lineHeight: 1.6 }}>
                    Is <strong style={{ color: "#f1f5f9", fontSize: 17 }}>{confirmedPerson.name.toUpperCase()}</strong> clocking <strong style={{ color: clockMode === "clockIn" ? "#10b981" : "#ef4444" }}>{clockMode === "clockIn" ? "IN" : "OUT"}</strong> for the day?
                  </p>
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button
                      type="button"
                      onClick={() => { setConfirmedPerson(null); setPinValue(""); setPinError(""); }}
                      style={{ flex: 1, padding: "13px 0", background: "#0f172a", border: "1px solid #334155", borderRadius: 10, color: "#94a3b8", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                    >No</button>
                    <BtnPrimary
                      type="button"
                      loading={pinLoading}
                      loadingLabel="Saving…"
                      onClick={handleClockYes}
                      style={{ flex: 1, background: clockMode === "clockIn" ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: clockMode === "clockIn" ? "0 4px 20px rgba(16,185,129,0.33)" : "0 4px 20px rgba(239,68,68,0.33)" }}
                    >Yes</BtnPrimary>
                  </div>
                </div>
              ) : (
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
      )}
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
    return localStorage.getItem(LS_CODE) ? "team" : "org";
  });
  const [orgCode, setOrgCode] = useState(() => localStorage.getItem(LS_CODE) || "");
  const [orgConfig, setOrgConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_CONFIG) || "null"); } catch { return null; }
  });
  const [teamPeople, setTeamPeople] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_PEOPLE) || "[]"); } catch { return []; }
  });
  const [selectedPerson, setSelectedPerson] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
  });

  // On mount: re-fetch config + people from S3 (keeps data fresh)
  useEffect(() => {
    const savedCode = localStorage.getItem(LS_CODE);
    if (savedCode) {
      fetchOrgConfig(savedCode)
        .then(async cfg => {
          setOrgConfig(cfg);
          setOrgCode(savedCode);
          localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
          try {
            const people = await fetchPeople(savedCode);
            setTeamPeople(people);
            localStorage.setItem(LS_PEOPLE, JSON.stringify(people));
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
            localStorage.removeItem(LS_CODE);
            localStorage.removeItem(LS_CONFIG);
            localStorage.removeItem(LS_PEOPLE);
            setOrgCode("");
            setOrgConfig(null);
          }
          setStep("org");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After Auth0 returns: validate selected person, domain, and roster
  useEffect(() => {
    if (!isAuthenticated || !user || !orgConfig) return;

    // If a specific person was selected, the logged-in email must match
    const saved = selectedPerson || (() => {
      try { return JSON.parse(localStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
    })();
    if (saved && user.email?.toLowerCase() !== saved.email?.toLowerCase()) {
      setStep("wrong-user");
      return;
    }

    const emailDomain = user.email?.split("@")[1]?.toLowerCase();
    if (emailDomain !== orgConfig.domain?.toLowerCase()) {
      setStep("domain-error");
      return;
    }

    const roster = teamPeople.length > 0 ? teamPeople : (() => {
      try { return JSON.parse(localStorage.getItem(LS_PEOPLE) || "[]"); } catch { return []; }
    })();

    const inRoster = roster.find(p => p.email?.toLowerCase() === user.email?.toLowerCase());
    // Support single adminEmail + adminEmails array; also allow through if roster is empty (bootstrap/recovery)
    const adminEmailList = [
      orgConfig.adminEmail,
      ...(orgConfig.adminEmails || []),
    ].filter(Boolean).map(e => e.toLowerCase());
    const isOrgAdmin = adminEmailList.includes(user.email?.toLowerCase());
    const rosterIsEmpty = roster.length === 0;

    if (!inRoster && !isOrgAdmin && !rosterIsEmpty) {
      setStep("not-in-team");
    }
  }, [isAuthenticated, user, orgConfig, teamPeople]);

  function handleOrgResolved(code, config) {
    setOrgCode(code);
    setOrgConfig(config);
    fetchPeople(code)
      .then(people => {
        setTeamPeople(people);
        localStorage.setItem(LS_PEOPLE, JSON.stringify(people));
      })
      .catch(() => {});
    setStep("team");
  }

  function handlePersonSelect(person) {
    setSelectedPerson(person);
    localStorage.setItem("tq_selected_person", JSON.stringify(person));
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
    localStorage.removeItem(LS_CODE);
    localStorage.removeItem(LS_CONFIG);
    localStorage.removeItem(LS_PEOPLE);
    localStorage.removeItem("tq_selected_person");
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
    localStorage.removeItem(LS_CODE);
    localStorage.removeItem(LS_CONFIG);
    localStorage.removeItem(LS_PEOPLE);
    localStorage.removeItem("tq_selected_person");
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
      />
    );
  }

  if (step === "wrong-user") {
    const saved = selectedPerson || (() => {
      try { return JSON.parse(localStorage.getItem("tq_selected_person") || "null"); } catch { return null; }
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

  return (
    <TRAQS
      auth0User={user}
      getToken={getAccessTokenSilently}
      logout={logout}
      orgCode={orgCode}
      orgConfig={orgConfig}
    />
  );
}

export default function App() {
  return <AuthGate />;
}
