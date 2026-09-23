// Sending mail. One SES client, one sender, one place to change either.
//
// THE FROM ADDRESS MUST BE A DOMAIN YOU CONTROL. This is not style advice: the
// previous default here was no-reply@traqs.app, and traqs.app belongs to someone
// else. Had SEND_FROM_EMAIL ever been unset in an environment, this would have
// tried to send as a stranger's domain -- which SES refuses, so the visible
// symptom would have been mail that silently never arrived. There is no default
// now. An unconfigured sender is a configuration error and says so.
//
// SES STATE AS OF 2026-09-23, measured against the account, not assumed:
//   - zero verified identities in us-east-1/2, us-west-1/2, eu-west-1
//   - 200/day quota in all five, i.e. still in the SES sandbox
//   - zero mail sent in the previous 24h
// So nothing has ever been delivered by this codebase, including the
// forgot-your-org-code mail, which has been quietly failing. Two things have to
// happen outside this file before any of it works:
//   1. verify the sending domain in SES (DKIM records in DNS), and
//   2. request production access, or SES will only deliver to addresses that
//      are themselves verified -- an invite to a new employee just vanishes.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});

export const FROM_EMAIL = process.env.SEND_FROM_EMAIL || "";

// WHERE REPLIES GO, and it is not necessarily the From address.
//
// Sending from support@<domain> needs only DKIM records; it does NOT require a
// mailbox, and a domain set up purely to send has no MX record. So a recipient
// who hits reply -- and on an address called "support" plenty will -- gets a
// bounce, silently, from an address that looks like an invitation to write back.
//
// Reply-To costs nothing and fixes it: the reply button follows this header, so
// replies can land in an existing monitored mailbox on a completely different
// domain. Set MAIL_REPLY_TO to one. Left unset, mail goes out without the
// header and replies go to FROM_EMAIL, which is correct only if that address
// can actually receive.
export const REPLY_TO = (process.env.MAIL_REPLY_TO || "").trim();

/**
 * Where the app lives, for links in email. A link is the whole point of an
 * invite, so a wrong base URL is a broken invite, not a cosmetic issue.
 *
 * APP_BASE_URL first so a deploy can state it outright; then Netlify's own URL,
 * which is correct on the production site. DEPLOY_PRIME_URL is deliberately NOT
 * consulted: on a branch or preview deploy it points at that preview, and an
 * invite mailed from a preview would send a real employee to a throwaway host.
 */
export const appBaseUrl = () =>
  (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/+$/, "");

/** HTML-escape. Every interpolated value in an email body goes through this. */
export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Send one message.
 *
 * Returns { ok: true } or { ok: false, reason, detail }. It does NOT throw, and
 * that is deliberate: every caller so far has already done the durable work
 * (written the invite, looked up the org code) before it gets here, and failing
 * the whole request because a mail server was unreachable would roll the user
 * back from a state that is actually fine. The caller decides what a failed
 * send means for its own response.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!FROM_EMAIL) {
    console.error("mail: SEND_FROM_EMAIL is not set; refusing to send");
    return { ok: false, reason: "no-sender" };
  }
  if (!to || !String(to).includes("@")) return { ok: false, reason: "bad-recipient" };

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      ...(REPLY_TO ? { ReplyToAddresses: [REPLY_TO] } : null),
      Message: {
        Subject: { Data: subject },
        Body: {
          // Both parts, always. A text/plain alternative is what stops a
          // well-formed HTML mail scoring as spam, and it is what the recipient
          // sees in a client that will not render HTML.
          Text: { Data: text },
          Html: { Data: html },
        },
      },
    }));
    return { ok: true };
  } catch (e) {
    // The two failures worth recognising on sight, because both look identical
    // from the outside -- nothing arrives -- and have completely different fixes.
    const name = e?.name || "";
    if (name === "MessageRejected" && /not verified/i.test(e?.message || "")) {
      console.error("mail: SES rejected the message. Either the FROM domain is "
        + "not verified, or the account is still in the sandbox and this "
        + "recipient is not verified either. From=" + FROM_EMAIL, e.message);
      return { ok: false, reason: "not-verified", detail: e.message };
    }
    console.error("mail: SES send error", name, e?.message);
    return { ok: false, reason: "send-failed", detail: e?.message };
  }
}
