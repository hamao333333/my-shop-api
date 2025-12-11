// api/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // ★ CORS 設定（ここが超重要）
  res.setHeader("Access-Control-Allow-Origin", "https://shoumeiya.info");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ブラウザの事前確認（OPTIONS）はここで OK を返して終了
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // それ以外で POST 以外は NG
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, customer } = req.body;

    // カートから Stripe 用 line_items を作成
    const line_items = (items || []).map((item) => ({
      price_data: {
        currency: "jpy",
        product_data: {
          name: item.name,
        },
        // 例: 12000 → 12000 * 100 = 1,200,000（Stripe は最小単位が「円」ではなく「銭」）
        unit_amount: Number(item.price) * 100,
      },
      quantity: Number(item.qty) || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: customer?.email || undefined,
      metadata: {
        name: customer?.name || "",
        zip: customer?.zip || "",
        address1: customer?.address1 || "",
        address2: customer?.address2 || "",
        tel: customer?.tel || "",
      },
      success_url: "https://shoumeiya.info/thanks.html",
      cancel_url: "https://shoumeiya.info/checkout.html",
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe error:", error);
    return res.status(500).json({ error: "Stripe API error" });
  }
}

