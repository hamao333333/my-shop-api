// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// 一律送料（テスト用）：10円
const SHIPPING_FEE = 10;

module.exports = async (req, res) => {
  // CORS
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
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, customer } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ items が空 or 不正: ", req.body);
      return res.status(400).json({ error: "No items in cart" });
    }

    // 注文番号（StripeとKOMOJUで揃えると管理が楽）
    const orderId = "JL" + Date.now();

    // line items
    const line_items = items.map((item) => {
      const unitAmount = Number(item.price) || 0;
      const quantity = Number(item.qty) || 1;

      return {
        price_data: {
          currency: "jpy",
          product_data: {
            name: item.name || "ランプ",
          },
          unit_amount: unitAmount, // JPYは円単位でOK
        },
        quantity,
      };
    });

    // 送料
    line_items.push({
      price_data: {
        currency: "jpy",
        product_data: { name: "送料" },
        unit_amount: SHIPPING_FEE,
      },
      quantity: 1,
    });

    console.log("✅ line_items:", line_items);

    // できれば checkout.html から customer.email を送る（任意）
    // 送られてきたら prefill する（なくてもCheckoutがメール収集してくれる）
    const customerEmail =
      (customer && typeof customer.email === "string" && customer.email.trim()) || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,

      // ✅ 重要：Checkoutでメール収集を必ず有効化
      // （メールが未入力でもCheckout側で入力させられる）
      customer_email: customerEmail,
      billing_address_collection: "required",

      // ✅ Webhookで参照できるように注文番号を残す
      metadata: {
        shop: "Jun Lamp Studio",
        order_id: orderId,
      },

      // success/cancel に注文番号を付けておく（フロント表示にも使える）
      success_url: `https://shoumeiya.info/success.html?order_id=${encodeURIComponent(orderId)}`,
      cancel_url: `https://shoumeiya.info/cancel.html?order_id=${encodeURIComponent(orderId)}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe エラー:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
