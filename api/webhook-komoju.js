import { sendCustomerMail, sendAdminMail } from "./lib/sendMail";

export default async function handler(req, res) {
  const event = req.body;

  if (event.type === "payment.captured") {
    const payment = event.data;
    const orderId = payment.external_order_num;
    const email = payment.customer.email;
    const method = payment.payment_method;

    await sendCustomerMail({
      to: email,
      subject: "【お支払い完了】Jun Lamp Studio",
      html: `
        <p>ご入金を確認しました。</p>
        <p>注文番号：<strong>${orderId}</strong></p>
      `,
    });

    await sendAdminMail({
      subject: "【入金確認】KOMOJU",
      html: `
        <p>注文番号 ${orderId}</p>
        <p>支払い方法：${method}</p>
      `,
    });
  }

  res.json({ ok: true });
}
