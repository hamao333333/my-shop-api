import { Resend } from "resend";

export default async function handler(req, res) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const to = process.env.ADMIN_EMAIL; // まずは自分宛に固定が楽
    if (!to) {
      return res.status(500).json({ ok: false, error: "ADMIN_EMAIL is missing" });
    }

    const result = await resend.emails.send({
      // ドメイン未認証でも動く「Resendのテスト送信元」
      // まずはこれで通す（通ったら後で自ドメインにする）
      from: "onboarding@resend.dev",
      to,
      subject: "Resend テスト送信（Vercel）",
      html: "<p>Resendのテストです。届けばOK。</p>",
    });

    return res.status(200).json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
