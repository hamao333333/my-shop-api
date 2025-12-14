// api/create-order.js  (CommonJS)
const { sendCustomerMail, sendAdminMail } = require("./lib/sendMail");

function allowCors(req, res) {
  const ALLOWED_ORIGIN = "https://shoumeiya.info"; // wwwなら合わせる
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
}

module.exports = async function handler(req, res) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return; // ここで終了

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { orderId, paymentMethod, customer, items } = req.body || {};

    // 最低限のバリデーション
    if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId" });
    if (!["bank", "cod"].includes(paymentMethod)) {
      return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });
    }
    if (!customer?.email) return res.status(400).json({ ok: false, error: "Missing customer.email" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing items" });
    }

    // ここでメール送信（あなたの既存実装を利用）
    await sendAdminMail({ orderId, paymentMethod, customer, items });
    await sendCustomerMail({ orderId, paymentMethod, customer, items });

    return res.status(200).json({ ok: true, orderId });
  } catch (e) {
    console.error("create-order error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

  res.status(200).json({ ok: true });



