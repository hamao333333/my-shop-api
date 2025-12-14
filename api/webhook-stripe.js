// api/webhook-stripe.js（CommonJS / Vercel）
const Stripe = require("stripe");
const { sendCustomerMail, sendAdminMail } = require("../lib/sendMail");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// raw body を受け取るための設定（Webhook署名検証に必須）
module.exports.config = {
  api: { bodyParser: false },
};

// 通貨の最小単位 → 表示金額へ
// Stripeの amount は「最小通貨単位」(JPYは 1円単位 / USDは 1セント単位)
function amountToDisplay(currency, amountInSmallestUnit) {
  const cur = String(currency || "").toUpperCase();
  const amount = Number(amountInSmallestUnit || 0);

  // 0-decimal currencies（最低限：JPY）
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  if (zeroDecimal.has(cur)) return amount;

  // それ以外は 100 で割る（一般的なケース）
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
    // ✅ 送信タイミング：
    // - checkout.session.completed は基本OK（カードなら即 paid になりやすい）
    // - 非同期決済の安全策として async_payment_succeeded も拾う
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      // paid（入金済み）のときだけ送る
      // ※ completed でも unpaid が来るケースがあるので保険
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("Skip email: payment_status =", session.payment_status);
        return res.status(200).json({ received: true, skipped: true });
      }

      const orderId = session.id; // ひとまずStripeのsession ID（必要ならmetadataに切替可）
      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.customer?.email ||
        null;

      // 商品一覧取得
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { limit: 100 }
      );

      const currency = (session.currency || "jpy").toUpperCase();

      const items = (lineItems.data || []).map((li) => {
        const qty = Number(li.quantity || 0);

        // line item には amount_total が来る（最小通貨単位）
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

      // 管理者メール（必ず）
      await sendAdminMail({
        subject: `【新規注文】Stripe決済 / ${orderId}`,
        html: `
          <p>Stripe決済が完了しました。</p>
          <p>注文番号：<strong>${orderId}</strong></p>
          <p>購入者メール：${email || "(none)"}</p>
          <p>通貨：${currency}</p>
          <hr>${lines}
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
            <hr>${lines}
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
