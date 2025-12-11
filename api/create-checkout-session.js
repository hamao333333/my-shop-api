// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * カートの中身を受け取って Stripe Checkout セッションを作成する
 */
module.exports = async (req, res) => {
  // POST以外は弾く
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // フロントから送っているのは { cart, customer }
    const { cart, customer } = req.body || {};

    // カートが空 or 配列でない場合
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // cart.js の { id, name, price, image, qty } に合わせる
    const lineItems = cart.map((item) => ({
      price_data: {
        currency: "jpy",
        product_data: {
          name: item.name,
          // 商品IDなどを後で確認したい場合に備えて metadata に入れておく
          metadata: {
            productId: item.id || "",
          },
        },
        // JPY はゼロ小数通貨なので「円単位」でOK（15000円 → 15000）
        unit_amount: Number(item.price) || 0,
      },
      quantity: item.qty || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url:
        "https://shoumeiya.info/thanks.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://shoumeiya.info/cart.html",

      // お客様情報も必要なら metadata に入れておく（管理側で確認できる）
      metadata: {
        customerName: customer?.name || "",
        customerEmail: customer?.email || "",
        customerTel: customer?.tel || "",
        deliveryTime: customer?.deliveryTime || "",
        note: customer?.note || "",
      },
    });

    // フロントにはセッションURLだけ返す
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
