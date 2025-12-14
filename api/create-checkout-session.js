// api/create-checkout-session.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// 一律送料（テスト用）：10円
const SHIPPING_FEE = 10;

module.exports = async (req, res) => {
  // ★ 許可したいオリジンを列挙
  const allowedOrigins = [
    "https://shoumeiya.info",
    "https://www.shoumeiya.info",
    "http://localhost:5500",     // ローカルで file サーバーとか使うなら
    "http://127.0.0.1:5500",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ★ プリフライト（OPTIONS）はここで終了
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // メソッドチェック
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ items が空 or 不正: ", req.body);
      return res.status(400).json({ error: "No items in cart" });
    }

    // 商品の line items
    const line_items = items.map((item) => {
      const unitAmount = Number(item.price) || 0;
      const quantity = Number(item.qty) || 1;

      return {
        price_data: {
          currency: "jpy",
          product_data: {
            name: item.name || "ランプ",
          },
          unit_amount: unitAmount, // 円単位
        },
        quantity,
      };
    });

    // 🔹ここで送料を1行追加（10円）
    line_items.push({
      price_data: {
        currency: "jpy",
        product_data: {
          name: "送料",
        },
        unit_amount: SHIPPING_FEE, // 10円
      },
      quantity: 1,
    });

    console.log("✅ line_items:", line_items);

   const session = await stripe.checkout.sessions.create({
  mode: "payment",
  payment_method_types: ["card"],
  line_items,
  metadata: {
    shop: "Jun Lamp Studio",
  },
  success_url: "https://shoumeiya.info/success.html",
  cancel_url: "https://shoumeiya.info/cancel.html",
});

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe エラー:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

