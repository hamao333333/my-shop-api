// api/get-komoju-session.js
// KOMOJU Sessionの状態を取得してフロントへ返す（secretキーを隠すため）
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const KOMOJU_SECRET_KEY = process.env.KOMOJU_SECRET_KEY;
  if (!KOMOJU_SECRET_KEY) {
    return json(res, 500, { error: "Server misconfigured", detail: "KOMOJU_SECRET_KEY missing" });
  }

  const sessionId = String(req.query.session_id || "").trim();
  if (!sessionId) {
    return json(res, 400, { error: "session_id is required" });
  }

  try {
    const r = await fetch(`https://komoju.com/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`${KOMOJU_SECRET_KEY}:`).toString("base64"),
      },
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return json(res, 502, { error: "KOMOJU session fetch failed", status: r.status, data });
    }

    // 必要最小限だけ返す
    return json(res, 200, {
      session_id: data.id,
      status: data.status,       // ここが肝
      amount: data.amount,
      currency: data.currency,
      payment_method: data.payment_method || null,
    });
  } catch (e) {
    return json(res, 502, { error: "Network error", detail: String(e?.message || e) });
  }
};
