// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendAdminMail } = require("../lib/sendMail");

// ★追加：GAS在庫API（doGet用）
const GAS_STOCK_URL = process.env.GAS_STOCK_URL;

// 一律送料（テスト用）：10円
const SHIPPING_FEE = 10;

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Stripe metadata 安全対策（長さ制限）
function safe(v, max = 450) {
  const s = String(v ?? "").trim();
  return s ? (s.length > max ? s.slice(0, max) : s) : undefined;
}

// ★追加：在庫取得（GAS doGet）
async function getStock(productId) {
  if (!GAS_STOCK_URL) throw new Error("GAS_STOCK_URL_NOT_SET");
  const url = `${GAS_STOCK_URL}?product_id=${encodeURIComponent(productId)}`;

  // Vercel(Node18+)ならfetchが使える
  const r = await fetch(url, { method: "GET" });
  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("STOCK_API_NON_JSON");
  }

  if (!data?.ok) throw new Error(data?.error ? `STOCK_API_${data.error}` : "STOCK_API_ERROR");
  return Number(data.stock ?? 0);
}

module.exports = async (req, res) => {
  // CORS
  const allowedOrigins = [
    "https://shoumeiya.info",
    "https://www.shoumeiya.info",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, customer } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ items が空 or 不正: ", req.body);
      return res.status(400).json({ error: "No items in cart" });
    }

    const c = customer || {};
    const orderId = "JL" + Date.now();

    const cartItems = items
      .map((i) => ({ id: i.id, qty: Number(i.qty || 0) }))
      .filter((i) => i.id && i.qty > 0);

    // =========================
    // ★追加：在庫チェック（パターン1）
    // =========================
    const out_of_stock = [];
    const insufficient = [];

    // id重複に備えて合算
    const qtyById = new Map();
    for (const it of cartItems) qtyById.set(it.id, (qtyById.get(it.id) || 0) + it.qty);

    for (const [productId, needQty] of qtyById.entries()) {
      const stock = await getStock(productId);
      if (stock <= 0) out_of_stock.push(productId);
      else if (needQty > stock) insufficient.push({ id: productId, need: needQty, have: stock });
    }

    if (out_of_stock.length || insufficient.length) {
      return res.status(409).json({
        error: "OUT_OF_STOCK",
        out_of_stock,
        insufficient,
      });
    }

    // 合計（受付メール用）
    const itemsTotal = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );
    const total = itemsTotal + SHIPPING_FEE;

    // ✅ 受付（未決済）を管理者へ送る（★ただし失敗しても決済は続ける）
    const itemLines = items
      .map(
        (i) =>
          `・${esc(i.name || "(item)")} ×${Number(i.qty || 0)}（単価 ${Number(
            i.price || 0
          ).toLocaleString()}円）`
      )
      .join("<br>");

    try {
      await sendAdminMail({
        subject: `【受付】Stripe(未決済) / ${orderId}`,
        html: `
          <p>Stripe決済の受付（まだ支払い完了ではありません）</p>
          <p>注文番号：<strong>${esc(orderId)}</strong></p>
          <hr>
          <h3>購入者情報（checkout.html入力）</h3>
          <p>氏名：${esc(c.name || "")}</p>
          <p>フリガナ：${esc(c.nameKana || "")}</p>
          <p>メール：${esc(c.email || "")}</p>
          <p>電話：${esc(c.phone || "")}</p>
          <p>郵便：${esc(c.zip || "")}</p>
          <p>住所：${esc([c.address1, c.address2].filter(Boolean).join(" "))}</p>
          <p>配達時間：${esc(c.deliveryTime || "")}</p>
          <p>備考：${esc(c.notes || "")}</p>
          <hr>
          <h3>明細</h3>
          ${itemLines}
          <p>送料：${SHIPPING_FEE.toLocaleString()}円</p>
          <p><strong>合計：${total.toLocaleString()}円</strong></p>
        `,
      });
    } catch (mailErr) {
      console.error("⚠️ sendAdminMail failed (continue checkout):", mailErr);
    }

    // line items（Stripe用）
    const line_items = items.map((item) => {
      const unitAmount = Number(item.price) || 0;
      const quantity = Number(item.qty) || 1;

      return {
        price_data: {
          currency: "jpy",
          product_data: { name: item.name || "ランプ" },
          unit_amount: unitAmount,
        },
        quantity,
      };
    });

    // 送料
    line_items.push({
      price_data: {
        currency: "jpy",
        product_data: { name: "送料" },
        unit_amount: SHIPPING_FEE,
      },
      quantity: 1,
    });

    const customerEmail =
      (typeof c.email === "string" && c.email.trim()) || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,

      customer_email: customerEmail,
      billing_address_collection: "required",

      client_reference_id: orderId,

      metadata: {
        shop: "Jun Lamp Studio",
        order_id: orderId,

        // 在庫減算用（Webhook側で使う）
        cart_items: safe(JSON.stringify(cartItems)),

        name: safe(c.name),
        name_kana: safe(c.nameKana),
        email: safe(c.email),
        phone: safe(c.phone),
        zip: safe(c.zip),
        address1: safe(c.address1),
        address2: safe(c.address2),
        delivery_time: safe(c.deliveryTime),
        notes: safe(c.notes),
      },

      success_url: `https://shoumeiya.info/success.html?order_id=${encodeURIComponent(orderId)}`,
      cancel_url: `https://shoumeiya.info/cancel.html?order_id=${encodeURIComponent(orderId)}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ create-checkout-session error:", err);

    // 在庫チェック系は原因を分けて返す（フロントで文言を変えられる）
    const msg = String(err?.message || "");
    if (msg === "GAS_STOCK_URL_NOT_SET") return res.status(500).json({ error: "GAS_STOCK_URL_NOT_SET" });
    if (msg.startsWith("STOCK_API_") || msg === "STOCK_API_NON_JSON")
      return res.status(502).json({ error: "STOCK_CHECK_FAILED" });

    return res.status(500).json({ error: "Internal server error" });
  }
};
