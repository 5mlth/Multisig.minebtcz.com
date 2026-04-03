const STREAMS = {
  BP: { address: "t3cq6DPTZbVShmY5hs4NLJyBhTfw5KNZNcf", label: "BP Stream" },
  ZF: { address: "t3LUnrQk7pHJTvTyTVzdDHNVamMGfvXAi4k", label: "ZF Stream" },
  MG: { address: "t3URkWgiiYVNTAvKHy5HdPia3hft9byrsNz", label: "MG Stream" },
  CUSTOM: { address: "", label: "Custom Multisig" }
};
function $(id) { return document.getElementById(id); }
function fmt8(n) { return Number(n || 0).toFixed(8); }
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.message || data.raw || `HTTP ${res.status}`);
  return data;
}
function healthHtml(h = {}) {
  const state = h.state || 'green';
  const pct = Number(h.percent || 0);
  return `
    <div class="small" style="margin-top:8px;">Consolidation health: <strong>${state}</strong></div>
    <div style="height:10px;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:#0d1117;margin-top:6px;">
      <div style="height:100%;width:${pct}%;background:${state === 'red' ? 'var(--danger)' : state === 'yellow' ? 'var(--warn)' : 'var(--ok)'};"></div>
    </div>
    <div class="small" style="margin-top:6px;">${Math.round((h.estimatedBytes || 0)/1000)} KB / ${Math.round((h.maxBytes || 1)/1000)} KB · overflow ${Math.round((h.overflowBytes || 0)/1000)} KB · rounds ${h.consolidationRoundsNeeded || 0}</div>`;
}
function keyholdersHtml(items = []) {
  return items.map((k) => `<div class="small">K${k.slot}: ${k.lastSignedAt ? new Date(k.lastSignedAt).toLocaleString() : 'never'}</div>`).join('');
}
function ensureCustomCard() {
  if ($("customStreamCard")) return;
  const host = $("streamCards");
  if (!host) return;
  const card = document.createElement("div");
  card.className = "stream-card";
  card.id = "customStreamCard";
  card.innerHTML = `
    <h2>Custom Multisig</h2>
    <div class="row"><span>Adresse</span><span class="mono" id="customAddress">dynamic</span></div>
    <div class="row"><span>Balance</span><strong id="customBalance">custom</strong></div>
    <div class="row"><span>UTXO</span><span id="customUtxos">custom</span></div>
    <div class="row"><span>État</span><span id="customStatus" class="pill">dynamic</span></div>
    <div id="customHealth"></div>
    <div id="customKeyholders" style="margin-top:10px"></div>
    <div style="margin-top:14px;"><a class="btn" href="stream.html?stream=CUSTOM">Open CUSTOM</a></div>`;
  host.appendChild(card);
}
async function loadDashboard() {
  try {
    ensureCustomCard();
    const data = await fetchJson("/api/streams/summary");
    const streams = data.streams || {};
    for (const key of ['BP','ZF','MG']) {
      const lower = key.toLowerCase();
      const s = streams[key] || {};
      $(`${lower}Address`).textContent = STREAMS[key].address;
      $(`${lower}Balance`).textContent = `${fmt8(s.balance)} BTCZ`;
      $(`${lower}Utxos`).textContent = String(s.utxoCount || 0);
      $(`${lower}Status`).textContent = s.status || 'idle';
      $(`${lower}Health`).innerHTML = healthHtml(s.health || {});
      $(`${lower}Keyholders`).innerHTML = keyholdersHtml(s.keyholders || []);
    }
    const custom = streams.CUSTOM || {};
    if ($("customAddress")) $("customAddress").textContent = custom.address || 'dynamic';
    if ($("customBalance")) $("customBalance").textContent = custom.status === 'dynamic' ? 'custom' : `${fmt8(custom.balance)} BTCZ`;
    if ($("customUtxos")) $("customUtxos").textContent = custom.status === 'dynamic' ? 'custom' : String(custom.utxoCount || 0);
    if ($("customStatus")) $("customStatus").textContent = custom.status || 'dynamic';
    if ($("customHealth")) $("customHealth").innerHTML = healthHtml(custom.health || {});
    if ($("customKeyholders")) $("customKeyholders").innerHTML = keyholdersHtml(custom.keyholders || []);
    const total = Number(streams.BP?.balance || 0) + Number(streams.ZF?.balance || 0) + Number(streams.MG?.balance || 0);
    $("grandTotal").textContent = `${fmt8(total)} BTCZ`;
  } catch (err) { console.error('dashboard error:', err); }
}
document.addEventListener('DOMContentLoaded', async () => { await loadDashboard(); setInterval(loadDashboard, 15000); });
