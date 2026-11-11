# Snapdeal Virtual KAM — Technical Note

**Candidate:** Shivansh Pandey | **Assignment:** AI First Intern

---

## 1. AI Model

| Component | Model / Service | Why |
|---|---|---|
| **LLM (Brain)** | Google Gemini 1.5 Flash | Free tier, low-latency, strong instruction following, 1M token context window |
| **STT** | Web Speech API (`SpeechRecognition`) — browser-native | No API key, no cost, works in Chrome/Edge, supports `en-IN` locale |
| **TTS** | Web Speech API (`SpeechSynthesis`) — browser-native | Zero-latency, no cost, selects best available female voice (Samantha / Neerja) |

---

## 2. Architecture

```
Browser (Chrome / Edge)
│
├── Microphone → SpeechRecognition API  ──→  User speech transcribed locally
│
├── fetch POST /api/chat  ──────────────→  Express.js proxy server (Node.js)
│                                               │
│                                               └── GEMINI_API_KEY (env var)
│                                                   ↓
│                                           Google Gemini 1.5 Flash API
│                                                   │
├── ← JSON { reply }  ←─────────────────────────────┘
│
└── SpeechSynthesis API  ──────────────→  Bot speaks response aloud
```

**Key security decision:** The Gemini API key lives **only** on the server in an environment variable. The browser never sees it. The `/api/chat` endpoint is the only public surface.

---

## 3. Voice Workflow (Turn-by-turn)

```
START CALL
    │
    ▼
Bot greeted by LLM (first turn triggered automatically)
    │
    ▼
SpeechRecognition.start()  → user speaks
    │
    ▼
SpeechRecognition.onresult (interim) → show live text in transcript
SpeechRecognition.onend   (final)   → capture finalTranscript
    │
    ▼
POST /api/chat  { history: [...all turns...] }
    │
    ▼
Server: build systemPrompt + call Gemini with full history
    │
    ▼
JSON reply → addMessage("kam") → SpeechSynthesis.speak()
    │
    ▼
utterance.onend → SpeechRecognition.start()  (loop until "End Call")
    │
    ▼
END CALL → LLM asked for spoken summary → modal + TTS
```

---

## 4. KAM Agent Design

The LLM is given a detailed **system prompt** that:

- Gives it the **exact mock data** from the brief (Sales, Orders, Cancellation Rate, ASP, OOS SKUs)
- Pre-computes derived insights (e.g., 32.5% sales drop, 3.6× OOS increase) so the bot can cite numbers naturally
- Assigns a persona: **Priya**, warm and proactive Snapdeal KAM
- Enforces a **5-phase conversation flow**: Greet → Discover → Diagnose → Recommend → Summarise
- Forbids markdown/bullet formatting in replies (critical for TTS to sound natural)
- Limits each reply to 60 words to maintain conversational pace

---

## 5. Seller Data and Assumptions

**Exact data from brief (unchanged):**

| Metric | Last Month | This Month |
|---|---|---|
| Sales | Rs 2,00,000 | Rs 1,35,000 |
| Orders | 400 | 270 |
| Cancellation Rate | 8% | 14% |
| Avg. Selling Price | Rs 500 | Rs 500 |
| Out-of-Stock SKUs | 5 | 18 |

**Assumptions added (clearly labelled in UI):**
1. Seller name: Rahul Sharma — assumed for personalisation
2. Store name: RS Electronics — assumed
3. Category: Consumer Electronics — assumed; affects recommendation logic
4. Root cause: Stock-outs identified as primary driver (inferred from 3.6x OOS increase + unchanged ASP)

---

## 6. Deployment

- **Platform:** Vercel (free tier) — single `vercel --prod` command
- **API key:** Stored as a Vercel environment secret (GEMINI_API_KEY), never in code
- **Frontend:** Served as static files from /public by the Express server
- **Browsers:** Chrome 90+ / Edge 90+ (required for Web Speech API)

---

## 7. What Makes This More Than a Q&A Bot

The KAM **owns the seller's problem** — it does not wait to be asked:

- It opens by saying "I have reviewed your account and I am concerned about what I am seeing"
- It references specific numbers unprompted ("your stock-outs tripled this month")
- It follows a structured diagnostic flow, not a generic Q&A loop
- It ends every call with a concrete, time-bound action plan
- The system prompt was designed so the LLM proactively surfaces issues before the seller even asks
