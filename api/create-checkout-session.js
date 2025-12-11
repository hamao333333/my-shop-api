// api/create-checkout-session.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * Vercel の Node.js API ルート
 * POST /api/create-checkout-session
 */
module.exports = async (req, res) => {
  // メソッドチェック
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body || {};

    // items が正しく来ているかチェック
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ items が空 or 不正: ", req.body);
      return res.status(400).json({ error: "No items in cart" });
    }

    // Junさんの cart.js 仕様:
    // { id, name, price, qty } が入っている前提で Stripe の line_items を組み立てる
    const line_items = items.map((item) => {
      const unitAmount = Number(item.price) || 0;
      const quantity = Number(item.qty) || 1;

      return {
        price_data: {
          currency: "jpy",
          product_data: {
            name: item.name || "ランプ",
          },
          // Stripe は「最小通貨単位（= 円ならそのまま整数）」で指定
          unit_amount: unitAmount,
        },
        quantity,
      };
    });

    console.log("✅ line_items:", line_items);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      success_url: "https://shoumeiya.info/success.html",
      cancel_url: "https://shoumeiya.info/cancel.html",
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe エラー:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
