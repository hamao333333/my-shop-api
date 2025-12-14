// api/create-order.js (CommonJS / Vercel)
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");
function setCors(req, res) {
  // ★あなたの本番フロントに合わせる（www有無も一致）
  const ORIGIN = "https://shoumeiya.info";

  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const orderId = body.orderId;
    const paymentMethod = body.paymentMethod; // "bank" or "cod"
    const customer = body.customer;
    const items = body.items;

    // ---- 最低限のバリデーション ----
    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({ ok: false, error: "Missing orderId" });
    }
    if (paymentMethod !== "bank" && paymentMethod !== "cod") {
      return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });
    }
    if (!customer || typeof customer !== "object") {
      return res.status(400).json({ ok: false, error: "Missing customer" });
    }
    if (!customer.email || typeof customer.email !== "string") {
      return res.status(400).json({ ok: false, error: "Missing customer.email" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing items" });
    }

    // ---- メール本文（ここは好きに整形OK）----
    const payLabel = paymentMethod === "bank" ? "銀行振込" : "代金引換";

    const lines = items
      .map((it) => {
        const name = String(it.name ?? "");
        const qty = Number(it.qty ?? 0);
        const price = Number(it.price ?? 0);
        return `・${name} ×${qty} / ${price}円`;
      })
      .join("<br>");

    const adminHtml = `
      <h2>新規注文（${payLabel}）</h2>
      <p><b>注文番号:</b> ${orderId}</p>
      <p><b>お客様:</b> ${customer.name ?? ""}</p>
      <p><b>Email:</b> ${customer.email}</p>
      <p><b>住所:</b> ${customer.address ?? ""}</p>
      <p><b>電話:</b> ${customer.tel ?? ""}</p>
      <hr>
      <p><b>注文内容</b><br>${lines}</p>
      <p><b>備考</b><br>${customer.note ?? ""}</p>
    `;

    const customerHtml = `
      <p>${customer.name ?? ""} 様</p>
      <p>ご注文ありがとうございます（${payLabel}）。</p>
      <p><b>注文番号:</b> ${orderId}</p>
      <hr>
      <p><b>ご注文内容</b><br>${lines}</p>
      <p>このメールは自動送信です。</p>
    `;

    // ---- sendMail.js の関数仕様に合わせて呼ぶ ----
    const adminResult = await sendAdminMail({
      subject: `【新規注文】${payLabel} / ${orderId}`,
      html: adminHtml,
    });

    const customerResult = await sendCustomerMail({
      to: customer.email,
      subject: `ご注文ありがとうございます / ${orderId}`,
      html: customerHtml,
    });

    return res.status(200).json({
      ok: true,
      orderId,
      adminMailId: adminResult?.data?.id ?? null,
      customerMailId: customerResult?.data?.id ?? null,
    });
  } catch (e) {
    console.error("create-order error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

  res.status(200).json({ ok: true });





