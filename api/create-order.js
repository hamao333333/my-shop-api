// api/create-order.js
// CommonJS / Vercel
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

// ★GAS在庫API（doGet）
const GAS_STOCK_URL = process.env.GAS_STOCK_URL;

/* ---------------- CORS ---------------- */
function setCors(req, res) {
  // ✅ 本番(独自ドメイン) + 開発(localhost) + プレビュー等でも動くように、来た Origin をそのまま返す
  // - file:// などで Origin が無い場合は "*" にする
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


// ★在庫取得（GAS doGet）
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

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { orderId, paymentMethod, customer, items } = req.body || {};

    if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId" });
    if (!paymentMethod) return res.status(400).json({ ok: false, error: "Missing paymentMethod" });
    if (!customer || !customer.email) return res.status(400).json({ ok: false, error: "Missing customer.email" });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: "No items" });

// ★在庫チェック（1つでも不足なら止める：Stripeと同じ挙動）
const cartItems = items
  .map((i) => ({ id: i.id, qty: Number(i.qty || 0) }))
  .filter((i) => i.id && i.qty > 0);

const out_of_stock = [];
const insufficient = [];

// 商品IDが重複してる可能性に備えて合算
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


    const shipping = 10; // checkout.html と合わせる
    const itemsTotal = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );
    const total = itemsTotal + shipping;

    const pmLabel =
      paymentMethod === "bank" ? "銀行振込" :
      paymentMethod === "cod" ? "代金引換" :
      paymentMethod;

    const itemLines = items
      .map(
        (i) =>
          `・${esc(i.name || "(item)")} ×${Number(i.qty || 0)}（単価 ${Number(i.price || 0).toLocaleString()}円）`
      )
      .join("<br>");

    // 店舗向け（個人情報を全部入れる）
    await sendAdminMail({
      subject: `【新規注文】未入金（${pmLabel}）/ ${orderId}`,
      html: `
        <p>新しい注文がありました（未入金）。</p>
        <p>注文番号：<strong>${esc(orderId)}</strong></p>
        <p>支払い方法：<strong>${esc(pmLabel)}</strong></p>
        <hr>
        <h3>購入者情報</h3>
        <p>氏名：${esc(customer.name || "")}</p>
        <p>フリガナ：${esc(customer.nameKana || "")}</p>
        <p>メール：${esc(customer.email || "")}</p>
        <p>電話：${esc(customer.phone || "")}</p>
        <p>郵便：${esc(customer.zip || "")}</p>
        <p>住所：${esc([customer.address1, customer.address2].filter(Boolean).join(" "))}</p>
        <p>配達時間：${esc(customer.deliveryTime || "")}</p>
        <p>備考：${esc(customer.notes || "")}</p>
        <hr>
        <h3>明細</h3>
        ${itemLines}
        <p>送料：${shipping.toLocaleString()}円</p>
        <p><strong>合計：${total.toLocaleString()}円</strong></p>
      `,
    });

    // 客向け（注文確認）
    await sendCustomerMail({
      to: customer.email,
      subject: "【ご注文確認】Jun Lamp Studio",
      html: `
        <p>${esc(customer.name || "")} 様</p>
        <p>ご注文ありがとうございます。</p>
        <p>お支払い方法：<strong>${esc(pmLabel)}</strong></p>
        <p>ご入金（または受取時お支払い）の確認後に、発送手配します。</p>
        <p>ご注文番号：<strong>${esc(orderId)}</strong></p>
        <hr>
        ${itemLines}
        <p>送料：${shipping.toLocaleString()}円</p>
        <p><strong>合計：${total.toLocaleString()}円</strong></p>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("create-order ERROR:", e);
    const msg = String(e?.message || e);
if (
  msg.startsWith("GAS_STOCK_URL_NOT_SET") ||
  msg.startsWith("STOCK_API_") ||
  msg.startsWith("STOCK_API_NON_JSON")
) {
  return res.status(502).json({ ok: false, error: "STOCK_CHECK_FAILED", detail: msg });
}
return res.status(500).json({ ok: false, error: "Server error", detail: msg });
  }
};







