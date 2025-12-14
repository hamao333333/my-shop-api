// api/webhook-komoju.js (CommonJS / Vercel)
const crypto = require("crypto");
const { sendAdminMail } = require("../lib/sendMail");

module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  // raw body
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks);

  // signature verify
  const secret = process.env.KOMOJU_WEBHOOK_SECRET || "";
  const signature = req.headers["x-komoju-signature"]; // X-Komoju-Signature

  if (!secret) return res.status(500).send("Missing KOMOJU_WEBHOOK_SECRET");
  if (!signature) return res.status(400).send("Missing X-Komoju-Signature");

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature !== expected) {
    console.error("Invalid signature");
    return res.status(400).send("Invalid signature");
  }

  // parse
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }

  const type = event?.type;
  console.log("KOMOJU EVENT TYPE:", type);

  // ping
  if (type === "ping") {
    return res.status(200).json({ ok: true, pong: true });
  }

  // payment captured -> admin notify
  if (type === "payment.captured") {
    try {
      const payment = event.data || {};
      const orderId = payment.external_order_num || payment.id || "(no id)";
      const method = payment.payment_method || "(unknown)";

      await sendAdminMail({
        subject: `【入金確認】KOMOJU / ${orderId}`,
        html: `<p>type:${type}</p><p>order:${orderId}</p><p>method:${method}</p>`,
      });
    } catch (e) {
      console.error("KOMOJU webhook error:", e);
      return res.status(500).send("Server error");
    }
  }

  return res.status(200).json({ ok: true });
};
