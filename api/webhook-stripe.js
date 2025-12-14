// api/webhook-stripe.js（CommonJS / Vercel対応）
const Stripe = require("stripe");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ★ raw body を受け取るための設定
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async function handler(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    // raw body を取得
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook署名検証失敗:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderId = session.id; // StripeのsessionIDを注文番号に
      const email = session.customer_details?.email;

      // 商品一覧を取得
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { limit: 100 }
      );

      const items = lineItems.data.map((li) => ({
        name: li.description,
        qty: li.quantity,
        price: li.amount_total / li.quantity / 100,
      }));

      const lines = items
        .map(
          (i) =>
            `・${i.name} ×${i.qty} / ${Number(i.price).toLocaleString()}円`
        )
        .join("<br>");

      // 管理者メール
      await sendAdminMail({
        subject: `【新規注文】オンライン決済 / ${orderId}`,
        html: `
          <p>オンライン決済が完了しました。</p>
          <p>注文番号：<strong>${orderId}</strong></p>
          <p>購入者メール：${email}</p>
          <hr>${lines}
        `,
      });

      // 購入者メール
      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【ご注文ありがとうございます】Jun Lamp Studio",
          html: `
            <p>ご注文ありがとうございます。</p>
            <p>注文番号：<strong>${orderId}</strong></p>
            <hr>${lines}
          `,
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook処理エラー:", err);
    return res.status(500).send("Server error");
  }
};
