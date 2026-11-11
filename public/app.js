/**
 * Snapdeal Virtual KAM — app.js
 *
 * Voice pipeline:
 *   1. SpeechRecognition (Web Speech API, browser-native, Chrome/Edge)
 *   2. POST /api/chat  → Express proxy → Gemini 1.5 Flash
 *   3. SpeechSynthesis (Web Speech API, browser-native)
 *
 * Conversation state machine:
 *   IDLE → GREETING → DISCOVERING → DIAGNOSING → RECOMMENDING → SUMMARISING → ENDED
 */

"use strict";

/* ─── Constants ─────────────────────────────────────────────────────────────── */
const API_CHAT_URL        = "/api/chat";
const API_SELLER_DATA_URL = "/api/seller-data";

/* ─── State ─────────────────────────────────────────────────────────────────── */
let conversationHistory = [];   // [{role: "user"|"model", parts:[{text}]}]
let isCallActive   = false;
let isMuted        = false;
let isBotSpeaking  = false;
let recognition    = null;
let currentUtterance = null;
let sellerData     = null;
let conversationPhase = "idle"; // idle | active | ended

/* ─── DOM refs ───────────────────────────────────────────────────────────────── */
const btnCall       = document.getElementById("btn-call");
const btnEnd        = document.getElementById("btn-end");
const btnMute       = document.getElementById("btn-mute");
const btnModalClose = document.getElementById("btn-modal-close");
const statusPill    = document.getElementById("status-pill");
const statusText    = document.getElementById("status-text");
const transcript    = document.getElementById("transcript");
const waveform      = document.getElementById("waveform");
const avatarWrap    = document.getElementById("kam-avatar")?.closest(".avatar-wrap") || document.querySelector(".avatar-wrap");
const summaryModal  = document.getElementById("summary-modal");
const summaryBody   = document.getElementById("summary-body");
const metricsGrid   = document.getElementById("metrics-grid");
const storeLabel    = document.getElementById("store-label");
const assumeList    = document.getElementById("assume-list");
const apiStatus     = document.getElementById("api-status");
const browserWarn   = document.getElementById("browser-warn");

/* ═══════════════════════════════════════════════════════════════════════════
   INITIALISATION
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", async () => {
  checkBrowserSupport();
  await loadSellerData();
  setupEventListeners();
});

/** Check Chrome/Edge Speech Recognition support */
function checkBrowserSupport() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    browserWarn.hidden = false;
    btnCall.disabled = true;
  }
}

/** Pull seller data + assumptions from /api/seller-data */
async function loadSellerData() {
  try {
    const res = await fetch(API_SELLER_DATA_URL);
    sellerData = await res.json();
    renderDashboard(sellerData);
    updateApiStatus("ok", "API Connected ✓");
  } catch (err) {
    updateApiStatus("err", "Server offline");
    console.error("Could not load seller data:", err);
  }
}

/** Render metric cards and assumptions from server data */
function renderDashboard(data) {
  storeLabel.textContent = `${data.sellerName} · ${data.storeName} · ${data.category}`;

  const m = data.metrics;
  const metricDefs = [
    {
      label: "Sales (This Month)",
      current: `₹${formatINR(m.sales.current)}`,
      prev:    `₹${formatINR(m.sales.last)}`,
      change:  `−${data.derivedInsights.salesDropPct}%`,
      dir:     "down",
    },
    {
      label: "Orders",
      current: `${m.orders.current}`,
      prev:    `${m.orders.last}`,
      change:  `−${data.derivedInsights.ordersDropPct}%`,
      dir:     "down",
    },
    {
      label: "Cancellation Rate",
      current: `${m.cancellationRate.current}%`,
      prev:    `${m.cancellationRate.last}%`,
      change:  `+${m.cancellationRate.current - m.cancellationRate.last}pp`,
      dir:     "up",
    },
    {
      label: "Avg. Selling Price",
      current: `₹${m.avgSellingPrice.current}`,
      prev:    `₹${m.avgSellingPrice.last}`,
      change:  "No change",
      dir:     "flat",
    },
    {
      label: "Out-of-Stock SKUs",
      current: `${m.outOfStockSKUs.current}`,
      prev:    `${m.outOfStockSKUs.last}`,
      change:  `+${m.outOfStockSKUs.current - m.outOfStockSKUs.last} SKUs`,
      dir:     "up",
    },
  ];

  metricsGrid.innerHTML = metricDefs.map(d => `
    <div class="metric-card" role="listitem">
      <div class="metric-left">
        <span class="metric-label">${d.label}</span>
        <div class="metric-values">
          <span class="metric-current">${d.current}</span>
          <span class="metric-prev">${d.prev}</span>
        </div>
      </div>
      <span class="metric-badge ${d.dir === 'flat' ? 'badge-flat' : d.dir === 'down' ? 'badge-down' : 'badge-up'}">
        ${d.change}
      </span>
    </div>
  `).join("");

  assumeList.innerHTML = (data.assumptions || []).map(a => `<li>${a}</li>`).join("");
}

function formatINR(n) {
  return n.toLocaleString("en-IN");
}

function updateApiStatus(state, text) {
  apiStatus.className = `badge badge-${state === "ok" ? "ok" : state === "err" ? "err" : "warn"}`;
  apiStatus.textContent = text;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════════════════════════════════ */

function setupEventListeners() {
  btnCall.addEventListener("click", startCall);
  btnEnd.addEventListener("click", endCall);
  btnMute.addEventListener("click", toggleMute);
  btnModalClose.addEventListener("click", resetApp);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CALL LIFECYCLE
   ═══════════════════════════════════════════════════════════════════════════ */

async function startCall() {
  isCallActive = true;
  conversationPhase = "active";
  conversationHistory = [];

  // Swap buttons
  btnCall.hidden = true;
  btnEnd.hidden  = false;
  btnMute.hidden = false;
  btnEnd.disabled  = false;
  btnMute.disabled = false;

  // Clear transcript
  transcript.innerHTML = "";

  setStatus("call", "Call Connected");
  setAvatarState("ringing");

  // Kick off: ask Gemini to greet the seller (empty first user turn to trigger greeting)
  const greeting = await sendToLLM("Hello, I need help with my sales.");
  if (greeting) {
    addMessage("kam", greeting);
    speak(greeting, () => {
      if (isCallActive) startListening();
    });
  }
}

function endCall() {
  if (!isCallActive) return;

  // If bot is speaking, stop it
  if (currentUtterance) {
    window.speechSynthesis.cancel();
  }

  // Ask for a summary
  requestSummary();
}

function resetApp() {
  summaryModal.hidden = true;
  isCallActive = false;
  conversationPhase = "idle";
  conversationHistory = [];

  btnCall.hidden = false;
  btnEnd.hidden  = true;
  btnMute.hidden = true;
  btnCall.disabled = false;

  setStatus("idle", "Ready to call");
  setAvatarState("");
  setWaveform("");
  transcript.innerHTML = `<p class="transcript-placeholder">Start the call to begin your conversation with Priya.</p>`;
  isMuted = false;
  btnMute.classList.remove("muted");
  btnMute.textContent = "🎙️";
}

function toggleMute() {
  isMuted = !isMuted;
  btnMute.classList.toggle("muted", isMuted);
  btnMute.querySelector(".btn-icon") ? (btnMute.querySelector(".btn-icon").textContent = isMuted ? "🔇" : "🎙️") : null;
  if (isMuted && recognition) {
    recognition.stop();
    setStatus("call", "Muted");
  } else if (!isMuted && isCallActive && !isBotSpeaking) {
    startListening();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPEECH RECOGNITION (STT)
   ═══════════════════════════════════════════════════════════════════════════ */

function startListening() {
  if (!isCallActive || isMuted || isBotSpeaking) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";      // Indian English accent
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = "";
  let interimDiv = null;

  recognition.onstart = () => {
    setStatus("listen", "Listening…");
    setAvatarState("listening");
    setWaveform("listening");
  };

  recognition.onresult = (event) => {
    let interim = "";
    finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }

    // Show interim text in a temporary bubble
    if (!interimDiv) {
      interimDiv = document.createElement("div");
      interimDiv.className = "msg msg-user";
      interimDiv.innerHTML = `
        <div class="msg-avatar">🧑‍💼</div>
        <div class="msg-bubble interim-bubble" style="opacity:0.6; font-style:italic;"></div>
      `;
      transcript.appendChild(interimDiv);
    }
    interimDiv.querySelector(".msg-bubble").textContent = finalTranscript || interim;
    scrollTranscript();
  };

  recognition.onend = async () => {
    if (interimDiv) {
      interimDiv.remove();
      interimDiv = null;
    }

    if (!isCallActive) return;

    if (finalTranscript.trim()) {
      addMessage("user", finalTranscript.trim());
      setStatus("think", "Priya is thinking…");
      setAvatarState("");
      setWaveform("");
      showTypingIndicator();

      const reply = await sendToLLM(finalTranscript.trim());
      hideTypingIndicator();

      if (reply) {
        addMessage("kam", reply);
        speak(reply, () => {
          if (isCallActive) startListening();
        });
      }
    } else {
      // No speech detected — listen again
      if (isCallActive && !isMuted) startListening();
    }
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    if (event.error === "no-speech" && isCallActive && !isMuted) {
      startListening(); // Silently retry
    } else if (event.error !== "aborted") {
      setStatus("error", `Mic error: ${event.error}`);
    }
  };

  recognition.start();
}

/* ═══════════════════════════════════════════════════════════════════════════
   LLM CALL (via backend proxy)
   ═══════════════════════════════════════════════════════════════════════════ */

async function sendToLLM(userMessage) {
  // Push user message to history
  conversationHistory.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  try {
    const res = await fetch(API_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: conversationHistory }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Server error");
    }

    const data = await res.json();
    const reply = data.reply?.trim() || "";

    // Show which model actually replied in the nav badge
    if (data.model) {
      const aiBadge = document.querySelector(".badge-ai");
      if (aiBadge) aiBadge.textContent = `🤖 ${data.model}`;
    }

    // Push model reply to history
    if (reply) {
      conversationHistory.push({
        role: "model",
        parts: [{ text: reply }],
      });
    }

    return reply;
  } catch (err) {
    console.error("LLM error:", err);
    setStatus("error", "LLM error — check server");
    return "I'm sorry, I'm having trouble connecting right now. Please try again in a moment.";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPEECH SYNTHESIS (TTS)
   ═══════════════════════════════════════════════════════════════════════════ */

function speak(text, onDone) {
  if (!text) { onDone?.(); return; }
  if (!window.speechSynthesis) { onDone?.(); return; }

  // Stop any existing speech
  window.speechSynthesis.cancel();

  isBotSpeaking = true;
  setStatus("speak", "Priya is speaking…");
  setAvatarState("speaking");
  setWaveform("speaking");

  const utterance = new SpeechSynthesisUtterance(text);
  currentUtterance = utterance;

  // Pick the best available voice (English, preferably female)
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    (v.name.includes("Samantha") || v.name.includes("Google UK English Female") ||
     v.name.includes("Female") || v.name.includes("female") || v.name.includes("Neerja"))
    && v.lang.startsWith("en")
  ) || voices.find(v => v.lang.startsWith("en")) || voices[0];

  if (preferred) utterance.voice = preferred;
  utterance.lang  = "en-IN";
  utterance.rate  = 0.95;   // Slightly slower for natural KAM cadence
  utterance.pitch = 1.05;
  utterance.volume = 1.0;

  utterance.onend = () => {
    isBotSpeaking = false;
    currentUtterance = null;
    setWaveform("");
    setStatus("call", "Call Connected");
    setAvatarState("ringing");
    onDone?.();
  };

  utterance.onerror = (e) => {
    console.warn("TTS error:", e);
    isBotSpeaking = false;
    currentUtterance = null;
    setWaveform("");
    onDone?.();
  };

  // Chrome bug workaround: voices may not load immediately
  if (voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.speak(utterance);
    };
  } else {
    window.speechSynthesis.speak(utterance);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUMMARY (end of call)
   ═══════════════════════════════════════════════════════════════════════════ */

async function requestSummary() {
  isCallActive = false; // Prevent new listening cycles
  if (recognition) recognition.stop();
  window.speechSynthesis.cancel();

  setStatus("think", "Generating summary…");
  setAvatarState("");
  setWaveform("");
  btnEnd.disabled  = true;
  btnMute.disabled = true;

  showTypingIndicator();

  // Ask LLM for a structured spoken summary
  const summaryPrompt =
    "Please provide a final spoken summary now. Cover: the key issues you found, " +
    "the top 3 recommended actions, and the suggested timeline. Keep it under 80 words. " +
    "Speak naturally, no bullet points.";

  const summaryText = await sendToLLM(summaryPrompt);
  hideTypingIndicator();

  if (summaryText) {
    addMessage("kam", summaryText);
    // Render summary modal
    renderSummaryModal(summaryText);
    speak(summaryText, () => {
      summaryModal.hidden = false;
      conversationPhase = "ended";
    });
  } else {
    summaryModal.hidden = false;
  }

  setStatus("idle", "Call Ended");
}

function renderSummaryModal(spokenSummary) {
  const issues = [
    `Sales dropped 32.5% (₹2,00,000 → ₹1,35,000) this month`,
    `Out-of-stock SKUs tripled: 5 → 18 (primary driver)`,
    `Cancellation rate nearly doubled: 8% → 14%`,
    `Pricing unchanged (₹500) — not a pricing problem`,
  ];
  const actions = [
    `Restock 18 out-of-stock SKUs within 3–5 days; prioritise top-selling items first`,
    `Audit whether cancelled orders overlap with OOS SKUs; fix listings accuracy`,
    `Run a Snapdeal Preferred Seller promotion to recover search ranking & visibility`,
  ];

  summaryBody.innerHTML = `
    <div class="summary-section">
      <div class="summary-label">🔍 Issues Identified</div>
      <ul>${issues.map(i => `<li>${i}</li>`).join("")}</ul>
    </div>
    <div class="summary-section">
      <div class="summary-label">✅ Recommended Actions</div>
      <ul>${actions.map(a => `<li>${a}</li>`).join("")}</ul>
    </div>
    <div class="summary-section">
      <div class="summary-label">🗣️ Priya's Spoken Summary</div>
      <p style="font-style:italic;color:rgba(240,242,247,0.75)">"${spokenSummary}"</p>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Add a chat bubble to the transcript */
function addMessage(role, text) {
  const isKam = role === "kam";
  const div = document.createElement("div");
  div.className = `msg msg-${isKam ? "kam" : "user"}`;
  div.innerHTML = `
    <div class="msg-avatar">${isKam ? "👩‍💼" : "🧑‍💼"}</div>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;
  transcript.appendChild(div);
  scrollTranscript();
}

let typingEl = null;
function showTypingIndicator() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "msg msg-kam";
  typingEl.innerHTML = `
    <div class="msg-avatar">👩‍💼</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  transcript.appendChild(typingEl);
  scrollTranscript();
}
function hideTypingIndicator() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

function scrollTranscript() {
  transcript.scrollTop = transcript.scrollHeight;
}

/** Set status pill text + colour class */
function setStatus(state, text) {
  statusPill.className = `status-pill state-${state}`;
  statusText.textContent = text;
}

/** Set avatar ring animation class */
function setAvatarState(state) {
  avatarWrap.className = "avatar-wrap";
  if (state) avatarWrap.classList.add(state);
}

/** Set waveform animation class */
function setWaveform(state) {
  waveform.className = "waveform";
  if (state) {
    waveform.classList.add("active", state);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
