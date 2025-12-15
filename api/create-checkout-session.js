// api/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendAdminMail } = require("../lib/sendMail");

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

    // 合計（受付メール用）
    const itemsTotal = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );
    const total = itemsTotal + SHIPPING_FEE;

    // ✅ 受付（未決済）を管理者へ送る：KOMOJUと同じ挙動
    // ※ユーザーが何度も「支払いへ進む」を押すと重複メールになる可能性あり
    const itemLines = items
      .map(
        (i) =>
          `・${esc(i.name || "(item)")} ×${Number(i.qty || 0)}（単価 ${Number(
            i.price || 0
          ).toLocaleString()}円）`
      )
      .join("<br>");

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

      // ✅ 支払い完了後のWebhookでも個人情報を拾えるように保存
      metadata: {
        shop: "Jun Lamp Studio",
        order_id: orderId,

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

      success_url: `https://shoumeiya.info/success.html?order_id=${encodeURIComponent(
        orderId
      )}`,
      cancel_url: `https://shoumeiya.info/cancel.html?order_id=${encodeURIComponent(
        orderId
      )}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe エラー:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
