// api/webhook-stripe.js（CommonJS / Vercel）
const Stripe = require("stripe");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---- GAS 在庫減算（doPost） ----
const GAS_STOCK_URL = process.env.GAS_STOCK_URL; // 例: https://script.google.com/macros/s/xxx/exec

async function postJson(url, payload) {
  // Node 18+ on Vercel has global fetch
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

  // Fallback (rare): use https
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

async function reduceStockForStripeSession(session) {
  if (!GAS_STOCK_URL) {
    console.warn("GAS_STOCK_URL is not set; skip stock reduce.");
    return { ok: false, skipped: true, reason: "missing GAS_STOCK_URL" };
  }

  const cartStr = session?.metadata?.cart_items;
  if (!cartStr) {
    console.warn("session.metadata.cart_items not found; skip stock reduce.");
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

    // 1注文内に複数商品がある場合に備え、商品ごとにユニークなorder_idにする
    const order_id = `stripe:${session.id}:${product_id}`;

    const r = await postJson(GAS_STOCK_URL, { product_id, qty, order_id });
    results.push({ product_id, qty, result: r });
    if (!r.ok) {
      console.error("GAS reduceStock failed:", { product_id, qty, order_id, r });
    }
  }

  return { ok: true, results };
}

// raw body を受け取るための設定（Webhook署名検証に必須）
module.exports.config = {
  api: { bodyParser: false },
};

// 通貨の最小単位 → 表示金額へ
function amountToDisplay(currency, amountInSmallestUnit) {
  const cur = String(currency || "").toUpperCase();
  const amount = Number(amountInSmallestUnit || 0);

  // 0-decimal currencies（最低限：JPY）
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  if (zeroDecimal.has(cur)) return amount;

  return amount / 100;
}

module.exports = async function handler(req, res) {
  const sig = req.headers["stripe-signature"];

  // 1) raw body を集める
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  // 2) 署名検証
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe Webhook署名検証失敗:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      // paid（入金済み）のときだけ送る
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("Skip email: payment_status =", session.payment_status);
        return res.status(200).json({ received: true, skipped: true });
      }

      // 在庫減算（決済確定時）
      const stockUpdate = await reduceStockForStripeSession(session);
      console.log("Stock update result:", stockUpdate);

      // ✅ 画面の注文番号（success.html と一致させたいなら metadata.order_id を使う）
      const orderId = session?.metadata?.order_id || session.id;

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.customer?.email ||
        null;

      // ★追加（最小）：購入者情報（checkout.html入力→create-checkout-session の metadata）
      const meta = session.metadata || {};
      const buyer = {
        name: meta.name || session.customer_details?.name || "",
        nameKana: meta.name_kana || "",
        email: meta.email || email || "",
        phone: meta.phone || "",
        zip: meta.zip || "",
        address1: meta.address1 || "",
        address2: meta.address2 || "",
        deliveryTime: meta.delivery_time || "",
        notes: meta.notes || "",
      };

      // 商品一覧取得
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { limit: 100 }
      );

      const currency = (session.currency || "jpy").toUpperCase();

      const items = (lineItems.data || []).map((li) => {
        const qty = Number(li.quantity || 0);

        const total = Number(li.amount_total || 0);
        const unit = qty > 0 ? Math.round(total / qty) : 0;

        return {
          name: li.description || "(item)",
          qty,
          unitAmount: unit,
          totalAmount: total,
        };
      });

      const lines = items
        .map((i) => {
          const unitDisp = amountToDisplay(currency, i.unitAmount);
          const totalDisp = amountToDisplay(currency, i.totalAmount);
          return `・${i.name} ×${i.qty} / 単価 ${Number(unitDisp).toLocaleString()} ${currency}（小計 ${Number(totalDisp).toLocaleString()} ${currency}）`;
        })
        .join("<br>");

      // 合計（セッション側の合計を優先）
      const totalDisp = amountToDisplay(currency, session.amount_total || 0);

      const buyerBlock = `
        <h3>購入者情報</h3>
        <p>氏名：${buyer.name}</p>
        <p>カナ：${buyer.nameKana}</p>
        <p>メール：${buyer.email}</p>
        <p>電話：${buyer.phone}</p>
        <p>郵便：${buyer.zip}</p>
        <p>住所：${buyer.address1} ${buyer.address2}</p>
        <p>配達時間：${buyer.deliveryTime}</p>
        <p>備考：${buyer.notes}</p>
      `;

      // 管理者メール（必ず）
      await sendAdminMail({
        subject: `【入金確認】Stripe決済 / ${orderId}`,
        html: `
          <p>Stripe決済が完了しました。</p>
          <p>注文番号：<strong>${orderId}</strong></p>
          <p>通貨：${currency}</p>
          <p><strong>合計：${Number(totalDisp).toLocaleString()} ${currency}</strong></p>
          <hr>
          ${buyerBlock}
          <hr>
          <h3>明細</h3>
          ${lines}
        `,
      });

      // お客様メール（emailが取れたら）
      if (email) {
        await sendCustomerMail({
          to: email,
          subject: "【ご注文ありがとうございます】Jun Lamp Studio",
          html: `
            <p>ご注文ありがとうございます。</p>
            <p>注文番号：<strong>${orderId}</strong></p>
            <p>お支払いを確認しました。</p>
            <p><strong>合計：${Number(totalDisp).toLocaleString()} ${currency}</strong></p>
            <hr>
            ${buyerBlock}
            <hr>
            <h3>明細</h3>
            ${lines}
          `,
        });
      } else {
        console.log("Customer email not found in session; skip customer mail.");
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Stripe Webhook処理エラー:", err);
    return res.status(500).send("Server error");
  }
};
