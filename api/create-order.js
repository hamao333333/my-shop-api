res.setHeader("Access-Control-Allow-Origin", "https://shoumeiya.info");
res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
if (req.method === "OPTIONS") return res.status(200).end();

import { sendCustomerMail, sendAdminMail } from "./lib/sendMail";

export default async function handler(req, res) {
  const { orderId, email, paymentMethod } = req.body;

  // 客向け
  await sendCustomerMail({
    to: email,
    subject: "【ご注文確認】Jun Lamp Studio",
    html: `
      <p>ご注文ありがとうございます。</p>
      <p>ご注文番号：<strong>${orderId}</strong></p>
      ${
        paymentMethod === "konbini"
          ? "<p>期限内にコンビニでのお支払いをお願いします。</p>"
          : ""
      }
    `,
  });

  // 店舗向け
  await sendAdminMail({
    subject: "【新規注文】未入金",
    html: `
      <p>新しい注文がありました。</p>
      <p>注文番号：${orderId}</p>
      <p>支払い方法：${paymentMethod}</p>
    `,
  });

  res.status(200).json({ ok: true });
}

