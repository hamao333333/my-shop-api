// api/create-komoju-payment.js
const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// ★追加：GAS在庫API（/exec）
const GAS_STOCK_URL = process.env.GAS_STOCK_URL;

async function getStock(productId) {
  if (!GAS_STOCK_URL) throw new Error("GAS_STOCK_URL_NOT_SET");
  const url = `${GAS_STOCK_URL}?product_id=${encodeURIComponent(productId)}`;
  const r = await fetch(url, { method: "GET" });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("STOCK_API_NON_JSON"); }
  if (!data || data.ok !== true) {
    throw new Error(data?.error ? `STOCK_API_${data.error}` : "STOCK_API_ERROR");
  }
  return Number(data.stock ?? 0);
}


/* ---------- CORS ---------- */
function setCors(req, res) {
  const allowed = ["https://shoumeiya.info", "https://www.shoumeiya.info"];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ---------- JSON ---------- */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(JSON.parse(body || "{}")));
    req.on("error", reject);
  });
}

/* ---------- KOMOJU ---------- */
function createSession(payload, apiKey) {
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
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve(JSON.parse(buf))
            : reject(new Error(buf));
        });
      }
    );
    r.write(data);
    r.end();
  });
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = await readJson(req);
    const customer = body.customer || {};
    const items = body.items || [];

    const orderId = "JL" + Date.now();

    const cartItems = items
      .map((i) => ({ id: i.id, qty: Number(i.qty || 0) }))
      .filter((i) => i.id && i.qty > 0);

    
    // ★追加：在庫チェック（Stripeと同じ：1つでも不足なら止める）
    const out_of_stock = [];
    const insufficient = [];

    const qtyById = new Map();
    for (const it of cartItems) {
      qtyById.set(it.id, (qtyById.get(it.id) || 0) + Number(it.qty || 0));
    }

    for (const [productId, needQty] of qtyById.entries()) {
      const stock = await getStock(productId);

      if (stock <= 0) {
        out_of_stock.push(productId);
      } else if (needQty > stock) {
        insufficient.push({ id: productId, need: needQty, have: stock });
      }
    }

    if (out_of_stock.length > 0 || insufficient.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "OUT_OF_STOCK",
        out_of_stock,
        insufficient,
      });
    }

const amount = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );

    const method =
      body.payment_type === "paypay"
        ? "paypay"
        : body.payment_type === "rakutenpay"
        ? "rakutenpay"
        : body.payment_type === "konbini"
        ? "konbini"
        : null;

    if (!method) {
      return res.status(400).json({ ok: false, error: "invalid payment" });
    }

    /* ---------- 管理者メール（受付） ---------- */
    const itemLines = items
      .map(i => `・${i.name} ×${i.qty}（${i.price.toLocaleString()}円）`)
      .join("<br>");

    await sendAdminMail({
      subject: `【受付】KOMOJU / ${orderId}`,
      html: `
        <h3>購入者情報</h3>
        <p>氏名：${customer.name}</p>
        <p>カナ：${customer.nameKana}</p>
        <p>メール：${customer.email}</p>
        <p>電話：${customer.phone}</p>
        <p>郵便：${customer.zip}</p>
        <p>住所：${customer.address1} ${customer.address2}</p>
        <p>配達時間：${customer.deliveryTime}</p>
        <p>備考：${customer.notes}</p>
        <hr>
        <h3>明細</h3>
        ${itemLines}
        <p><strong>合計：${amount.toLocaleString()}円</strong></p>
        <p>支払方法：${method}</p>
      `,
    });

    /* ---------- 顧客メール ---------- */
    await sendCustomerMail({
      to: customer.email,
      subject: "【ご注文受付】Jun Lamp Studio",
      html: `
        <p>${customer.name} 様</p>
        <p>ご注文を受け付けました。</p>
        <p>注文番号：<strong>${orderId}</strong></p>
        <p>合計：${amount.toLocaleString()}円</p>
      `,
    });

    /* ---------- KOMOJU セッション ---------- */
    const session = await createSession(
      {
        amount,
        currency: "JPY",
        customer_email: customer.email,
        external_order_num: orderId,
        payment_types: [method],
        // 在庫減算用（webhookで参照）
        metadata: { cart_items: JSON.stringify(cartItems) },
        return_url:
          `https://shoumeiya.info/success-komoju.html` +
          `?order_id=${encodeURIComponent(orderId)}` +
          `&payment_type=${encodeURIComponent(method)}`,
      },
      process.env.KOMOJU_SECRET_KEY
    );

    return res.status(200).json({
      ok: true,
      redirect_url: session.session_url,
      order_id: orderId,
    });
  } catch (e) {
    console.error("create-komoju-payment error:", e);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};








