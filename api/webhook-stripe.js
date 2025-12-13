import Stripe from "stripe";
import { sendCustomerMail, sendAdminMail } from "./lib/sendMail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const sig = req.headers["stripe-signature"];

  const event = stripe.webhooks.constructEvent(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata.order_id;
    const email = session.customer_details.email;

    await sendCustomerMail({
      to: email,
      subject: "【お支払い完了】Jun Lamp Studio",
      html: `
        <p>お支払いが完了しました。</p>
        <p>注文番号：<strong>${orderId}</strong></p>
      `,
    });

    await sendAdminMail({
      subject: "【入金確認】クレジットカード",
      html: `<p>注文番号 ${orderId} が入金済みです。</p>`,
    });
  }

  res.json({ received: true });
}
