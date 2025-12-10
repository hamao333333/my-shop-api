// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * カートの中身を受け取って Stripe Checkout セッションを作成する
 */
module.exports = async (req, res) => {
  // POST以外は弾く
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body; // [{ name, price, quantity }, ...] を想定（priceは税込の円）

    const lineItems = items.map((item) => ({
      price_data: {
        currency: "jpy",
        product_data: {
          name: item.name,
        },
        unit_amount: item.price, // 例: 15000円なら 1500000 ではなく 15000 * 100 に注意
      },
      quantity: item.quantity,
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
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
