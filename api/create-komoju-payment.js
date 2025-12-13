// api/create-komoju-payment.js
// Vercel Serverless Function (Node.js)
// Creates a KOMOJU Session and returns session_url for redirect.

// Required env:
// - KOMOJU_SECRET_KEY : sk_live_xxx or sk_test_xxx
// - SITE_BASE_URL     : https://your-domain.com  (no trailing slash recommended)

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function toIntAmountJPY(n) {
  // JPY is integer in KOMOJU Sessions API examples (lowest denomination). :contentReference[oaicite:1]{index=1}
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(v);
}

function safeString(s, max = 255) {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function makeOrderId() {
  // simple unique-ish order id
  // ex: JL-20251213-123456-AB12
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

function sumCart(items) {
  // items: [{ price: number, qty: number }]
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

function buildFormBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      // KOMOJU sessions supports arrays e.g. payment_methods[]=... (docs show payment_methods array) :contentReference[oaicite:2]{index=2}
      // Using payment_methods[] form style:
      for (const x of v) p.append(`${k}[]`, String(x));
    } else {
      p.append(k, String(v));
    }
  }
  return p.toString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const KOMOJU_SECRET_KEY = process.env.KOMOJU_SECRET_KEY;
  const SITE_BASE_URL = process.env.SITE_BASE_URL;

  if (!KOMOJU_SECRET_KEY || !SITE_BASE_URL) {
    return json(res, 500, {
      error: "Server misconfigured",
      detail: "KOMOJU_SECRET_KEY and SITE_BASE_URL are required env vars.",
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const paymentType = String(body?.payment_type || "").toLowerCase();
  const allowed = new Set(["paypay", "rakutenpay", "konbini"]);
  if (!allowed.has(paymentType)) {
    return json(res, 400, { error: "Invalid payment_type" });
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  const rawTotal = sumCart(items);
  if (rawTotal === null) {
    return json(res, 400, { error: "Invalid items" });
  }

  const amount = toIntAmountJPY(rawTotal);
  if (!amount || amount <= 0) {
    return json(res, 400, { error: "Invalid amount" });
  }

  const customer = body?.customer || {};
  const email = safeString(customer?.email, 255);
  const phone = safeString(customer?.phone, 50);
  const name = safeString(customer?.name, 100);

  // Order number you can show on your success page
  const orderId = safeString(body?.order_id || makeOrderId(), 255);

  // IMPORTANT:
  // Sessions API uses return_url and appends ?action=complete or ?action=cancel. :contentReference[oaicite:3]{index=3}
  // We'll always set return_url to success-komoju.html and pass our own query params too.
  // KOMOJU will append action + session_id afterwards.
  const returnUrl =
    `${SITE_BASE_URL.replace(/\/$/, "")}/success-komoju.html` +
    `?payment_type=${encodeURIComponent(paymentType)}` +
    `&order_id=${encodeURIComponent(orderId)}`;

  // Create session (POST /api/v1/sessions) :contentReference[oaicite:4]{index=4}
  // Minimal required fields: amount, currency, return_url :contentReference[oaicite:5]{index=5}
  // Optionally restrict payment methods:
  // In Sessions docs: payment_methods array :contentReference[oaicite:6]{index=6}
  const form = buildFormBody({
    amount,
    currency: "JPY",
    return_url: returnUrl,
    default_locale: "ja",
    payment_methods: [paymentType],

    // Optional customer info (if not supplied, KOMOJU can collect it on page)
    "customer[email]": email || undefined,
    "customer[phone]": phone || undefined,

    // Some integrations also pass external_order_num; if your account supports it,
    // this helps lookup later (safe to include; if rejected, remove it).
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
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      return json(res, 502, {
        error: "KOMOJU session create failed",
        status: r.status,
        data,
      });
    }

    // Expect session_url in response (integration guide: redirect customer to session_url) :contentReference[oaicite:7]{index=7}
    const sessionUrl = data?.session_url;
    if (!sessionUrl) {
      return json(res, 502, {
        error: "No session_url returned from KOMOJU",
        data,
      });
    }

    return json(res, 200, {
      redirect_url: sessionUrl,
      order_id: orderId,
      payment_type: paymentType,
    });
  } catch (e) {
    return json(res, 502, { error: "Network error", detail: String(e?.message || e) });
  }
}
