import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Jun Lamp Studio <noreply@your-domain.com>";
const ADMIN = process.env.ADMIN_EMAIL;

export async function sendCustomerMail({ to, subject, html }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  });
}

export async function sendAdminMail({ subject, html }) {
  return resend.emails.send({
    from: FROM,
    to: ADMIN,
    subject,
    html,
  });
}
