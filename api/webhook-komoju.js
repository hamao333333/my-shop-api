// api/webhook-komoju.js  (CommonJS / Vercel)
const crypto = require("crypto");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// raw body 必須
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
  const signature = req.headers["x-komoju-signature"]; // X-Komoju-Signature

  if (!secret) return res.status(500).send("Missing KOMOJU_WEBHOOK_SECRET");
  if (!signature) return res.status(400).send("Missing X-Komoju-Signature");

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature !== expected) {
    console.error("❌ Invalid signature");
    return res.status(400).send("Invalid signature");
  }

  // 3) JSON parse（★先に宣言してから代入）
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    console.error("❌ Invalid JSON");
    return res.status(400).send("Invalid JSON");
  }

  // ★ ここから先だけ event を使う（初期化前参照を防ぐ）
  console.log("KOMOJU EVENT TYPE:", event?.type);

  try {
    // ping は何もせず 200
    if (event.type === "ping") {
      return res.status(200).json({ ok: true, pong: true });
    }

    // captured / authorized 両対応（取りこぼし防止）
    if (event.type === "payment.captured" || event.type === "payment.authorized") {
      const payment = event.data || {};
      const orderId = payment.external_order_num || payment.id || "(no id)";
      const email = payment.customer?.email;

      const method = payment.payment_method || "(unknown)";
      console.log("KOMOJU orderId:", orderId, "email:", email, "method:", method);

      // 管理者メールは必ず送る（emailが無くても状況が分かる）
      await sendAdminMail({
        subject: `【KOMOJU】${event.type} / ${orderId}`,
        html: `<p>type:${event.type}</p><p>order:${orderId}</p><p>method:${method}</p><p>email:${email || "(none)"}</p>`,
      });

      // 購入者メールは email があるときだけ
      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【お支払い完了】Jun Lamp Studio",
          html: `<p>お支払いを確認しました。</p><p>注文番号：<strong>${orderId}</strong></p>`,
        });
      } else {
        console.log("No customer email in payload -> skip customer mail");
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ KOMOJU webhook handler error:", e);
    return res.status(500).send("Server error");
  }
};






