// api/create-komoju-payment.js (CommonJS / Vercel)  --- Session方式（Hosted Page）
module.exports = async function handler(req, res) {
  console.error("=== HIT create-komoju-payment ===", req.method, new Date().toISOString());

  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  let body;
  try {
    body = await readJson(req);
    console.error("BODY keys:", Object.keys(body || {}));
  } catch (e) {
    console.error("JSON parse error:", e);
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  // ここに続く…


const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

function setCors(req, res) {
  const allowed = ["https://shoumeiya.info", "https://www.shoumeiya.info"];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function komojuCreateSession(jsonObj, apiKey) {
  const postData = JSON.stringify(jsonObj);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        method: "POST",
        hostname: "komoju.com",
        path: "/api/v1/sessions",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({});
            }
          } else {
            // 400でも本文が空のことがあるので、status/headers/lenも出す
            const info = {
              status: res.statusCode,
              len: data.length,
              headers: res.headers,
              body: data,
            };
            reject(new Error(`KOMOJU session error: ${JSON.stringify(info)}`));
          }
        });
      }
    );

    r.on("error", reject);
    r.write(postData);
    r.end();
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = await readJson(req);

    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const paymentMethod = body.paymentMethod; // "paypay" or "rakutenpay"（フロント側の値）

    const email = (customer.email || "").trim();
    const name = (customer.name || "").trim();
    const phone = (customer.tel || customer.phone || "").trim();

    if (!email) return res.status(400).json({ ok: false, error: "Missing customer.email" });
    if (!items.length) return res.status(400).json({ ok: false, error: "Missing items" });
    if (!["paypay", "rakutenpay"].includes(paymentMethod)) {
      return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });
    }

    // KOMOJUの payment type slug（公式スラッグ）
    // paypay / rakutenpay が正しい
    const komojuPaymentType = paymentMethod === "paypay" ? "paypay" : "rakutenpay";

    const orderId = "JL" + Date.now();
    const amount = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0);
    if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "Invalid amount" });

    // ★正解①：決済前に「受付メール」を送る
    await sendCustomerMail({
      to: email,
      subject: "【ご注文受付】Jun Lamp Studio",
      html: `
        <p>${name || ""} 様</p>
        <p>ご注文を受け付けました。</p>
        <p>このあと決済画面へ移動します。</p>
        <p>注文番号：<strong>${orderId}</strong></p>
        <p>合計：<strong>${Number(amount).toLocaleString()}円</strong></p>
      `,
    });

    await sendAdminMail({
      subject: `【受付】KOMOJU決済開始 / ${orderId}`,
      html: `<p>order:${orderId}</p><p>email:${email}</p><p>type:${komojuPaymentType}</p><p>amount:${amount}</p>`,
    });

    const apiKey = process.env.KOMOJU_SECRET_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing KOMOJU_SECRET_KEY" });

    // Hosted Page の正攻法：Sessionを作って session_url に飛ばす
    const sessionReq = {
  amount: Math.round(amount),
  currency: "JPY",
  return_url: "https://shoumeiya.info/success-komoju.html",
  external_order_num: orderId,
  customer_email: email,
  // ★ payment_types を外す
};

  console.error("KOMOJU session payload:", JSON.stringify(sessionReq, null, 2));

    const session = await komojuCreateSession(sessionReq, apiKey);

    const sessionUrl = session.session_url;
    if (!sessionUrl) {
      console.error("KOMOJU session response:", session);
      return res.status(500).json({ ok: false, error: "No session_url returned" });
    }

    return res.status(200).json({
      ok: true,
      redirect_url: sessionUrl,
      order_id: orderId,
      session_id: session.id,
    });
  } catch (e) {
    console.error("create-komoju-payment error:", e);
    return res.status(502).json({
      ok: false,
      error: "Failed to create KOMOJU session",
      detail: String(e.message || e),
    });
  }
};












