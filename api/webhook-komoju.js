// api/webhook-komoju.js (CommonJS / Vercel)
const crypto = require("crypto");
const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// raw body 必須（署名検証のため）
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  // 1) raw body 読み取り
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks);

  // 2) 署名検証
  const webhookSecret = process.env.KOMOJU_WEBHOOK_SECRET || "";
  const signature = req.headers["x-komoju-signature"]; // X-Komoju-Signature

  if (!webhookSecret) return res.status(500).send("Missing KOMOJU_WEBHOOK_SECRET");
  if (!signature) return res.status(400).send("Missing X-Komoju-Signature");

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) {
    console.error("❌ Invalid signature");
    return res.status(400).send("Invalid signature");
  }

  // 3) JSON parse
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    console.error("❌ Invalid JSON");
    return res.status(400).send("Invalid JSON");
  }

  const type = event?.type;
  console.log("KOMOJU EVENT TYPE:", type);

  // ping はOK返すだけ
  if (type === "ping") {
    return res.status(200).json({ ok: true, pong: true });
  }

  // 4) 支払い確定系
  if (type === "payment.captured" || type === "payment.authorized") {
    try {
      const payment = event.data || {};
      const paymentId = payment.id;
      const orderId = payment.external_order_num || paymentId || "(no id)";
      const method = payment.payment_method || "(unknown)";

      // (A) まずイベント内から拾う
      let email =
        payment?.customer?.email ||
        payment?.customer_email ||
        payment?.email ||
        "";

      // (B) 無ければ KOMOJU API で支払い詳細を引いて拾う
      if (!email && paymentId) {
        const full = await fetchKomojuPayment(paymentId);
        email =
          full?.customer?.email ||
          full?.customer_email ||
          full?.email ||
          "";
        console.log("Fetched payment detail email:", email || "(none)");
      }

      // 管理者メールは必ず送る（状況が分かるように）
      await sendAdminMail({
        subject: `【KOMOJU】${type} / ${orderId}`,
        html: `
          <p>type:${type}</p>
          <p>order:${orderId}</p>
          <p>method:${method}</p>
          <p>email:${email || "(none)"}</p>
          <p>paymentId:${paymentId || "(none)"}</p>
        `,
      });

      // お客様メール（email が取れた時だけ）
      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【お支払い完了】Jun Lamp Studio",
          html: `<p>お支払いを確認しました。</p><p>注文番号：<strong>${orderId}</strong></p>`,
        });
      } else {
        console.log("No email found -> skip customer mail");
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("❌ KOMOJU handler error:", e);
      return res.status(500).send("Server error");
    }
  }

  // それ以外は無視してOK
  return res.status(200).json({ ok: true, ignored: true, type });
};

// KOMOJU: Payment詳細を取得
function fetchKomojuPayment(paymentId) {
  const apiKey = process.env.KOMOJU_SECRET_KEY || "";
  if (!apiKey) throw new Error("Missing KOMOJU_SECRET_KEY");

  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: "komoju.com",
        path: `/api/v1/payments/${encodeURIComponent(paymentId)}`,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data || "{}");
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
            reject(new Error(`KOMOJU API ${res.statusCode}: ${data}`));
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}







