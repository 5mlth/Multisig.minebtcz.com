const STREAMS = {
  BP: { label: "BP Stream", address: "t3cq6DPTZbVShmY5hs4NLJyBhTfw5KNZNcf" },
  ZF: { label: "ZF Stream", address: "t3LUnrQk7pHJTvTyTVzdDHNVamMGfvXAi4k" },
  MG: { label: "MG Stream", address: "t3URkWgiiYVNTAvKHy5HdPia3hft9byrsNz" },
  CUSTOM: { label: "Custom Multisig", address: "" }
};

const HEX_LIMIT_BYTES = 2621440;
const UTXO_PAGE_SIZE = 100;
const state = {
  streamKey: "BP",
  utxos: [],
  orders: [],
  history: [],
  currentOrder: null,
  currentCli: null,
  utxoRenderCount: 0,
  historyOffset: 0,
  historyHasMore: false,
  historyTotal: 0,
  pinAuthorized: false
};

function ownerTokensKey() {
  return `btcz-multisig-owner-tokens-${state.streamKey}`;
}

function readOwnerTokens() {
  try {
    return JSON.parse(localStorage.getItem(ownerTokensKey()) || '{}') || {};
  } catch {
    return {};
  }
}

function writeOwnerTokens(map) {
  localStorage.setItem(ownerTokensKey(), JSON.stringify(map || {}));
}

function saveOwnerToken(orderId, ownerToken) {
  if (!orderId || !ownerToken) return;
  const map = readOwnerTokens();
  map[orderId] = ownerToken;
  writeOwnerTokens(map);
}

function getOwnerToken(orderId) {
  const map = readOwnerTokens();
  return map[orderId] || '';
}

function updateStreamType(order = null) {
  const el = $("streamType");
  if (!el) return;

  if (order && order.requiredSigs && order.totalKeys) {
    el.textContent = `${order.requiredSigs}of${order.totalKeys}`;
    return;
  }

  const redeem = isCustomStream()
    ? getValue("customRedeemScript", "")
    : "";

  if (redeem) {
    const first = redeem.trim().slice(0, 2).toLowerCase();
    const reqMap = { "51": 1, "52": 2, "53": 3, "54": 4, "55": 5, "56": 6 };
    const required = reqMap[first] || "?";
    const total = (redeem.match(/21[0-9a-fA-F]{66}/g) || []).length || 3;
    el.textContent = `${required}of${total}`;
    return;
  }

  el.textContent = "-";
}
function qs(key) {
  return new URLSearchParams(location.search).get(key);
}

function $(id) {
  return document.getElementById(id);
}

function getValue(id, fallback = "") {
  return $(id) ? String($(id).value ?? fallback).trim() : fallback;
}

function setValue(id, value) {
  if ($(id)) $(id).value = value ?? "";
}

function setText(id, value) {
  if ($(id)) $(id).textContent = value ?? "";
}

function currentOrderPin() {
  return getValue('orderPinInput', '');
}

function setOrderPinUi(order = null) {
  const display = $('orderPinDisplay');
  const ownerHint = $('orderOwnerHint');
  const input = $('orderPinInput');
  const customInput = $('customPin');
  const pin = String(order?.pin || '').trim();
  const ownerAuthorized = !!order?.ownerAuthorized;

  state.pinAuthorized = ownerAuthorized;

  if (display) display.textContent = pin && ownerAuthorized ? pin : '---';
  if (ownerHint) ownerHint.textContent = ownerAuthorized ? 'Owner session active. PIN restored.' : 'Enter the order PIN to unlock submit, finalize, broadcast, or delete.';
  if (ownerHint) {
    ownerHint.textContent = ownerAuthorized
      ? 'Owner session active. PIN restored.'
      : (state.pinAuthorized
          ? 'PIN accepted. Submit, finalize, broadcast, or delete are now unlocked.'
          : 'Enter the order PIN to unlock submit, finalize, broadcast, or delete.');
  }
  if (input && ownerAuthorized && pin) input.value = pin;
  if (customInput && !state.currentOrder) customInput.value = '';
}

async function refreshPinAuthority() {
  const orderId = getValue('currentOrderId', '');
  if (!orderId) {
    state.pinAuthorized = false;
    applyOrderUiState(state.currentOrder || { signedCount: 0, requiredSigs: 2, totalKeys: 3 });
    return;
  }

  try {
    const data = await postJson(`/api/stream/${state.streamKey}/order/${orderId}/access`, {
      pin: currentOrderPin(),
      ownerToken: getOwnerToken(orderId)
    });

    state.pinAuthorized = !!(data?.ownerAuthorized || data?.pinAccepted);
    if (data?.order) {
      state.currentOrder = data.order;
      setOrderPinUi(data.order);
    }
  } catch {
    state.pinAuthorized = false;
  }

  applyOrderUiState(state.currentOrder || { signedCount: 0, requiredSigs: 2, totalKeys: 3 });
}

function setStreamAddressDisplay(address) {
  const el = $("streamAddress");
  if (!el) return;
  if (!address) { el.textContent = ""; return; }
  el.innerHTML = explorerLink("address", address, address);
}

function setTxidDisplay(txid) {
  const el = $("txidBox");
  if (!el) return;
  if (!txid || txid === '-') { el.textContent = '-'; return; }
  el.innerHTML = explorerLink("tx", txid, txid);
}
function setCurrentBlockDisplay(blockValue) {
  const input = $("currentBlockBox");
  const link = $("currentBlockLink");
  const val = String(blockValue || '').trim();
  if (input) input.value = val;
  if (!link) return;
  if (!val) {
    link.textContent = '';
    return;
  }
  link.innerHTML = explorerLink("block", val, `Open block ${val}`);
}



function fmt8(n) {
  return Number(n || 0).toFixed(8);
}

function explorerBase() {
  return "https://explorer.btcz.rocks";
}

function explorerLink(type, value, label = null) {
  const safe = String(value || '').trim();
  if (!safe || safe === '-') return '-';
  return `<a href="${explorerBase()}/${type}/${encodeURIComponent(safe)}" target="_blank" rel="noopener noreferrer" class="mono">${label || safe}</a>`;
}


function estimateBytes(inputCount, outputCount) {
  const base = 32;
  const perInput = 180;
  const perOutput = 60;
  return base + inputCount * perInput + outputCount * perOutput;
}

function hexByteLength(hex) {
  const clean = String(hex || "").trim();
  if (!clean) return 0;
  return Math.ceil(clean.length / 2);
}

function updateHexMeta() {
  const bytes = hexByteLength(getValue("unsignedHex", ""));
  const el = $("unsignedHexBytes");
  if (!el) return;

  el.textContent = `HEX bytes: ${bytes} / ${HEX_LIMIT_BYTES}`;
  if (bytes > HEX_LIMIT_BYTES) {
    el.classList.add("danger-text");
  } else {
    el.classList.remove("danger-text");
  }
}

function displayCLI(cli) {
  state.currentCli = cli || null;
  if (!cli) {
    setValue("cliLinuxCreate", "");
    setValue("cliLinuxSign", "");
    setValue("cliPSCreate", "");
    setValue("cliPSSign", "");
  state.currentCli = null;
    return;
  }

  setValue("cliLinuxCreate", cli.linuxCreate || "");
  setValue("cliLinuxSign", cli.linuxSign || "");
  setValue("cliPSCreate", cli.powershellCreate || "");
  setValue("cliPSSign", cli.powershellSign || "");
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || data.raw || `HTTP ${res.status}`);
  }
  return data;
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

async function deleteJson(url, body = null) {
  const options = { method: "DELETE" };
  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return fetchJson(url, options);
}

async function copyText(text) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    console.log("Copied");
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function modeIsConsolidate() {
  return getValue("txMode", "send") === "consolidate";
}

function isCustomStream() {
  return state.streamKey === "CUSTOM";
}

function getRuntimeStreamPayload() {
  if (!isCustomStream()) return {};
  return {
    address: getValue("customAddress", ""),
    redeemScript: getValue("customRedeemScript", "")
  };
}

function currentStreamAddress() {
  if (isCustomStream()) return getValue("customAddress", "");
  return STREAMS[state.streamKey].address;
}

function renderModeUi() {
  const consolidate = modeIsConsolidate();

  if ($("toAddress")) {
    $("toAddress").disabled = consolidate;
    if (consolidate) {
      $("toAddress").value = "";
      $("toAddress").placeholder = "Ignored in consolidate mode";
    } else {
      $("toAddress").placeholder = "t1...";
    }
  }

  if ($("selectedInfo") && consolidate) {
    $("selectedInfo").value = "CONSOLIDATE MODE\n- amount is ignored\n- destination is ignored\n- all selected inputs return to the same t3 address\n- inputs are swept until the current limit";
  }
}

function ensureCustomFields() {
  if ($("customStreamConfig")) return;

  const host = $("streamAddress")?.parentElement;
  if (!host) return;

  const box = document.createElement("div");
  box.id = "customStreamConfig";
  box.style.marginTop = "14px";
  box.innerHTML = `
    <div class="grid" style="margin-top:12px;">
      <div>
        <label for="customAddress">Custom Address</label>
        <input id="customAddress" class="mono" placeholder="t3..." />
      </div>
      <div>
        <label for="customRedeemScript">Custom RedeemScript</label>
        <input id="customRedeemScript" class="mono" placeholder="52... / 53..." />
      </div>
    </div>
    <div class="button-row">
      <button id="loadCustomBtn" type="button">Load Custom Multisig</button>
    </div>
  `;
  host.appendChild(box);
updateStreamType(null);
  $("loadCustomBtn")?.addEventListener("click", async () => {
    await loadStreamSummary();
    await loadUtxos();
    await loadOrders();
    await loadHistory();
    clearOrderFormOnly();
updateStreamType(state.currentOrder);
  });
}

function toggleCustomFields() {
  ensureCustomFields();
  const box = $("customStreamConfig");
  if (!box) return;
  box.style.display = isCustomStream() ? "block" : "none";
}

async function loadStreamSummary() {
  const stream = state.streamKey;

  if (isCustomStream()) {
    const payload = getRuntimeStreamPayload();
    if (!payload.address) {
      setText("streamTitle", STREAMS[stream].label);
      setStreamAddressDisplay("");
      setText("sumBalance", "0.00000000 BTCZ");
      setText("sumUtxoCount", "0");
      setText("currentStatus", "dynamic");
      return;
    }

    const data = await postJson(`/api/stream/${stream}/summary`, payload);
    setText("streamTitle", STREAMS[stream].label);
    setStreamAddressDisplay(data.address || payload.address);
    setText("sumBalance", `${fmt8(data.balance)} BTCZ`);
    setText("sumUtxoCount", String(data.utxoCount || 0));
    setText("currentStatus", data.status || "idle");
    return;
  }

  const data = await postJson(`/api/stream/${stream}/summary`, {});
  setText("streamTitle", STREAMS[stream].label);
  setStreamAddressDisplay(data.address || STREAMS[stream].address);
  setText("sumBalance", `${fmt8(data.balance)} BTCZ`);
  setText("sumUtxoCount", String(data.utxoCount || 0));
  setText("currentStatus", data.status || "idle");
}

function utxoRowHtml(u) {
  return `
    <div class="utxo-item">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong>${fmt8(u.amount)} BTCZ</strong>
        <span class="pill ${u.locked ? 'warn' : 'ok'}">${u.locked ? 'locked' : 'free'}</span>
      </div>
      <div class="small mono" style="margin-top:6px;">${u.txid}</div>
      <div class="small">vout: ${u.vout} | height: ${u.height || 0}</div>
      ${u.lock ? `<div class="small">order: ${u.lock.orderId || "?"}</div>` : ""}
    </div>
  `;
}

function renderMoreUtxos() {
  const box = $("utxoList");
  if (!box) return;

  if (!state.utxos.length) {
    box.innerHTML = `<div class="small">Aucun UTXO détecté pour ce stream.</div>`;
    setText("utxoMeta", "0 shown");
    return;
  }

  const nextCount = Math.min(state.utxoRenderCount + UTXO_PAGE_SIZE, state.utxos.length);
  const slice = state.utxos.slice(state.utxoRenderCount, nextCount);

  if (state.utxoRenderCount === 0) {
    box.innerHTML = "";
  }

  box.insertAdjacentHTML("beforeend", slice.map(utxoRowHtml).join(""));
  state.utxoRenderCount = nextCount;
  setText("utxoMeta", `${state.utxoRenderCount} / ${state.utxos.length} shown`);
}

function bindUtxoScroll() {
  const box = $("utxoList");
  if (!box) return;

  box.onscroll = () => {
    const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 100;
    if (nearBottom && state.utxoRenderCount < state.utxos.length) {
      renderMoreUtxos();
    }
  };
}

async function loadUtxos() {
  const stream = state.streamKey;
  const payload = isCustomStream() ? getRuntimeStreamPayload() : {};
  if (isCustomStream() && !payload.address) {
    state.utxos = [];
    state.utxoRenderCount = 0;
    renderMoreUtxos();
    return;
  }

  const data = await postJson(`/api/stream/${stream}/utxos`, payload);
  state.utxos = Array.isArray(data.utxos) ? data.utxos : [];
  state.utxoRenderCount = 0;

  setText("sumUtxoCount", String(state.utxos.length));
  renderMoreUtxos();
  bindUtxoScroll();
}

async function loadOrders() {
  const stream = state.streamKey;
  const data = await fetchJson(`/api/stream/${stream}/orders`);
  state.orders = Array.isArray(data.orders) ? data.orders : [];
  renderOrders();
}
async function loadOrderDetails(orderId) {
  const stream = state.streamKey;
  const ownerToken = getOwnerToken(orderId);
  const qs = ownerToken ? `?ownerToken=${encodeURIComponent(ownerToken)}` : '';
  return fetchJson(`/api/stream/${stream}/order/${orderId}${qs}`);
}

function signedBadge(order) {
  const count = Number(order?.signedCount || 0);
  const total = Number(order?.totalKeys || 3);
  return `${count}of${total} signed`;
}

function statusDot(ok = false) {
  return `<span class="status-dot ${ok ? 'ok' : ''}"></span>`;
}

function keyholderStatusHtml(slot, count, order = {}) {
  const total = Number(order?.totalKeys || 3);
  const required = Number(order?.requiredSigs || 2);
  const signed = Number(count || 0) >= slot;
  const complete = Number(count || 0) >= required;
  return `${statusDot(signed)} <strong>${slot}of${total} signed</strong> <span class="small">${signed ? 'true' : 'false'}${slot >= Math.min(2, total) ? ` · Complete: ${complete ? 'true' : 'false'}` : ''}</span>`;
}

function applyOrderUiState(order) {
  const count = Number(order?.signedCount || 0);
  const total = Number(order?.totalKeys || 3);
  const required = Number(order?.requiredSigs || 2);
  const pinOk = !!state.pinAuthorized;
  const setBtn = (id, disabled, label) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !!disabled;
    if (label) el.textContent = label;
    el.classList.toggle('secondary', !!disabled);
  };

  setBtn('submitK1Btn', !pinOk || count >= 1, count >= 1 ? 'K1 Accepted' : 'Submit K1');
  setBtn('submitK2Btn', !pinOk || total < 2 || count >= 2, count >= 2 ? 'K2 Accepted' : 'Submit K2');
  setBtn('submitK3Btn', !pinOk || total < 3 || count >= 3, count >= 3 ? 'K3 Accepted' : 'Submit K3');
  setBtn('finalizeBtn', !pinOk, 'Finalize');
  setBtn('broadcastBtn', !pinOk, 'Broadcast');

  if ($('deleteHint')) $('deleteHint').textContent = pinOk ? 'PIN holder can cancel this order at any time before broadcast.' : 'PIN required to cancel, finalize, or broadcast this order.';
  if ($('k1Status')) $('k1Status').innerHTML = keyholderStatusHtml(1, count, order);
  if ($('k2Status')) $('k2Status').innerHTML = keyholderStatusHtml(2, count, order);
  if ($('k3Status')) $('k3Status').innerHTML = keyholderStatusHtml(3, count, order);
  if ($('finalStatus')) $('finalStatus').innerHTML = `${statusDot(count >= required)} <strong>${count >= required ? 'Complete' : 'Incomplete'}</strong> <span class="small">${signedBadge(order || {})} · type ${required}of${total}</span>`;
}

function renderKeyholderActivity(keyholders = []) {
  const el = $('keyholderActivity');
  if (!el) return;
  el.innerHTML = keyholders.map((k) => {
    const label = k.lastSignedAt ? new Date(k.lastSignedAt).toLocaleString() : 'never';
    return `<div class="summary-item"><div class="k">Keyholder ${k.slot}</div><div class="v" style="font-size:14px;">${label}</div></div>`;
  }).join('');
}

function remainingLabel(order) {
  if (!order || !order.expiresAtTs) return "-";
  const left = Number(order.expiresAtTs) - Date.now();
  if (left <= 0) return "expired";
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  const secs = Math.floor((left % 60000) / 1000);

  if (days > 0) return `${days}d ${hours}h`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function renderOrders() {
  const items = state.orders;

  if (!items.length) {
    $("ordersList").innerHTML = `<div class="small">Aucun order actif.</div>`;
    if (!state.currentOrder) {
      setText("sharedStatus", "none");
      setText("currentTimer", "--:--");
    }
    return;
  }

  $("ordersList").innerHTML = items.map((order) => {
    const selected = state.currentOrder?.id === order.id;
    const deleteDisabled = false;
    return `
      <div class="order-item">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <strong>${order.mode}</strong>
          <span class="pill ${order.status === "openorder" ? "warn" : order.complete ? "ok" : ""}">${order.status}</span>
        </div>
        <div class="small mono" style="margin-top:6px;">${order.id}</div>${order.txid ? `<div class="small mono">${explorerLink("tx", order.txid, order.txid)}</div>` : ""}
        <div class="small mono">${explorerLink("address", order.address || "", order.address || "")}</div>
        <div class="small">amount: ${fmt8(order.amount)} | fee: ${fmt8(order.fee)} | change: ${fmt8(order.change)}</div>
        <div class="small">type: ${order.requiredSigs || '?'}of${order.totalKeys || 3} | inputs: ${(order.inputs || []).length} | expires: ${remainingLabel(order)}</div>
        ${order.currentBlock ? `<div class="small">block: ${explorerLink("block", order.currentBlock, order.currentBlock)}</div>` : ''}
        <div class="small ok" style="margin-top:6px;">${signedBadge(order)}${order.complete ? ' · complete' : ''}</div>
        <div class="button-row">
          <button type="button" data-action="load-order" data-id="${order.id}">${selected ? "Loaded" : "Load"}</button>
          <button type="button" class="secondary" data-action="copy-order-hex" data-id="${order.id}">Copy Unsigned</button>
          <button type="button" class="danger" data-action="delete-order" data-id="${order.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  $("ordersList").querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const order = state.orders.find((o) => o.id === id);
      if (!order) return;

      if (action === "load-order") {
        try {
          const data = await loadOrderDetails(id);
          loadOrderIntoForm(data.order, data.cli);
        } catch (err) {
          setValue("selectedInfo", `Erreur load order: ${err.message}`);
        }
        return;
      }

      if (action === "copy-order-hex") {
        await copyText(order.unsignedHex || "");
        return;
      }

      if (action === "delete-order") {
        try {
          await deleteJson(`/api/stream/${state.streamKey}/order/${id}`, { pin: currentOrderPin() });
          if (state.currentOrder?.id === id) {
            state.currentOrder = null;
            state.currentCli = null;
            clearOrderFormOnly();
          }
          await loadOrders();
          await loadUtxos();
          await loadStreamSummary();
        } catch (err) {
          setValue("selectedInfo", `Erreur delete order: ${err.message}`);
        }
      }
    });
  });
}

function historyRowHtml(h) {
  return `
    <div class="history-item">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong>${h.txid ? explorerLink("tx", h.txid, h.txid) : h.id}</strong>
        <span class="pill ${h.complete ? 'ok' : ''}">${signedBadge(h)}</span>
      </div>
      <div class="small">${h.broadcastAt || h.createdAt || ''}</div>
      <div class="small">mode: ${h.mode} · ${h.status} · ${h.requiredSigs || '?'}of${h.totalKeys || 3}</div>
      ${h.address ? `<div class="small mono">${explorerLink("address", h.address, h.address)}</div>` : ''}
      ${h.currentBlock ? `<div class="small">block: ${explorerLink("block", h.currentBlock, h.currentBlock)}</div>` : ''}
      <div class="button-row">
        <button type="button" class="secondary" data-history-copy="final" data-id="${h.id}">Copy Final</button>
        <button type="button" class="secondary" data-history-copy="unsigned" data-id="${h.id}">Copy Unsigned</button>
      </div>
    </div>`;
}

function renderHistory() {
  const el = $("historyList");
  if (!el) return;
  if (!state.history.length) {
    el.innerHTML = `<div class="small">No history</div>`;
    return;
  }
  el.innerHTML = state.history.map(historyRowHtml).join('') + `<div class="button-row"><button id="loadMoreHistoryBtn" type="button" class="secondary" ${state.historyHasMore ? '' : 'disabled'}>${state.historyHasMore ? 'Load more history' : 'History complete'}</button></div>`;
  el.querySelectorAll('button[data-history-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const item = state.history.find((h) => h.id === btn.dataset.id);
    if (!item) return;
    await copyText(btn.dataset.historyCopy === 'final' ? (item.finalHex || '') : (item.unsignedHex || ''));
  }));
  $('loadMoreHistoryBtn')?.addEventListener('click', async () => {
    await loadHistory(true);
  });
}

async function loadHistory(append = false) {
  const stream = state.streamKey;
  const offset = append ? state.historyOffset : 0;
  const data = await fetchJson(`/api/stream/${stream}/history?offset=${offset}&limit=25`);
  const batch = Array.isArray(data.history) ? data.history : [];
  if (append) state.history = [...state.history, ...batch];
  else state.history = batch;
  state.historyOffset = offset + batch.length;
  state.historyHasMore = !!data.hasMore;
  state.historyTotal = Number(data.total || state.history.length);
  renderHistory();
}

function clearOrderFormOnly() {
  setValue("currentOrderId", "");
  setValue("unsignedHex", "");
  setValue("keyholder1Hex", "");
  setValue("keyholder2Hex", "");
  setValue("keyholder3Hex", "");
  setValue("finalHex", "");
  setValue("decodeResult", "");
  setValue("selectedInfo", "");
  setValue("cliLinuxCreate", "");
  setValue("cliLinuxSign", "");
  setValue("cliPSCreate", "");
  setValue("cliPSSign", "");
  state.currentCli = null;
  setCurrentBlockDisplay("");
  setValue("expiryheight", "");
  setTxidDisplay("-");
  setText("sharedStatus", "none");
  setText("sumSelected", "0");
  setText("sumHexBytes", "0");
  setText("currentTimer", "--:--");
  renderKeyholderActivity([]);
  state.pinAuthorized = false;
  applyOrderUiState({ signedCount: 0, requiredSigs: 2, totalKeys: 3 });
  updateHexMeta();
  setOrderPinUi(null);
updateStreamType(null);
}


function loadOrderIntoForm(order, cli = null) {
  state.currentOrder = order || null;

  if (!order) {
    clearOrderFormOnly();
    renderOrders();
    return;
  }

  if (isCustomStream()) {
    setValue("customAddress", order.address || "");
    setValue("customRedeemScript", order.redeemScript || "");
    setStreamAddressDisplay(order.address || "");
  }

  setValue("currentOrderId", order.id || "");
  setValue("unsignedHex", order.unsignedHex || "");
  setValue("keyholder1Hex", order.keyholder1Hex || "");
  setValue("keyholder2Hex", order.keyholder2Hex || "");
  setValue("keyholder3Hex", order.keyholder3Hex || "");
  setValue("finalHex", order.finalHex || "");
  setText("sharedStatus", order.status || "pending");
  setOrderPinUi(order);
  setTxidDisplay(order.txid || "-");
  setText("sumSelected", String((order.inputs || []).length));
  setText("sumHexBytes", String(estimateBytes((order.inputs || []).length, Object.keys(order.outputs || {}).length)));

  setCurrentBlockDisplay(order.currentBlock || "");
  setValue("expiryheight", order.expiryheight || "");
  if ($("expiryPreset") && order.expiryPreset) {
    $("expiryPreset").value = order.expiryPreset;
  }

  setValue("selectedInfo", JSON.stringify({
    id: order.id,
    status: order.status,
    mode: order.mode,
    address: order.address,
    redeemScript: order.redeemScript,
    totalInputs: order.totalInputs,
    amount: order.amount,
    fee: order.fee,
    change: order.change,
    currentBlock: order.currentBlock,
    expiryPreset: order.expiryPreset,
    expiryheight: order.expiryheight,
    inputs: order.inputs,
    outputs: order.outputs
  }, null, 2));

  displayCLI(cli);
  renderCurrentTimer();
  renderOrders();
  applyOrderUiState(order);
  updateHexMeta();
updateStreamType(order);
  refreshPinAuthority();
}


function renderCurrentTimer() {
  if (!state.currentOrder) {
    setText("currentTimer", "--:--");
    return;
  }
  setText("currentTimer", remainingLabel(state.currentOrder));
}

async function buildAutoTransaction() {
  try {
    const stream = state.streamKey;
    const mode = getValue("txMode", "send");
    const amount = Number(getValue("amount", "0"));
    const fee = Number(getValue("fee", "0.0001"));
    const destination = getValue("toAddress", "");
    const maxInputs = Number(getValue("maxInputs", "180"));
    const maxEstimatedBytes = Number(getValue("maxEstimatedBytes", String(HEX_LIMIT_BYTES)));
    const expiryPreset = getValue("expiryPreset", "24h");
    const expiryheightRaw = getValue("expiryheight", "");

    const payload = {
      mode,
      amount,
      fee,
      destination,
      maxInputs,
      maxEstimatedBytes,
      expiryPreset,
      expiryheight: expiryheightRaw ? Number(expiryheightRaw) : 0,
      customPin: getValue('customPin', ''),
      ...getRuntimeStreamPayload()
    };

    const data = await postJson(`/api/stream/${stream}/build`, payload);

    const order = data.order || null;
    if (!order) throw new Error("Aucun order retourné");
    if (data.ownerToken) saveOwnerToken(order.id, data.ownerToken);

await loadOrders();
await loadUtxos();
await loadStreamSummary();

const detail = await loadOrderDetails(order.id);
const fresh = detail?.order || order;
loadOrderIntoForm(fresh, detail?.cli || data.cli);

    setValue("selectedInfo", JSON.stringify({
      mode: fresh.mode,
      address: fresh.address,
      redeemScript: fresh.redeemScript,
      totalInputs: data.totalInputs,
      amount: data.amount,
      fee: data.fee,
      change: data.change,
      currentBlock: data.currentBlock,
      expiryPreset: data.expiryPreset,
      expiryheight: data.expiryheight,
      inputs: data.inputs,
      outputs: data.outputs,
      selectedUtxos: data.selectedUtxos,
      summaryText: data.summaryText
    }, null, 2));

    updateHexMeta();
  } catch (err) {
    setValue("selectedInfo", `Erreur build: ${err.message}`);
  }
}

async function decodeCurrentUnsigned() {
  try {
    const hex = getValue("unsignedHex", "");
    if (!hex) return;

    const data = await postJson("/api/decoderawtransaction", { hex });
    const count = detectLocalSignedCount(data.result);

    applyOrderUiState({ signedCount: count, requiredSigs: state.currentOrder?.requiredSigs || 2, totalKeys: state.currentOrder?.totalKeys || 3 });
    setValue("decodeResult", JSON.stringify(data.result || data, null, 2));
  } catch (err) {
    setValue("decodeResult", `Erreur decode: ${err.message}`);
  }
}

function detectLocalSignedCount(decoded) {
  if (!decoded?.vin) return 0;

  let total = 0;

  for (const vin of decoded.vin) {
    const asm = vin?.scriptSig?.asm || "";
    const matches = asm.match(/\[ALL\]/g);
    if (matches) total += matches.length;
  }

  return total;
}

async function submitKeyholder(slot) {
  try {
    const orderId = getValue("currentOrderId", "");
    const field = `keyholder${slot}Hex`;
    const hex = getValue(field, "");

    if (!orderId) throw new Error("Aucun order chargé");
    if (!hex) throw new Error(`Hex K${slot} vide`);

    await postJson(`/api/stream/${state.streamKey}/submit-keyholder`, {
      orderId,
      slot,
      hex,
      pin: currentOrderPin(),
      ownerToken: getOwnerToken(orderId)
    });

    const detail = await loadOrderDetails(orderId);
    loadOrderIntoForm(detail.order, detail.cli);
    await loadStreamSummary();
    await loadUtxos();
    await loadOrders();
  } catch (err) {
    setValue("selectedInfo", `Erreur submit K${slot}: ${err.message}`);
  }
}

async function finalizeCurrent() {
  try {
    const orderId = getValue("currentOrderId", "");
    const finalHex = getValue("finalHex", "");

    if (!orderId) throw new Error("Aucun order chargé");
    if (!finalHex) throw new Error("Final hex vide");

    await postJson(`/api/stream/${state.streamKey}/finalize`, {
      orderId,
      finalHex,
      pin: currentOrderPin(),
      ownerToken: getOwnerToken(orderId)
    });

    const detail = await loadOrderDetails(orderId);
    loadOrderIntoForm(detail.order, detail.cli);
    await loadOrders();
  } catch (err) {
    setValue("selectedInfo", `Erreur finalize: ${err.message}`);
  }
}

async function broadcastCurrent() {
  try {
    const orderId = getValue("currentOrderId", "");
    const finalHex = getValue("finalHex", "");

    if (!orderId) throw new Error("Aucun order chargé");
    if (!finalHex) throw new Error("Final hex vide");

    const data = await postJson(`/api/stream/${state.streamKey}/broadcast`, {
      orderId,
      finalHex,
      pin: currentOrderPin(),
      ownerToken: getOwnerToken(orderId)
    });

    setTxidDisplay(data.txid || "-");
    state.currentOrder = null;
    clearOrderFormOnly();

    await loadOrders();
    await loadHistory();
    await loadUtxos();
    await loadStreamSummary();
  } catch (err) {
    setValue("selectedInfo", `Erreur broadcast: ${err.message}`);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  state.streamKey = (qs("stream") || "BP").toUpperCase();
  if (!STREAMS[state.streamKey]) state.streamKey = "BP";

  setText("streamTitle", STREAMS[state.streamKey].label);
  setStreamAddressDisplay(currentStreamAddress());
updateStreamType(null);
  toggleCustomFields();

  $("txMode")?.addEventListener("change", () => {
    renderModeUi();
    setValue("unsignedHex", "");
    setValue("currentOrderId", "");
    setText("sumSelected", "0");
    setText("sumHexBytes", "0");
    updateHexMeta();
  });

  $("unsignedHex")?.addEventListener("input", updateHexMeta);

  $("reloadSummaryBtn")?.addEventListener("click", loadStreamSummary);
  $("reloadUtxosBtn")?.addEventListener("click", loadUtxos);
  $("reloadOrdersBtn")?.addEventListener("click", loadOrders);
  $("buildAutoBtn")?.addEventListener("click", buildAutoTransaction);
  $("decodeBtn")?.addEventListener("click", decodeCurrentUnsigned);

  $("submitK1Btn")?.addEventListener("click", () => submitKeyholder(1));
  $("submitK2Btn")?.addEventListener("click", () => submitKeyholder(2));
  $("submitK3Btn")?.addEventListener("click", () => submitKeyholder(3));

  $("finalizeBtn")?.addEventListener("click", finalizeCurrent);
  $("broadcastBtn")?.addEventListener("click", broadcastCurrent);
  $("orderPinInput")?.addEventListener('input', () => { refreshPinAuthority(); });

  $("copyUnsignedBtn")?.addEventListener("click", async () => {
    await copyText(getValue("unsignedHex", ""));
  });
  $("copyK1Btn")?.addEventListener("click", async () => {
    await copyText(getValue("keyholder1Hex", ""));
  });
  $("copyK2Btn")?.addEventListener("click", async () => {
    await copyText(getValue("keyholder2Hex", ""));
  });
  $("copyK3Btn")?.addEventListener("click", async () => {
    await copyText(getValue("keyholder3Hex", ""));
  });
  $("copyFinalBtn")?.addEventListener("click", async () => {
    await copyText(getValue("finalHex", ""));
  });

  $("copyCliLinuxCreateBtn")?.addEventListener("click", async () => {
    await copyText(getValue("cliLinuxCreate", ""));
  });
  $("copyCliLinuxSignBtn")?.addEventListener("click", async () => {
    await copyText(getValue("cliLinuxSign", ""));
  });
  $("copyCliLinuxSignFileBtn")?.addEventListener("click", async () => {
    await copyText(state.currentCli?.linuxSignWithFileOutput || getValue("cliLinuxSign", ""));
  });
  $("copyCliPSCreateBtn")?.addEventListener("click", async () => {
    await copyText(getValue("cliPSCreate", ""));
  });
  $("copyCliPSSignBtn")?.addEventListener("click", async () => {
    await copyText(getValue("cliPSSign", ""));
  });
  $("copyCliPSSignFileBtn")?.addEventListener("click", async () => {
    await copyText(state.currentCli?.powershellSignWithFileOutput || getValue("cliPSSign", ""));
  });

  if ($("txMode")) $("txMode").value = "send";
  if ($("expiryPreset")) $("expiryPreset").value = "24h";

  renderModeUi();

  await loadStreamSummary();
  await loadUtxos();
  await loadOrders();
  await loadHistory();

  if (state.orders.length) {
    const detail = await loadOrderDetails(state.orders[0].id);
    loadOrderIntoForm(detail.order, detail.cli);
  } else {
    updateHexMeta();
  }

  setInterval(async () => {
    await loadStreamSummary();
    await loadOrders();
    renderCurrentTimer();
  }, 15000);

  setInterval(renderCurrentTimer, 1000);
});
