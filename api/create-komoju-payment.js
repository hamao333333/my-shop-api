// api/create-komoju-payment.js
// Vercel Serverless Function (Node.js / CommonJS)

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function setCors(req, res) {
  // 必要ならここをあなたのドメインに固定してOK
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeStr(v, max = 255) {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function sumCart(items) {
  let total = 0;
  for (const it of items || []) {
    const price = Number(it?.price);
    const qty = Number(it?.qty);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
    if (price < 0 || qty <= 0) return null;
    total += price * qty;
  }
  return total;
}

function makeOrderId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JL-${y}${m}${day}-${hh}${mm}${ss}-${rand}`;
}

function buildFormBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const x of v) p.append(`${k}[]`, String(x));
    } else {
      p.append(k, String(v));
    }
  }
  return p.toString();
}

module.exports = async (req, res) => {
  setCors(req, res);

  // preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const KOMOJU_SECRET_KEY = process.env.KOMOJU_SECRET_KEY;
  const SITE_BASE_URL = process.env.SITE_BASE_URL;

  if (!KOMOJU_SECRET_KEY || !SITE_BASE_URL) {
    return json(res, 500, {
      error: "Server misconfigured",
      detail: "KOMOJU_SECRET_KEY and SITE_BASE_URL are required.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body) return json(res, 400, { error: "Invalid JSON body" });

  const paymentType = String(body?.payment_type || "").toLowerCase();
  const allowed = new Set(["paypay", "rakutenpay", "konbini"]);
  if (!allowed.has(paymentType)) {
    return json(res, 400, { error: "Invalid payment_type" });
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  const rawTotal = sumCart(items);
  if (rawTotal === null) return json(res, 400, { error: "Invalid items" });

  const amount = Math.round(rawTotal);
  if (!amount || amount <= 0) return json(res, 400, { error: "Invalid amount" });

  const customer = body?.customer || {};
  const email = safeStr(customer?.email, 255);
  const phone = safeStr(customer?.phone, 50);
  const name = safeStr(customer?.name, 100);

  const orderId = safeStr(body?.order_id || makeOrderId(), 255);
  const base = SITE_BASE_URL.replace(/\/$/, "");

  // KOMOJUは return_url に ?action=complete|cancel を付けて戻します
  const returnUrl =
    `${base}/success-komoju.html` +
    `?payment_type=${encodeURIComponent(paymentType)}` +
    `&order_id=${encodeURIComponent(orderId)}`;

  const form = buildFormBody({
    amount,
    currency: "JPY",
    return_url: returnUrl,
    default_locale: "ja",
    payment_methods: paymentType,
    "customer[email]": email || undefined,
    "customer[phone]": phone || undefined,
    external_order_num: orderId,
    "metadata[customer_name]": name || undefined,
  });

  try {
    const r = await fetch("https://komoju.com/api/v1/sessions", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${KOMOJU_SECRET_KEY}:`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return json(res, 502, { error: "KOMOJU session create failed", status: r.status, data });
    }

    const sessionUrl = data?.session_url;
    if (!sessionUrl) {
      return json(res, 502, { error: "No session_url returned", data });
    }

    return json(res, 200, {
      redirect_url: sessionUrl,
      order_id: orderId,
      payment_type: paymentType,
    });
  } catch (e) {
    return json(res, 502, { error: "Network error", detail: String(e?.message || e) });
  }
};



