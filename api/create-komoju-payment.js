// api/create-komoju-payment.js (CommonJS / Vercel)
const https = require("https");
const querystring = require("querystring");
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

function komojuCreatePayment(formObj, apiKey) {
  const postData = querystring.stringify(formObj);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        method: "POST",
        hostname: "komoju.com",
        path: "/api/v1/payments",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
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
            reject(new Error(`KOMOJU ${res.statusCode}: ${data}`));
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
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const body = await readJson(req);

    // checkout.html から { customer, items, paymentMethod } を送っている想定
    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const paymentMethod = body.paymentMethod; // "paypay" or "rakutenpay"

    const email = (customer.email || "").trim();
    const name = (customer.name || "").trim();
    const phone = (customer.tel || customer.phone || "").trim();

    if (!email) return res.status(400).json({ ok: false, error: "Missing customer.email" });
    if (!items.length) return res.status(400).json({ ok: false, error: "Missing items" });
    if (!["paypay", "rakutenpay"].includes(paymentMethod))
      return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });

    const orderId = "JL" + Date.now();
    const amount = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0);

    if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "Invalid amount" });

    // ★正解①：決済ページへ飛ばす前に「受付メール」
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

    // 管理者にも受付通知（任意）
    await sendAdminMail({
      subject: `【受付】KOMOJU決済開始 / ${orderId}`,
      html: `<p>order:${orderId}</p><p>email:${email}</p><p>method:${paymentMethod}</p><p>amount:${amount}</p>`,
    });

    const apiKey = process.env.KOMOJU_SECRET_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing KOMOJU_SECRET_KEY" });

    const form = {
      amount: Math.round(amount),
      currency: "JPY",
      // KOMOJUはこのキー名が安定（payment_methods[]）
     const komojuMethod =
  paymentMethod === "paypay" ? "paypay_online" :
  paymentMethod === "rakutenpay" ? "rakuten_pay" :
  null;

if (!komojuMethod) {
  return res.status(400).json({ ok: false, error: "Invalid paymentMethod" });
}

const form = {
  amount: Math.round(amount),
  currency: "JPY",
  "payment_methods[]": komojuMethod,
  external_order_num: orderId,
  return_url: "https://shoumeiya.info/success-komoju.html",
  cancel_url: "https://shoumeiya.info/cancel.html",
  "customer[email]": email,
  "customer[name]": name || undefined,
  "customer[phone]": phone || undefined,
};

    const created = await komojuCreatePayment(form, apiKey);

    const paymentUrl = created.payment_url || created.redirect_url || created.url;
    if (!paymentUrl) {
      console.error("KOMOJU create payment response:", created);
      return res.status(500).json({ ok: false, error: "No payment_url returned" });
    }

    return res.status(200).json({ ok: true, redirect_url: paymentUrl, order_id: orderId });
  } catch (e) {
    console.error("create-komoju-payment error:", e);
    return res.status(502).json({ ok: false, error: "Failed to create payment page", detail: String(e.message || e) });
  }
};






