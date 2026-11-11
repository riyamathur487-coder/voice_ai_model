# Demo Script — Snapdeal Virtual KAM (1-2 min screen recording)

## Setup (before recording)
- Open Chrome → navigate to deployed URL
- Have microphone ready and system audio on

---

## Script (~90 seconds)

### [0:00–0:10] — Show the UI
*Pan across the screen*

**Narrate:** "This is the Snapdeal AI Virtual KAM. On the left is the seller's
dashboard with this month's real data — sales are down 32.5%, cancellations
nearly doubled, and 18 SKUs are out of stock. All assumptions are listed at the
bottom. The API key is never in the browser — it's on the server."

---

### [0:10–0:20] — Start the call
*Click "Start Call" button*

**Bot speaks:** "Hi Rahul! I'm Priya, your Virtual KAM at Snapdeal. I've
reviewed your account and I'm genuinely worried — your sales dropped to one
lakh thirty-five thousand rupees this month. I'd like to understand what's been
happening. What do you think is going on?"

---

### [0:20–0:40] — Seller responds, bot diagnoses
*Speak into mic:* "I'm not sure. I've been having trouble keeping products in
stock."

**Bot speaks:** "That's exactly what the data is showing, Rahul. You went from
five out-of-stock SKUs last month to eighteen this month — that's a 3.6 times
increase. When products aren't listed, buyers can't find you. And your
cancellation rate jumped from eight to fourteen percent, which is likely linked.
Can I ask — are the cancelled orders mostly for the same products that ran out?"

---

### [0:40–1:05] — Recommendation phase
*Speak:* "Yes, I think so. What should I do?"

**Bot speaks:** "Here's what I'd suggest. First, restock those eighteen SKUs
within the next three to five days — prioritise your top five sellers. Second,
run a quick audit on your cancelled orders to confirm they overlap with the
out-of-stock items and fix those listings. Third, once you're stocked up, run a
Snapdeal Preferred Seller promotion to recover your search ranking."

---

### [1:05–1:30] — End call, show summary modal
*Click "End Call"*

**Bot speaks summary**
*Summary modal appears on screen*

**Narrate:** "The bot generates a written and spoken summary — issues found,
actions to take, and timeline. This is the full flow: voice in, Gemini thinks,
voice out. The architecture is: Web Speech API for STT and TTS, Express proxy
to keep the API key secure, and Gemini 1.5 Flash as the LLM."

---

## Key points to emphasise in narration
1. Voice-first: everything is spoken, not just typed
2. Data-driven: the bot cites specific numbers, not generic advice
3. Proactive: Priya surfaces the stock-out problem before the seller explains it
4. Secure: API key is an environment variable on the server
5. Architecture is simple and explainable
