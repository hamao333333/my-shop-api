// api/create-komoju-payment.js
// CommonJS / Vercel

const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

/* ---------------- CORS ---------------- */
function setCors(req, res) {
  const allowed = ["https://shoumeiya.info", "https://www.shoumeiya.info"];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ------------- JSON reader ------------- */
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

/* -------- KOMOJU Session API -------- */
function createKomojuSession(payload, apiKey) {
  const data = JSON.stringify(payload);
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
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(buf));
            } catch {
              resolve({});
            }
          } else {
            reject(
              new Error(`KOMOJU ${res.statusCode}: ${buf || "(empty body)"}`)
            );
          }
        });
      }
    );
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

/* --------------- handler --------------- */
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    console.error("=== HIT create-komoju-payment ===");

    const body = await readJson(req);
    console.error("BODY:", body);

    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];

    // フロントから来る支払い種別
    const paymentMethod = body.payment_type || body.paymentMethod;

    const email = (customer.email || "").trim();
    const name = (customer.name || "").trim();

    if (!email) {
      return res.status(400).json({ ok: false, error: "Missing email" });
    }
    if (!items.length) {
      return res.status(400).json({ ok: false, error: "No items" });
    }

    // ★KOMOJU正式 payment_types 対応表
    const komojuType =
      paymentMethod === "paypay"
        ? "paypay"
        : paymentMethod === "rakutenpay"
        ? "rakutenpay"
        : paymentMethod === "konbini"
        ? "konbini"
        : null;

    if (!komojuType) {
      return res.status(400).json({
        ok: false,
        error: "Invalid paymentMethod",
        got: paymentMethod,
        expected: ["paypay", "rakutenpay", "konbini"],
      });
    }

    const orderId = "JL" + Date.now();
    const amount = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );

    if (amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ① 決済前に受付メール
    await sendCustomerMail({
      to: email,
      subject: "【ご注文受付】Jun Lamp Studio",
      html: `
        <p>${name || ""} 様</p>
        <p>ご注文を受け付けました。</p>
        <p>このあと決済画面へ移動します。</p>
        <p>注文番号：<strong>${orderId}</strong></p>
        <p>合計：<strong>${amount.toLocaleString()}円</strong></p>
      `,
    });

    await sendAdminMail({
      subject: `【受付】KOMOJU / ${orderId}`,
      html: `<p>${email}</p><p>${amount}円</p><p>method:${komojuType}</p>`,
    });

    const apiKey = process.env.KOMOJU_SECRET_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing KOMOJU_SECRET_KEY" });
    }

    const sessionPayload = {
      amount: Math.round(amount),
      currency: "JPY",
      return_url: `https://shoumeiya.info/success-komoju.html?payment_type=${encodeURIComponent(komojuType)}&order_id=${encodeURIComponent(orderId)}`,
      
      external_order_num: orderId,
      customer_email: email,
      payment_types: [komojuType],
    };

    console.error("KOMOJU session payload:", sessionPayload);

    const session = await createKomojuSession(sessionPayload, apiKey);

    if (!session.session_url) {
      return res.status(500).json({ ok: false, error: "No session_url" });
    }

    return res.status(200).json({
      ok: true,
      redirect_url: session.session_url,
      order_id: orderId,
    });
  } catch (e) {
    console.error("create-komoju-payment ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: String(e.message || e),
    });
  }
};


