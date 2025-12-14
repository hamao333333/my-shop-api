// api/create-order.js
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

module.exports = async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "https://shoumeiya.info");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { orderId, paymentMethod, customer, items } = req.body || {};

    // ---- validation ----
    if (!orderId) {
      return res.status(400).json({ ok: false, error: "Missing orderId" });
    }
    if (!["bank", "cod"].includes(paymentMethod)) {
      return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });
    }
    if (!customer?.email) {
      return res.status(400).json({ ok: false, error: "Missing customer.email" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing items" });
    }

    // ---- mail body ----
    const payLabel = paymentMethod === "bank" ? "銀行振込" : "代金引換";

    const lines = items
      .map(
        (i) => `・${i.name} ×${i.qty} / ${Number(i.price).toLocaleString()}円`
      )
      .join("<br>");

    const adminHtml = `
      <h3>新規注文（${payLabel}）</h3>
      <p>注文番号：${orderId}</p>
      <p>氏名：${customer.name || ""}</p>
      <p>Email：${customer.email}</p>
      <p>電話：${customer.tel || ""}</p>
      <p>住所：${customer.address || ""}</p>
      <hr>
      ${lines}
      <p>備考：${customer.note || ""}</p>
    `;

    const customerHtml = `
      <p>${customer.name || ""} 様</p>
      <p>ご注文ありがとうございます。</p>
      <p>注文番号：${orderId}</p>
      <hr>
      ${lines}
    `;

    // ---- send ----
    await sendAdminMail({
      subject: `【新規注文】${payLabel} / ${orderId}`,
      html: adminHtml,
    });

    await sendCustomerMail({
      to: customer.email,
      subject: `ご注文ありがとうございます / ${orderId}`,
      html: customerHtml,
    });

    return res.status(200).json({ ok: true, orderId });
  } catch (err) {
    console.error("create-order error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};






