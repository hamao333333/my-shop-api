// api/webhook-komoju.js  (CommonJS / Vercel)
const crypto = require("crypto");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// raw body を取る（署名検証に必須）
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  // 1) raw body 読み取り
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  // 2) 署名検証
  const secret = process.env.KOMOJU_WEBHOOK_SECRET || "";
  const signature = req.headers["x-komoju-signature"]; // X-Komoju-Signature :contentReference[oaicite:4]{index=4}

  if (!secret) {
    console.error("❌ Missing KOMOJU_WEBHOOK_SECRET");
    return res.status(500).send("Missing secret");
  }
  if (!signature) {
    console.error("❌ Missing X-Komoju-Signature header");
    return res.status(400).send("Missing signature");
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature !== expected) {
    console.error("❌ Invalid signature", { signature, expected });
    return res.status(400).send("Invalid signature");
  }

  // 3) JSON parse
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    console.error("❌ Invalid JSON");
    return res.status(400).send("Invalid JSON");
  }

  // 4) イベント処理
  try {
    // PayPay/楽天ペイは captured で来る想定（ここはあなたのKOMOJU設定と合わせる）
    if (event.type === "payment.captured") {
      const payment = event.data || {};
      const orderId = payment.external_order_num || payment.id || "(no id)";
      const email = payment.customer?.email;
      const method = payment.payment_method;

      await sendAdminMail({
        subject: `【入金確認】KOMOJU / ${orderId}`,
        html: `<p>注文番号：${orderId}</p><p>支払い方法：${method}</p>`,
      });

      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【お支払い完了】Jun Lamp Studio",
          html: `<p>ご入金を確認しました。</p><p>注文番号：<strong>${orderId}</strong></p>`,
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ KOMOJU webhook handler error:", e);
    return res.status(500).send("Server error");
  }
};


