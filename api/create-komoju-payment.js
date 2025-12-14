// api/create-komoju-payment.js
const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

module.exports = async function handler(req, res) {
  // CORS（必要に応じて調整）
  const allowedOrigins = [
    "https://shoumeiya.info",
    "https://www.shoumeiya.info",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      email,
      name,
      phone,
      items,
      paymentMethod, // "paypay" | "rakutenpay"
    } = req.body || {};

    if (!email || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid request" });
    }

    // 注文番号
    const orderId = "JL" + Date.now();

    // 金額計算
    const amount = items.reduce(
      (sum, i) => sum + Number(i.price) * Number(i.qty),
      0
    );

    // ===============================
    // ★ ここが正解①の核心
    // 決済前にお客様へ「受付メール」を送る
    // ===============================
    await sendCustomerMail({
      to: email,
      subject: "【ご注文受付】Jun Lamp Studio",
      html: `
        <p>${name || ""} 様</p>
        <p>ご注文ありがとうございます。</p>
        <p>ただいまご注文を受け付けました。</p>
        <p>このあと決済画面へ移動します。</p>
        <hr>
        <p><strong>注文番号：</strong>${orderId}</p>
        <p><strong>ご注文内容：</strong></p>
        <ul>
          ${items
            .map(
              (i) =>
                `<li>${i.name} ×${i.qty}（${Number(i.price).toLocaleString()}円）</li>`
            )
            .join("")}
        </ul>
        <p><strong>合計：</strong>${amount.toLocaleString()}円</p>
        <p style="margin-top:16px;">
          ※ 決済が完了しましたら、管理者側で確認後に発送準備に入ります。
        </p>
      `,
    });

    // 管理者にも「受付」通知（任意だが便利）
    await sendAdminMail({
      subject: `【注文受付】KOMOJU決済開始 / ${orderId}`,
      html: `
        <p>注文番号：${orderId}</p>
        <p>お客様Email：${email}</p>
        <p>支払い方法：${paymentMethod}</p>
        <p>合計：${amount.toLocaleString()}円</p>
      `,
    });

    // ===============================
    // KOMOJU 決済作成
    // ===============================
    const payload = JSON.stringify({
      amount,
      currency: "JPY",
      payment_methods:
        paymentMethod === "paypay" ? ["paypay"] : ["rakutenpay"],
      external_order_num: orderId,
      customer: {
        email,
        name,
        phone,
      },
      return_url: "https://shoumeiya.info/success.html",
      cancel_url: "https://shoumeiya.info/cancel.html",
    });

    const apiKey = process.env.KOMOJU_SECRET_KEY;
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    const komoReq = https.request(
      {
        method: "POST",
        hostname: "komoju.com",
        path: "/api/v1/payments",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (r) => {
        let data = "";
        r.on("data", (c) => (data += c));
        r.on("end", () => {
          if (r.statusCode >= 200 && r.statusCode < 300) {
            const json = JSON.parse(data);
            return res.status(200).json({ url: json.payment_url });
          }
          console.error("KOMOJU error:", data);
          return res.status(500).json({ error: "KOMOJU error" });
        });
      }
    );

    komoReq.on("error", (e) => {
      console.error(e);
      res.status(500).json({ error: "Request failed" });
    });

    komoReq.write(payload);
    komoReq.end();
  } catch (e) {
    console.error("create-komoju-payment error:", e);
    return res.status(500).json({ error: "Server error" });
  }
};




