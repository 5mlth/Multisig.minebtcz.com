const STREAMS = {
  BP: { address: "t3cq6DPTZbVShmY5hs4NLJyBhTfw5KNZNcf", label: "BP Stream" },
  ZF: { address: "t3LUnrQk7pHJTvTyTVzdDHNVamMGfvXAi4k", label: "ZF Stream" },
  MG: { address: "t3URkWgiiYVNTAvKHy5HdPia3hft9byrsNz", label: "MG Stream" },
  CUSTOM: { address: "", label: "Custom Multisig" }
};

function $(id) { return document.getElementById(id); }
function fmt8(n) { return Number(n || 0).toFixed(8); }

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    ...options
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(data.error || data.message || data.raw || `HTTP ${res.status}`);
  return data;
}

function formatKb(bytes) {
  return Math.round(Number(bytes || 0) / 1000);
}

function consolidationSegments(h = {}) {
  const estimated = Math.max(Number(h.estimatedBytes || 0), 1);
  const max = Math.max(Number(h.maxBytes || 0), 1);

  if (estimated <= max) {
    return { green: 100, red: 0 };
  }

  const green = Math.max(0, Math.min(100, (max / estimated) * 100));
  const red = Math.max(0, 100 - green);
  return { green, red };
}

function healthStateLabel(state) {
  if (state === 'red') return 'CRITICAL';
  if (state === 'yellow') return 'WARNING';
  return 'HEALTHY';
}

function healthHtml(h = {}) {
  const state = h.state || 'green';
  const estimatedKb = formatKb(h.estimatedBytes);
  const maxKb = formatKb(h.maxBytes || 1);
  const overflowKb = formatKb(h.overflowBytes);
  const rounds = Number(h.consolidationRoundsNeeded || 0);
  const seg = consolidationSegments(h);

  const greenHtml = seg.green > 0
    ? `<div style="height:100%;width:${seg.green}%;background:linear-gradient(90deg,#16a34a,#4ade80);"></div>`
    : '';

  const redHtml = seg.red > 0
    ? `<div style="height:100%;width:${seg.red}%;background:linear-gradient(90deg,#dc2626,#ff5a52);"></div>`
    : '';

  return `
    <div style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="font-weight:800;font-size:18px;">Consolidation health</div>
        <div style="font-weight:900;font-size:18px;color:${state === 'red' ? '#ff6257' : state === 'yellow' ? '#f59e0b' : '#4ade80'};">${healthStateLabel(state)}</div>
      </div>

      <div style="display:flex;height:12px;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:#0d1117;margin-top:6px;">
        ${greenHtml}
        ${redHtml}
      </div>

      <div style="margin-top:12px;font-size:18px;line-height:1.45;">
        ${estimatedKb} KB / ${maxKb} KB · Overflow ${overflowKb} KB · ${rounds} consolidation ${rounds === 1 ? 'round' : 'rounds'} needed
      </div>

      <div class="small" style="margin-top:10px;color:var(--muted);font-size:13px;line-height:1.35;">
        Green shows safe capacity. Red shows the share of the current load that exceeds the target window.
      </div>
    </div>`;
}

function keyholdersHtml(items = []) {
  return items.map((k) => `
    <div style="margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,0.02);">
      <div style="font-weight:800;margin-bottom:4px;">K${k.slot} last sign</div>
      <div class="small" style="font-size:16px;">${k.lastSignedAt ? new Date(k.lastSignedAt).toLocaleString() : 'Never'}</div>
    </div>
  `).join('');
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
    <div class="row"><span>Address</span><span class="mono" id="customAddress">dynamic</span></div>
    <div class="row"><span>Balance</span><strong id="customBalance">custom</strong></div>
    <div class="row"><span>UTXO</span><span id="customUtxos">custom</span></div>
    <div class="row"><span>Status</span><span id="customStatus" class="pill">dynamic</span></div>
    <div id="customHealth"></div>
    <div id="customKeyholders" style="margin-top:10px"></div>
    <div style="margin-top:18px;"><a class="btn" href="stream.html?stream=CUSTOM">Open CUSTOM</a></div>
    <div class="small" style="margin-top:14px;color:var(--muted);">Review order flow, signatures, and broadcast state</div>`;
  host.appendChild(card);
}

function setStreamCard(key, s = {}) {
  const lower = key.toLowerCase();
  $(`${lower}Address`).textContent = STREAMS[key].address;
  $(`${lower}Balance`).textContent = `${fmt8(s.balance)} BTCZ`;
  $(`${lower}Utxos`).textContent = String(s.utxoCount || 0);
  $(`${lower}Status`).textContent = s.status || 'idle';
  $(`${lower}Health`).innerHTML = healthHtml(s.health || {});
  $(`${lower}Keyholders`).innerHTML = keyholdersHtml(s.keyholders || []);
}

async function loadDashboard() {
  try {
    ensureCustomCard();
    const data = await fetchJson(`/api/streams/summary?_=${Date.now()}`);
    const streams = data.streams || {};

    for (const key of ['BP', 'ZF', 'MG']) {
      setStreamCard(key, streams[key] || {});
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
  } catch (err) {
    console.error('dashboard error:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadDashboard();

  // second pass shortly after first paint
  setTimeout(loadDashboard, 800);

  // normal refresh loop
  setInterval(loadDashboard, 15000);
});

window.addEventListener('pageshow', () => {
  loadDashboard();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadDashboard();
});
