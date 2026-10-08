(() => {
  if (window.__aiCommentHelper) return;
  window.__aiCommentHelper = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_X = /(^|\.)(x|twitter)\.com$/.test(HOST);

  let target = null; // current editable element
  let host, root, btn, panel;
  let hideTimer = null;
  let lastResult = "";
  let lastAction = "reply";

  // ---------- site filter ----------
  let enabled = false;
  chrome.storage.local.get(["sites"], ({ sites }) => {
    enabled = (sites || "")
      .split(/\s+/)
      .filter(Boolean)
      .some((s) => HOST === s || HOST.endsWith("." + s));
  });

  // ---------- helpers ----------
  function editableRoot(el) {
    if (!el || !(el instanceof Element)) return null;
    if (el.tagName === "TEXTAREA") return el;
    if (el.isContentEditable) {
      let r = el;
      while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
      return r;
    }
    return null;
  }

  function getText(el) {
    return (el.tagName === "TEXTAREA" ? el.value : el.innerText || "").trim();
  }

  function setText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // select everything that is already in the editor
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    // 1) synthetic paste: handled natively by Draft.js (X), Lexical (Facebook), Quill (LinkedIn)
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (ev.defaultPrevented) return;

    // 2) editors that don't handle paste: execCommand keeps their internal state in sync
    if (document.execCommand("insertText", false, text)) return;

    // 3) last resort
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function clean(t, max = 4000) {
    t = (t || "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  // ---------- reading the post ----------
  function tweetText(article) {
    if (!article) return "";
    const name = article.querySelector('[data-testid="User-Name"]');
    const body = article.querySelector('[data-testid="tweetText"]');
    const author = name ? name.innerText.split("\n").slice(0, 2).join(" ") : "";
    return (author ? author + ":\n" : "") + (body ? body.innerText : article.innerText);
  }

  function readContextX(el) {
    // reply modal: the tweet being replied to is inside the same dialog
    const dlg = el.closest('[role="dialog"]');
    if (dlg) {
      const arts = dlg.querySelectorAll('article[data-testid="tweet"]');
      if (arts.length) return { post: clean(tweetText(arts[arts.length - 1]), 3000), replyTo: "" };
    }
    // status page inline reply: the focused tweet has tabindex="-1"
    const focal =
      document.querySelector('article[data-testid="tweet"][tabindex="-1"]') ||
      document.querySelector('article[data-testid="tweet"]');
    if (focal && location.pathname.includes("/status/")) {
      return { post: clean(tweetText(focal), 3000), replyTo: "" };
    }
    // home timeline composer ("What's happening?"): no post to read
    return { post: "", replyTo: "" };
  }

  const ARTICLE_SEL = [
    '[role="article"]',
    "article",
    ".feed-shared-update-v2", // LinkedIn
    "shreddit-post", // Reddit
    "ytd-comment-thread-renderer"
  ].join(",");

  function readContext(el) {
    if (IS_X) return readContextX(el);
    const draft = getText(el);
    const articles = [];
    let n = el.parentElement;
    while (n && n !== document.body) {
      if (n.matches && n.matches(ARTICLE_SEL)) articles.push(n);
      n = n.parentElement;
    }
    let post = "", replyTo = "";
    const strip = (node) => {
      const t = node.innerText || "";
      return draft ? t.replace(draft, "") : t;
    };
    if (articles.length) {
      post = strip(articles[articles.length - 1]);
      if (articles.length > 1) replyTo = strip(articles[0]);
    } else {
      const dlg = el.closest('[role="dialog"]');
      if (dlg) post = strip(dlg);
      else {
        let a = el.parentElement;
        while (a && a !== document.body && (a.innerText || "").length < 400) a = a.parentElement;
        post = a ? strip(a) : "";
      }
    }
    return { post: clean(post, 5000), replyTo: clean(replyTo, 1500) };
  }

  // ---------- UI ----------
  const ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

  function buildUI() {
    host = document.createElement("div");
    host.id = "ai-comment-helper-host";
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .btn {
    position: fixed; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
    background: #1e1e20; color: #e6e6e6; border: 1px solid #3a3a3d;
    box-shadow: 0 1px 4px rgba(0,0,0,.35); display: none; align-items: center; justify-content: center; padding: 0;
  }
  .btn:hover { background: #2a2a2d; color: #fff; }
  .panel {
    position: fixed; width: 360px; max-width: calc(100vw - 16px); display: none;
    background: #1a1a1c; color: #e6e6e6; border: 1px solid #333336; border-radius: 10px; padding: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.5); font-size: 13px;
  }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 600; font-size: 13px; }
  .head .x { cursor: pointer; border: none; background: none; font-size: 15px; color: #8a8a8e; padding: 0 2px; }
  .head .x:hover { color: #e6e6e6; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  button.a {
    flex: 1 1 auto; border: 1px solid #333336; border-radius: 6px; padding: 7px 9px; cursor: pointer; font-size: 12.5px;
    background: #242427; color: #e6e6e6; font-weight: 500;
  }
  button.a:hover { background: #2e2e32; border-color: #45454a; }
  button.a:disabled { opacity: .5; cursor: default; }
  button.primary { background: #e6e6e6; color: #141415; border-color: #e6e6e6; font-weight: 600; }
  button.primary:hover { background: #fff; border-color: #fff; }
  textarea, select {
    width: 100%; border: 1px solid #333336; border-radius: 6px; padding: 6px 8px; font-size: 12.5px; resize: vertical;
    background: #242427; color: #e6e6e6;
  }
  textarea:focus, select:focus { outline: none; border-color: #6b6b70; }
  label { font-size: 11.5px; color: #8a8a8e; display: block; margin: 2px 0 4px; }
  .result { white-space: pre-wrap; background: #111112; border: 1px solid #2a2a2d; border-radius: 6px; padding: 8px; margin-bottom: 8px; max-height: 220px; overflow: auto; line-height: 1.45; }
  .count { font-size: 11px; color: #8a8a8e; text-align: right; margin: -4px 0 8px; }
  .count.over { color: #e5534b; }
  .ctx { font-size: 11px; color: #8a8a8e; margin-bottom: 8px; cursor: pointer; }
  .ctx:hover { color: #c8c8cc; }
  .ctxbox { display: none; font-size: 11px; white-space: pre-wrap; max-height: 120px; overflow: auto; color: #b0b0b4; border-left: 2px solid #45454a; padding-left: 8px; margin-bottom: 8px; }
  .err { color: #e5534b; margin-bottom: 8px; }
  .err a { color: #e6e6e6; }
  .loading { color: #b0b0b4; margin-bottom: 8px; }
  .spin { display: inline-block; width: 11px; height: 11px; border: 2px solid #8a8a8e; border-top-color: transparent; border-radius: 50%; animation: s .7s linear infinite; vertical-align: -1px; margin-right: 6px; }
  @keyframes s { to { transform: rotate(360deg); } }
  .hidden { display: none !important; }
</style>
<button class="btn" title="AI βοηθός σχολίων">${ICON}</button>
<div class="panel">
  <div class="head"><span>Βοηθός σχολίων</span><button class="x" title="Κλείσιμο">✕</button></div>
  <div class="row">
    <button class="a primary" data-act="reply">Γράψε απάντηση</button>
    <button class="a" data-act="improve">Βελτίωσε</button>
  </div>
  <div class="row">
    <button class="a" data-act="to_el">Σε Ελληνικά</button>
    <button class="a" data-act="to_en">In English</button>
  </div>
  <label>Ύφος</label>
  <select class="tone" style="margin-bottom:8px">
    <option value="friendly">Φιλικό</option>
    <option value="professional">Επαγγελματικό</option>
    <option value="supportive">Υποστηρικτικό</option>
    <option value="funny">Χιουμοριστικό</option>
    <option value="short">Πολύ σύντομο</option>
  </select>
  <label>Οδηγίες (προαιρετικά), π.χ. «συμφώνησε και ρώτα για τιμή»</label>
  <textarea class="instr" rows="2" style="margin-bottom:8px"></textarea>
  <div class="ctx">Post: <span class="ctxlen"></span> · προβολή</div>
  <div class="ctxbox"></div>
  <div class="status"></div>
  <div class="out hidden">
    <div class="result"></div>
    <div class="count"></div>
    <div class="row">
      <button class="a primary" data-do="insert">Εισαγωγή</button>
      <button class="a" data-do="again">Ξανά</button>
      <button class="a" data-do="copy">Αντιγραφή</button>
    </div>
  </div>
</div>`;
    document.documentElement.appendChild(host);
    btn = root.querySelector(".btn");
    panel = root.querySelector(".panel");

    // keep focus in the editor when clicking the button
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", togglePanel);
    root.querySelector(".x").addEventListener("click", closePanel);
    root.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", () => run(b.dataset.act))
    );
    root.querySelector(".ctx").addEventListener("click", () => {
      const box = root.querySelector(".ctxbox");
      box.style.display = box.style.display === "block" ? "none" : "block";
      placePanel();
    });
    root.querySelector('[data-do="insert"]').addEventListener("click", () => {
      const t = target;
      const text = lastResult;
      closePanel(false);
      if (t && text) setText(t, text);
    });
    root.querySelector('[data-do="again"]').addEventListener("click", () => run(lastAction));
    root.querySelector('[data-do="copy"]').addEventListener("click", (e) => {
      navigator.clipboard.writeText(lastResult);
      e.target.textContent = "Αντιγράφηκε";
      setTimeout(() => (e.target.textContent = "Αντιγραφή"), 1200);
    });
    // don't let the host page react to keys typed inside our panel (X shortcuts etc.)
    ["keydown", "keyup", "keypress"].forEach((t) =>
      panel.addEventListener(t, (e) => e.stopPropagation())
    );
    root.querySelector(".tone").addEventListener("change", (e) =>
      chrome.storage.local.set({ lastTone: e.target.value })
    );
    chrome.storage.local.get("lastTone", ({ lastTone }) => {
      if (lastTone) root.querySelector(".tone").value = lastTone;
    });
  }

  function isOpen() {
    return panel && panel.style.display === "block";
  }

  function position() {
    if (!target || !btn) return;
    const r = target.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) {
      btn.style.display = "none";
      return;
    }
    if (btn.style.display === "none" && !isOpen() && document.activeElement !== target && !target.contains(document.activeElement)) return;
    btn.style.display = "flex";
    // vertically centred on the first line, just outside the right edge when there is room
    const top = Math.max(4, r.top + Math.min(r.height, 36) / 2 - 14);
    const outside = r.right + 6 + 28 < innerWidth - 4;
    const left = outside ? r.right + 6 : Math.min(innerWidth - 34, r.right - 34);
    btn.style.top = top + "px";
    btn.style.left = left + "px";
    if (isOpen()) placePanel();
  }

  function placePanel() {
    const b = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 360, h = panel.offsetHeight || 300;
    const left = Math.min(innerWidth - w - 8, Math.max(8, b.right - w));
    let top = b.bottom + 8;
    if (top + h > innerHeight - 8) top = b.top - h - 8;
    if (top < 8) top = Math.max(8, innerHeight - h - 8);
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  function showButton() {
    if (!host) buildUI();
    btn.style.display = "flex";
    position();
  }

  function charLimit() {
    return IS_X ? 280 : 0;
  }

  function togglePanel() {
    if (isOpen()) return closePanel();
    const ctx = readContext(target);
    root.querySelector(".ctxlen").textContent = ctx.post
      ? `${ctx.post.length} χαρακτήρες${ctx.replyTo ? " + σχόλιο που απαντάς" : ""}`
      : "δεν βρέθηκε";
    root.querySelector(".ctxbox").textContent =
      (ctx.replyTo ? "Απάντηση σε:\n" + ctx.replyTo + "\n\nPost:\n" : "") + (ctx.post || "—");
    root.querySelector(".ctxbox").style.display = "none";
    root.querySelector(".status").innerHTML = "";
    root.querySelector(".out").classList.add("hidden");
    panel.style.display = "block";
    placePanel();
  }

  function closePanel(refocus = true) {
    if (!panel) return;
    panel.style.display = "none";
    root.querySelector(".out").classList.add("hidden");
    root.querySelector(".status").innerHTML = "";
    if (refocus && target) target.focus();
  }

  function setBusy(busy) {
    root.querySelectorAll("button.a").forEach((b) => (b.disabled = busy));
  }

  async function run(action) {
    if (!target) return;
    lastAction = action;
    const draft = getText(target);
    const status = root.querySelector(".status");
    const out = root.querySelector(".out");
    if (action !== "reply" && !draft) {
      status.innerHTML = `<div class="err">Γράψε πρώτα κάτι στο πλαίσιο σχολίου.</div>`;
      return;
    }
    const ctx = readContext(target);
    status.innerHTML = `<div class="loading"><span class="spin"></span>Γράφω…</div>`;
    out.classList.add("hidden");
    setBusy(true);
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: "ai",
        action,
        draft,
        post: ctx.post,
        replyTo: ctx.replyTo,
        instructions: root.querySelector(".instr").value.trim(),
        tone: root.querySelector(".tone").value,
        maxChars: charLimit()
      });
    } catch (e) {
      res = { ok: false, error: "Το extension ανανεώθηκε, κάνε refresh τη σελίδα." };
    }
    setBusy(false);
    if (!res || !res.ok) {
      const err = (res && res.error) || "Άγνωστο σφάλμα";
      const needKey = /API key/i.test(err);
      status.innerHTML = `<div class="err">${escapeHtml(err)}${
        needKey ? ' <a href="#" class="opt">Άνοιγμα ρυθμίσεων</a>' : ""
      }</div>`;
      const a = status.querySelector(".opt");
      if (a) a.onclick = (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: "openOptions" }); };
      return;
    }
    lastResult = res.text;
    status.innerHTML = "";
    root.querySelector(".result").textContent = res.text;
    const lim = charLimit();
    const count = root.querySelector(".count");
    count.textContent = lim ? `${res.text.length}/${lim}` : `${res.text.length} χαρακτήρες`;
    count.classList.toggle("over", !!lim && res.text.length > lim);
    out.classList.remove("hidden");
    placePanel();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------- focus tracking ----------
  document.addEventListener(
    "focusin",
    (e) => {
      if (!enabled) return;
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (host && path.includes(host)) { clearTimeout(hideTimer); return; }
      const el = editableRoot(e.target);
      if (!el) return;
      clearTimeout(hideTimer);
      if (el !== target && isOpen()) closePanel(false);
      target = el;
      showButton();
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      if (!btn) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const a = document.activeElement;
        if (a === host || (target && target.contains(a))) return;
        if (isOpen()) return;
        btn.style.display = "none";
      }, 250);
    },
    true
  );

  // close panel on outside click
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!isOpen()) return;
      const path = e.composedPath();
      if (path.includes(host) || (target && path.includes(target))) return;
      closePanel(false);
      btn.style.display = "none";
    },
    true
  );

  addEventListener("scroll", position, true);
  addEventListener("resize", position);
  setInterval(() => {
    if (target && !target.isConnected) {
      target = null;
      if (btn) { btn.style.display = "none"; closePanel(false); }
    } else position();
  }, 400);
})();
