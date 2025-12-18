import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const GAS_URL = process.env.GAS_STOCK_URL;

// GAS doGet で在庫取得
async function getStock(product_id) {
  const res = await fetch(`${GAS_URL}?product_id=${encodeURIComponent(product_id)}`);
  const data = await res.json();
  if (!data.ok) throw new Error("STOCK_API_ERROR");
  return Number(data.stock);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body; // カート内容

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "EMPTY_CART" });
    }

    // =========================
    // 在庫チェック（ここが肝）
    // =========================
    const outOfStock = [];
    const insufficient = [];

    for (const item of items) {
      const stock = await getStock(item.id);

      if (stock <= 0) {
        outOfStock.push(item.id);
      } else if (item.qty > stock) {
        insufficient.push({
          id: item.id,
          need: item.qty,
          have: stock,
        });
      }
    }

    // 1つでもダメなら止める（パターン1）
    if (outOfStock.length > 0 || insufficient.length > 0) {
      return res.status(409).json({
        error: "OUT_OF_STOCK",
        out_of_stock: outOfStock,
        insufficient,
      });
    }

    // =========================
    // Stripe セッション作成
    // =========================
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: items.map((item) => ({
        price_data: {
          currency: "jpy",
          product_data: { name: item.name },
          unit_amount: item.price,
        },
        quantity: item.qty,
      })),
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/cancel.html`,
      metadata: {
        cart_items: JSON.stringify(
          items.map((i) => ({ product_id: i.id, qty: i.qty }))
        ),
      },
    });

    return res.status(200).json({ id: session.id });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
}
