// api/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // --- CORS 設定 ---
  res.setHeader("Access-Control-Allow-Origin", "https://shoumeiya.info");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ブラウザの事前確認（OPTIONS）はここで終了
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // POST 以外は受け付けない
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ⭐ まずは「固定のテスト商品」でだけセッションを作る
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: {
              name: "テスト注文（Jun Lamp Studio）",
            },
            // 金額：500 円（Stripe は「円」ではなく「銭」単位）
            unit_amount: 500 * 100,
          },
          quantity: 1,
        },
      ],
      // 成功時・キャンセル時の遷移先
      success_url: "https://shoumeiya.info/thanks-test.html",
      cancel_url: "https://shoumeiya.info/checkout.html",
    });

    // フロント側に決済ページの URL を返す
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe error:", error);
    return res.status(500).json({ error: "Stripe API error" });
  }
}
