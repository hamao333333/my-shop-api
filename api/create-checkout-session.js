// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// 一律送料
const SHIPPING_FEE = 10;

// Stripe metadata 安全対策（長さ制限）
function safe(v, max = 450) {
  const s = String(v ?? "").trim();
  return s ? (s.length > max ? s.slice(0, max) : s) : undefined;
}

module.exports = async (req, res) => {
  /* ---------- CORS ---------- */
  const allowedOrigins = [
    "https://shoumeiya.info",
    "https://www.shoumeiya.info",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, customer } = req.body || {};

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "No items" });
    }

    const orderId = "JL" + Date.now();

    /* ---------- 商品 ---------- */
    const line_items = items.map((i) => ({
      price_data: {
        currency: "jpy",
        product_data: { name: i.name || "商品" },
        unit_amount: Number(i.price || 0),
      },
      quantity: Number(i.qty || 1),
    }));

    /* ---------- 送料 ---------- */
    line_items.push({
      price_data: {
        currency: "jpy",
        product_data: { name: "送料" },
        unit_amount: SHIPPING_FEE,
      },
      quantity: 1,
    });

    const c = customer || {};

    /* ---------- Stripe セッション ---------- */
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,

      customer_email: safe(c.email),
      billing_address_collection: "required",

      client_reference_id: orderId,

      // ★管理者メール用：checkout.html の入力を完全保存
      metadata: {
        order_id: orderId,
        shop: "Jun Lamp Studio",

        name: safe(c.name),
        name_kana: safe(c.nameKana),
        email: safe(c.email),
        phone: safe(c.phone),

        zip: safe(c.zip),
        address1: safe(c.address1),
        address2: safe(c.address2),

        delivery_time: safe(c.deliveryTime),
        notes: safe(c.notes),
      },

      success_url: `https://shoumeiya.info/success.html?order_id=${orderId}`,
      cancel_url: `https://shoumeiya.info/cancel.html?order_id=${orderId}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe error:", e);
    return res.status(500).json({ error: "Stripe error" });
  }
};
