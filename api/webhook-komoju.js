// api/webhook-komoju.js（CommonJS / Vercel対応）
const crypto = require("crypto");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// ★ raw body を使う
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async function handler(req, res) {
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk;
  }

  // ---- 署名検証（必須）----
  const signature = req.headers["x-komoju-signature"];
  const secret = process.env.KOMOJU_WEBHOOK_SECRET;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expectedSignature) {
    console.error("❌ KOMOJU署名不正");
    return res.status(400).send("Invalid signature");
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).send("Invalid JSON");
  }

  try {
    if (event.type === "payment.captured") {
      const payment = event.data;

      const orderId = payment.external_order_num || payment.id;
      const email = payment.customer?.email;
      const method = payment.payment_method;

      // 管理者メール
      await sendAdminMail({
        subject: "【入金確認】KOMOJU",
        html: `
          <p>注文番号：${orderId}</p>
          <p>支払い方法：${method}</p>
        `,
      });

      // 購入者メール
      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【お支払い完了】Jun Lamp Studio",
          html: `
            <p>ご入金を確認しました。</p>
            <p>注文番号：<strong>${orderId}</strong></p>
          `,
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ KOMOJU webhook error:", err);
    return res.status(500).send("Server error");
  }
};
