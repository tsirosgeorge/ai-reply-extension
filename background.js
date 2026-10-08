const DEFAULTS = {
  apiKey: "",
  model: "deepseek-chat",
  persona: "",
  sites: "facebook.com\nlinkedin.com\nx.com\ntwitter.com\ninstagram.com\nreddit.com\nyoutube.com\nthreads.net\nthreads.com"
};

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) missing[k] = v;
  await chrome.storage.local.set(missing);
  if (!cur.apiKey) chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === "ai") {
    runAI(msg)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true; // async response
  }
});

const TONES = {
  friendly: "φιλικό και φυσικό / friendly and natural",
  professional: "επαγγελματικό / professional",
  funny: "χιουμοριστικό, ελαφρύ / witty and light",
  short: "πολύ σύντομο (1-2 προτάσεις) / very short",
  supportive: "υποστηρικτικό, ζεστό / supportive and warm"
};

function buildMessages({ action, draft, post, replyTo, instructions, tone, persona, maxChars }) {
  const toneTxt = TONES[tone] || TONES.friendly;
  const system =
    "You are a writing assistant for social media comments. " +
    "You write in Greek or English. Output ONLY the final comment text: no quotes, no explanations, no preamble, no hashtags unless asked. " +
    "Sound human and natural, never robotic or overly formal. Do not use emojis excessively (at most one, and only if it fits). " +
    `Tone: ${toneTxt}.` +
    (maxChars ? ` Hard limit: the comment must be under ${maxChars} characters.` : "") +
    (persona ? `\nAbout the user who is writing (use only if relevant): ${persona}` : "");

  const ctx =
    (post ? `\n\n--- POST ---\n${post}` : "") +
    (replyTo ? `\n\n--- COMMENT BEING REPLIED TO ---\n${replyTo}` : "");

  let task;
  switch (action) {
    case "improve":
      task =
        "Improve the user's draft comment: fix grammar, spelling, accents (τόνους) and flow, make it clearer and better written. " +
        "Keep the SAME language and the same meaning/intent. Keep roughly the same length." +
        `\n\n--- DRAFT ---\n${draft}`;
      break;
    case "to_el":
      task = "Rewrite the user's draft as a well-written, natural comment in GREEK (Ελληνικά), keeping the meaning." + `\n\n--- DRAFT ---\n${draft}`;
      break;
    case "to_en":
      task = "Rewrite the user's draft as a well-written, natural comment in ENGLISH, keeping the meaning." + `\n\n--- DRAFT ---\n${draft}`;
      break;
    case "reply":
    default:
      task =
        "Write a comment replying to the post below" + (replyTo ? " (specifically replying to the quoted comment)" : "") + ". " +
        "Write it in the same language as the post unless instructed otherwise. Be relevant and specific to the content." +
        (draft ? `\n\nThe user already started writing this; use it as the basis/idea:\n${draft}` : "");
  }
  if (instructions) task += `\n\n--- USER INSTRUCTIONS (follow these) ---\n${instructions}`;
  if (action !== "reply" && (post || replyTo)) task += `\n\n(Context for reference only:)${ctx}`;
  else task += ctx;

  return [
    { role: "system", content: system },
    { role: "user", content: task }
  ];
}

async function runAI(msg) {
  const cfg = await chrome.storage.local.get(["apiKey", "model", "persona"]);
  if (!cfg.apiKey) throw new Error("Δεν έχεις βάλει DeepSeek API key (Ρυθμίσεις).");

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model || "deepseek-chat",
      messages: buildMessages({ ...msg, persona: cfg.persona }),
      temperature: msg.action === "reply" ? 0.9 : 0.4,
      max_tokens: 800
    })
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    if (res.status === 401) throw new Error("Λάθος API key (401).");
    if (res.status === 402) throw new Error("Δεν υπάρχει υπόλοιπο στο DeepSeek λογαριασμό (402).");
    throw new Error(`DeepSeek error ${res.status} ${detail}`);
  }
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content?.trim() || "";
  text = text.replace(/^["«“]+|["»”]+$/g, "").trim();
  if (!text) throw new Error("Κενή απάντηση από το DeepSeek.");
  return text;
}
