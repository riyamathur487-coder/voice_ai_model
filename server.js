/**
 * Snapdeal Virtual KAM – Backend Proxy Server
 *
 * This Express server acts as a secure proxy between the browser and the
 * Gemini API. The API key NEVER leaves the server — it is read from the
 * GEMINI_API_KEY environment variable.
 *
 * Routes
 *   POST /api/chat   — Send a conversation turn to Gemini, receive a reply
 *   GET  /           — Serve the static frontend files from /public
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Serve frontend ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ─── Groq client ──────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Seller data injected into every system prompt ───────────────────────────
// Source: Snapdeal AI First Intern assignment brief (mock data, clearly labelled)
const SELLER_DATA = {
  sellerName: "Rahul Sharma",          // Assumption: seller name for personalisation
  storeName: "RS Electronics",         // Assumption: store name
  category: "Consumer Electronics",   // Assumption: product category
  metrics: {
    sales:           { last: 200000, current: 135000, unit: "INR" },
    orders:          { last: 400,    current: 270,    unit: "count" },
    cancellationRate:{ last: 8,      current: 14,     unit: "percent" },
    avgSellingPrice: { last: 500,    current: 500,    unit: "INR" },
    outOfStockSKUs:  { last: 5,      current: 18,     unit: "count" },
  },
  // Pre-computed insights fed to the LLM as facts it can cite naturally
  derivedInsights: {
    salesDropPct:          32.5,   // (200000-135000)/200000
    ordersDropPct:         32.5,
    cancellationRiseRatio: 1.75,   // 14/8
    stockOutRiseRatio:     3.6,    // 18/5
    revenueGapINR:         65000,  // 200000-135000
  },
};

// ─── KAM System Prompt ───────────────────────────────────────────────────────
function buildSystemPrompt() {
  const d = SELLER_DATA;
  const m = d.metrics;
  const ins = d.derivedInsights;

  return `You are Priya, a warm, sharp, and empathetic Virtual Key Account Manager (KAM) at Snapdeal.
You are speaking DIRECTLY with ${d.sellerName}, who runs "${d.storeName}" (${d.category}) on Snapdeal.

## Your personality
- Confident and proactive — you spot problems and take ownership.
- Warm, never robotic. Use natural spoken language. Keep sentences short (8-15 words max per sentence).
- You NEVER say "as an AI" or "I cannot". You always try.
- You ask ONE focused question at a time, then wait for the seller's answer.

## Seller's business data (this month vs last month)
- Sales: ₹${(m.sales.current/100).toFixed(0)*100} ← down from ₹${m.sales.last.toLocaleString('en-IN')} (−${ins.salesDropPct}%)
- Orders: ${m.orders.current} ← down from ${m.orders.last} (−${ins.ordersDropPct}%)
- Cancellation rate: ${m.cancellationRate.current}% ← up from ${m.cancellationRate.last}% (nearly doubled)
- Average selling price: ₹${m.avgSellingPrice.current} (unchanged — pricing is NOT the problem)
- Out-of-stock SKUs: ${m.outOfStockSKUs.current} ← up from ${m.outOfStockSKUs.last} (3.6× increase)

## Key diagnoses you should surface naturally during conversation
1. STOCK-OUTS (Primary): 18 SKUs out-of-stock vs 5 last month. This directly reduces listings and kills conversions.
2. CANCELLATIONS (Secondary): Rate nearly doubled (8% → 14%). Causes: late dispatch, stockout at fulfillment, inaccurate listings.
3. VISIBILITY (Downstream): Fewer active listings + high cancellations hurt Snapdeal's search ranking for the store.

## Recommended actions you should guide the seller toward
1. Restock the 18 out-of-stock SKUs within 3–5 days. Prioritise top-selling SKUs first.
2. Audit why cancellations doubled — check whether cancelled orders overlap with the out-of-stock SKUs.
3. Run a Snapdeal Preferred Seller promotion or discount on fast-moving SKUs to boost visibility and recover ranking.

## Conversation flow — follow this STRICTLY
PHASE 1 – GREET: Introduce yourself. Mention you've reviewed their account. Express concern.
PHASE 2 – DISCOVER: Ask what they think caused the drop. Listen. Ask one follow-up about stock or fulfillment.
PHASE 3 – DIAGNOSE: Surface the top 2–3 insights from the data. Use specific numbers.
PHASE 4 – RECOMMEND: Give 2–3 clear, actionable steps. Be concrete (e.g. "within 3–5 days", "top 5 SKUs first").
PHASE 5 – SUMMARISE: When the seller says goodbye or asks for a summary, speak a 4–6 sentence closing summary covering: issues found, actions to take, expected timeline. End warmly.

## Critical speaking rules (for Text-to-Speech)
- No markdown, no bullet points, no asterisks in your replies.
- Use plain spoken sentences only.
- Keep each reply under 60 words unless delivering the final summary.
- Do not list multiple questions at once.
- Spell out numbers naturally: say "one lakh thirty-five thousand rupees" not "₹1,35,000".

## Assumptions made (state these if asked)
- Seller name: ${d.sellerName} (assumed for personalisation)
- Store name: ${d.storeName} (assumed)
- Category: ${d.category} (assumed)
- Root cause: stock-outs as primary driver (inferred from data pattern)
- All other data is exactly as provided in the assignment brief.`;
}

// ─── POST /api/chat ──────────────────────────────────────────────────────────
const GROQ_MODEL = "qwen/qwen3.8-27b"; // ✅ confirmed available & free on Groq

app.post("/api/chat", async (req, res) => {
  const { history } = req.body;

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured on server." });
  }

  // Convert Gemini-format history to OpenAI/Groq format
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map(h => ({
      role: h.role === "model" ? "assistant" : "user",
      content: h.parts[0].text,
    }))
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.75,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "";

    if (!reply) {
      return res.status(500).json({ error: "Empty response from Groq" });
    }

    console.log(`✅ Groq (${GROQ_MODEL}): ${reply.slice(0, 80)}`);
    return res.json({ reply, model: GROQ_MODEL });

  } catch (err) {
    const errMsg = err.message || "Groq API error";
    console.error("Groq error:", errMsg.slice(0, 100));
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/seller-data — expose non-sensitive seller data to frontend ──────
app.get("/api/seller-data", (_req, res) => {
  res.json({
    sellerName: SELLER_DATA.sellerName,
    storeName: SELLER_DATA.storeName,
    category: SELLER_DATA.category,
    metrics: SELLER_DATA.metrics,
    derivedInsights: SELLER_DATA.derivedInsights,
    assumptions: [
      "Seller name 'Rahul Sharma' — assumed for personalisation (not in brief)",
      "Store name 'RS Electronics' — assumed for personalisation",
      "Category 'Consumer Electronics' — assumed; affects recommendations",
      "Root cause identified as stock-outs — inferred from 3.6× OOS increase",
      "All five metrics are exactly as provided in the assignment brief",
    ],
  });
});

// ─── Fallback: serve index.html for all unknown routes (SPA) ─────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Snapdeal Virtual KAM running at http://localhost:${PORT}`);
  console.log(`   API key configured: ${process.env.GROQ_API_KEY ? "✅ Yes" : "❌ No — set GROQ_API_KEY in .env"}\n`);
});
