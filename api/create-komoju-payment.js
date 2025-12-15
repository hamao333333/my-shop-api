// api/create-komoju-payment.js
const https = require("https");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

/* ---------- CORS ---------- */
function setCors(req, res) {
  const allowed = ["https://shoumeiya.info", "https://www.shoumeiya.info"];
  if (allowed.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
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

    if (!method) return res.status(400).json({ error: "invalid payment" });

    /* ---------- 管理者メール（最重要） ---------- */
    const itemLines = items
      .map(
        (i) =>
          `・${i.name} ×${i.qty}（${i.price.toLocaleString()}円）`
      )
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

   /* ---------- KOMOJU ---------- */

// まず仮のreturn_urlでセッション作成（session_id を得るため）
const session = await createSession(
  {
    amount,
    currency: "JPY",
    customer_email: customer.email,
    external_order_num: orderId,
    payment_types: [method],
    // 仮（あとで差し替えるための最小値）
    return_url: `https://shoumeiya.info/success-komoju.html?order_id=${encodeURIComponent(orderId)}&payment_type=${encodeURIComponent(method)}`,

  },
  process.env.KOMOJU_SECRET_KEY
);

if (!session || !session.session_url || !session.id) {
  return res.status(500).json({ ok: false, error: "KOMOJU session invalid" });
}

// ✅ success-komoju.html が要求している session_id を必ず付ける
const returnUrl =
  `https://shoumeiya.info/success-komoju.html` +
  `?order_id=${encodeURIComponent(orderId)}` +
  `&payment_type=${encodeURIComponent(method)}` +
  `&session_id=${encodeURIComponent(session.id)}`;

// KOMOJUは「return_url をセッション作成後に更新」するAPIが無いので、
// ここでは「ユーザーをreturn_url付きの session_url に送る」方式にする。
// KOMOJUのsession_urlの後ろに return_url を付けるのではなく、
// フロント側で success-komoju.html に遷移させて session_id で照会する。

return res.status(200).json({
  ok: true,
  redirect_url: session.session_url,
  order_id: orderId,
  // フロントが “支払い後の表示判定” で使えるよう渡す（任意）
  success_url: returnUrl,
});








