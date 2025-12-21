// api/webhook-komoju.js (CommonJS / Vercel)
const crypto = require("crypto");
const { sendAdminMail } = require("../lib/sendMail");

// ---- GAS 在庫減算（doPost） ----
const GAS_STOCK_URL = process.env.GAS_STOCK_URL; // 例: https://script.google.com/macros/s/xxx/exec

async function postJson(url, payload) {
  if (typeof fetch === "function") {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch { j = { ok: false, error: "non-json", raw: t }; }
    return j;
  }

  const https = require("https");
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let j;
          try { j = JSON.parse(buf); } catch { j = { ok: false, error: "non-json", raw: buf }; }
          resolve(j);
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function reduceStockForKomojuPayment(payment) {
  if (!GAS_STOCK_URL) {
    console.warn("GAS_STOCK_URL is not set; skip stock reduce.");
    return { ok: false, skipped: true, reason: "missing GAS_STOCK_URL" };
  }

  const cartStr = payment?.metadata?.cart_items;
  if (!cartStr) {
    console.warn("payment.metadata.cart_items not found; skip stock reduce.");
    return { ok: false, skipped: true, reason: "missing cart_items" };
  }

  let cart;
  try { cart = JSON.parse(cartStr); } catch {
    console.warn("cart_items JSON parse failed; skip stock reduce.");
    return { ok: false, skipped: true, reason: "bad cart_items json" };
  }

  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, skipped: true, reason: "empty cart_items" };
  }

  const results = [];
  for (const it of cart) {
    const product_id = it?.id;
    const qty = Number(it?.qty || 0);
    if (!product_id || qty <= 0) continue;

    const order_id = `komoju:${payment.id}:${product_id}`;
    const r = await postJson(GAS_STOCK_URL, { product_id, qty, order_id });
    results.push({ product_id, qty, result: r });
    if (!r.ok) {
      console.error("GAS reduceStock failed:", { product_id, qty, order_id, r });
    }
  }

  return { ok: true, results };
}

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

      const stockUpdate = await reduceStockForKomojuPayment(payment);
      console.log("Stock update result:", stockUpdate);

      // ★ここだけ最小修正：success.html と同じ order_id を最優先で採用
      const orderId =
        payment?.metadata?.order_id ||
        payment.external_order_num ||
        payment.id ||
        "(no id)";

      const method =
        payment.payment_method?.type ||
        (typeof payment.payment_method === "string" ? payment.payment_method : null) ||
        payment.payment_type ||
        payment.payment_details?.type ||
        "(unknown)";

      await sendAdminMail({
        subject: `【入金確認】KOMOJU / ${orderId}`,
        html: `
          <h3>入金確認（KOMOJU）</h3>
          <p>注文番号：${orderId}</p>
          <p>支払方法：${method}</p>
        `,
      });
    } catch (e) {
      console.error("KOMOJU webhook error:", e);
      return res.status(500).send("Server error");
    }
  }

  return res.status(200).json({ ok: true });
};
