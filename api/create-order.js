// api/create-order.js
import { sendCustomerMail, sendAdminMail } from "./lib/sendMail";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { orderId, paymentMethod, customer, items } = req.body || {};

    if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId" });
    if (!paymentMethod) return res.status(400).json({ ok: false, error: "Missing paymentMethod" });
    if (!customer || !customer.email) return res.status(400).json({ ok: false, error: "Missing customer.email" });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: "No items" });

    const shipping = 10; // checkout.html と合わせる（必要なら共通化）
    const itemsTotal = items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.qty || 0),
      0
    );
    const total = itemsTotal + shipping;

    const pmLabel =
      paymentMethod === "bank"
        ? "銀行振込"
        : paymentMethod === "cod"
        ? "代金引換"
        : paymentMethod;

    const itemLines = items
      .map(
        (i) =>
          `・${esc(i.name || "(item)")} ×${Number(i.qty || 0)}（単価 ${Number(
            i.price || 0
          ).toLocaleString()}円）`
      )
      .join("<br>");

    // 客向け
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

    // 店舗向け（★ここに個人情報を全部入れる）
    await sendAdminMail({
      subject: `【新規注文】未入金（${pmLabel}）/ ${orderId}`,
      html: `
        <p>新しい注文がありました（未入金）。</p>
        <p>注文番号：<strong>${esc(orderId)}</strong></p>
        <p>支払い方法：<strong>${esc(pmLabel)}</strong></p>
        <hr>
        <h3>購入者情報</h3>
        <p>氏名：${esc(customer.name || "")}</p>
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

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("create-order error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}




