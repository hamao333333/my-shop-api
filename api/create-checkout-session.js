// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// 自分のサイトのドメイン
const ALLOWED_ORIGIN = "https://shoumeiya.info";

module.exports = async (req, res) => {
  // --- CORS ヘッダを毎回つける ---
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // --- プリフライト(OPTIONS)対応 ---
  if (req.method === "OPTIONS") {
    // ここで 200 を返せばブラウザは「OK」と判断して POST を投げてくる
    return res.status(200).end();
  }

  // --- それ以外で POST 以外は弾く ---
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel の Node 関数では req.body が文字列のこともあるので保険
    const rawBody = req.body || {};
    const body =
      typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody;

    const items = body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items in cart" });
    }

    // カート → Stripe line_items へ変換
    const lineItems = items.map((item) => ({
      price_data: {
        currency: "jpy",
        product_data: {
          name: item.name || "商品",
        },
        // 円をそのまま整数で
        unit_amount: item.price || 0,
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: "https://shoumeiya.info/thanks.html",
      cancel_url: "https://shoumeiya.info/cart.html",
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

