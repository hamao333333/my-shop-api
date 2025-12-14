// api/lib/sendMail.js  (CommonJS)
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// ★ ここは必ず「Resendで認証済みドメイン」の送信元にする
// 例: "Jun Lamp Studio <noreply@shoumeiya.info>"
const FROM = process.env.MAIL_FROM || "Jun Lamp Studio <noreply@shoumeiya.info>";

// 管理者宛て（あなたの受信メール）
const ADMIN = process.env.ADMIN_EMAIL;

async function sendCustomerMail({ to, subject, html }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  });
}

async function sendAdminMail({ subject, html }) {
  return resend.emails.send({
    from: FROM,
    to: ADMIN,
    subject,
    html,
  });
}

module.exports = { sendCustomerMail, sendAdminMail };
