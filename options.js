const FIELDS = ["apiKey", "model", "persona", "sites"];
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(FIELDS, (cfg) => {
  for (const f of FIELDS) {
    if (cfg[f] === undefined) continue;
    $(f).value = cfg[f];
  }
});

$("save").addEventListener("click", async () => {
  const data = {};
  for (const f of FIELDS) data[f] = $(f).value.trim();
  await chrome.storage.local.set(data);

  const msg = $("msg");
  if (!data.apiKey) { msg.textContent = "Αποθηκεύτηκε (χωρίς API key)."; return; }
  msg.textContent = "Έλεγχος key…";
  try {
    const r = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${data.apiKey}` }
    });
    msg.textContent = r.ok ? "✓ Αποθηκεύτηκε – το key δουλεύει." : `Αποθηκεύτηκε, αλλά το key απέτυχε (${r.status}).`;
  } catch {
    msg.textContent = "Αποθηκεύτηκε (δεν μπόρεσα να ελέγξω το key).";
  }
});
