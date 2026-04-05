

function resolveStreamContext(stream, body = {}) {
  const key = String(stream || "").toUpperCase();

  if (STREAMS[key]) {
    return {
      streamKey: key,
      label: STREAMS[key].label,
      address: STREAMS[key].address,
      redeemScript: STREAMS[key].redeemScript || ""
    };
  }

  if (key === "CUSTOM") {
    const address = String(body?.customAddress || body?.address || "").trim();
    const redeemScript = String(body?.customRedeemScript || body?.redeemScript || "").trim();

    if (!address) throw new Error("custom address missing");

    return {
      streamKey: "CUSTOM",
      label: "Custom Multisig",
      address,
      redeemScript
    };
  }

  throw new Error("unknown stream");
}
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const STREAMS = {
  BP: {
    label: "BP Stream",
    address: process.env.STREAM_BP_ADDRESS || "t3cq6DPTZbVShmY5hs4NLJyBhTfw5KNZNcf",
    redeemScript: process.env.STREAM_BP_REDEEMSCRIPT || ""
  },
  ZF: {
    label: "ZF Stream",
    address: process.env.STREAM_ZF_ADDRESS || "t3LUnrQk7pHJTvTyTVzdDHNVamMGfvXAi4k",
    redeemScript: process.env.STREAM_ZF_REDEEMSCRIPT || ""
  },
  MG: {
    label: "MG Stream",
    address: process.env.STREAM_MG_ADDRESS || "t3URkWgiiYVNTAvKHy5HdPia3hft9byrsNz",
    redeemScript: process.env.STREAM_MG_REDEEMSCRIPT || ""
  },
  CUSTOM: {
    label: "Custom Multisig",
    address: "",
    redeemScript: ""
  }
};

function streamInfo(stream) {
  const key = String(stream || "").toUpperCase();
  const s = STREAMS[key];
  if (!s) throw new Error("unknown stream");
  return {
    label: s.label,
    address: s.address,
    redeemScript: s.redeemScript || ""
  };
}


const PENDING_MS = 10 * 60 * 1000;
const OPENORDER_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FEE = 0.0001;
const DEFAULT_MAX_INPUTS = 180;
const DEFAULT_MAX_ESTIMATED_BYTES = 2621440;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileOf(name) {
  return path.join(DATA_DIR, name);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function nowTs() {
  return Date.now();
}

function streamExists(stream) {
  return !!STREAMS[stream];
}

function getStreamRuntimeConfig(stream, payload = {}) {
  const base = STREAMS[stream];
  if (!base) return null;

  if (stream !== "CUSTOM") {
    return {
      stream,
      label: base.label,
      address: base.address,
      redeemScript: base.redeemScript
    };
  }

  return {
    stream,
    label: base.label,
    address: String(payload?.address || payload?.customAddress || "").trim(),
    redeemScript: String(payload?.redeemScript || payload?.customRedeemScript || "").trim()
  };
}

function zatoshiToBtcz(value) {
  return Number(value || 0) / 1e8;
}

function estimateBytes(inputCount, outputCount) {
  const base = 32;
  const perInput = 180;
  const perOutput = 60;
  return base + inputCount * perInput + outputCount * perOutput;
}

function estimateBytesMultisig(inputCount, outputCount, mode = "send") {
  const txOverhead = 32;
  const inputBytes = 320;
  const outputBytes = 34;
  const bytes = txOverhead + (Number(inputCount || 0) * inputBytes) + (Number(outputCount || 0) * outputBytes);
  return Math.max(bytes, 0);
}



function btczToZatoshi(btcz) {
  return Math.round(Number(btcz || 0) * 1e8);
}

function satsToBtcz(sats) {
  return Number((Number(sats || 0) / 1e8).toFixed(8));
}


function txRefId() {
  return crypto.randomBytes(12).toString("hex");
}

function orderFile(stream) {
  return fileOf(`${stream}-orders.json`);
}

function historyFile(stream) {
  return fileOf(`${stream}-history.json`);
}

function locksFile() {
  return fileOf("utxo-locks.json");
}

function getOrders(stream) {
  return readJson(orderFile(stream), []);
}

function setOrders(stream, orders) {
  writeJson(orderFile(stream), orders);
}

function getHistory(stream) {
  return readJson(historyFile(stream), []);
}

function pushHistory(stream, entry) {
  const items = getHistory(stream);
  items.unshift(enrichOrderWithSigningMeta(entry));
  writeJson(historyFile(stream), items);
}

function getLocks() {
  return readJson(locksFile(), {});
}

function setLocks(locks) {
  writeJson(locksFile(), locks);
}

function lockKey(txid, vout) {
  return `${txid}:${vout}`;
}

function hashHex(hex) {
  return crypto.createHash("sha256").update(String(hex || "")).digest("hex");
}

const ORDER_PIN_COOLDOWN_MS = 5 * 60 * 1000;
const ORDER_PIN_MAX_FAILS = 3;

function generateOrderPin() {
  return String(Math.floor(100 + Math.random() * 900));
}

function normalizePin(pin) {
  return String(pin || '').replace(/\D/g, '').slice(0, 3);
}

function generateOwnerToken() {
  return crypto.randomBytes(24).toString('hex');
}

const LOCKED_HEX_PLACEHOLDER = "[LOCKED - PIN REQUIRED]";

function maskSignedHexFields(clone) {
  if (!clone) return clone;
  clone.keyholder1Hex = clone.keyholder1Hex ? LOCKED_HEX_PLACEHOLDER : "";
  clone.keyholder2Hex = clone.keyholder2Hex ? LOCKED_HEX_PLACEHOLDER : "";
  clone.keyholder3Hex = clone.keyholder3Hex ? LOCKED_HEX_PLACEHOLDER : "";
  clone.finalHex = clone.finalHex ? LOCKED_HEX_PLACEHOLDER : "";
  return clone;
}

function publicOrder(order) {
  if (!order) return order;
  const clone = { ...order };
  delete clone.pin;
  delete clone.pinFails;
  delete clone.pinCooldownUntil;
  delete clone.ownerToken;
  delete clone.ownerAuthorized;
  return maskSignedHexFields(clone);
}

function ownerViewOrder(order, ownerToken, revealHex = false) {
  const safe = { ...order };

  const isOwner =
    ownerToken &&
    order.ownerToken &&
    ownerToken === order.ownerToken;

  if (isOwner) {
    safe.pin = order.pin || "";
    safe.ownerAuthorized = true;
    return safe;
  }

  safe.pin = "";
  safe.ownerAuthorized = false;
  return revealHex ? safe : maskSignedHexFields(safe);
}

function findOrderIndex(stream, orderId) {
  const orders = getOrders(stream);
  const index = orders.findIndex((o) => o.id === orderId);
  return { orders, index, order: index >= 0 ? orders[index] : null };
}

function verifyOrderPin(order, pin) {
  const now = nowTs();
  if (!order) return { ok: false, status: 404, error: 'order not found' };
  if (order.pinCooldownUntil && now < Number(order.pinCooldownUntil || 0)) {
    const waitMs = Number(order.pinCooldownUntil || 0) - now;
    return { ok: false, status: 429, error: `PIN locked. Try again in ${Math.ceil(waitMs / 1000)}s` };
  }

  const normalized = normalizePin(pin);
  if (!normalized) return { ok: false, status: 403, error: 'PIN required' };
  if (normalized !== String(order.pin || '')) {
    order.pinFails = Number(order.pinFails || 0) + 1;
    if (order.pinFails >= ORDER_PIN_MAX_FAILS) {
      order.pinFails = 0;
      order.pinCooldownUntil = now + ORDER_PIN_COOLDOWN_MS;
      return { ok: false, status: 429, error: 'Invalid PIN. Temporary cooldown activated.' };
    }
    return { ok: false, status: 403, error: `Invalid PIN (${order.pinFails}/${ORDER_PIN_MAX_FAILS})` };
  }

  order.pinFails = 0;
  order.pinCooldownUntil = 0;
  return { ok: true };
}

const HEALTH_GREEN_MAX = 2000000;
const HEALTH_WARN_MAX = 2500000;

function redeemRequiredSigs(redeem = "") {
  const op = (redeem || "").slice(0, 2).toLowerCase();
  const map = {
    "51": 1, "52": 2, "53": 3, "54": 4,
    "55": 5, "56": 6, "57": 7, "58": 8
  };
  return map[op] || 2;
}

function redeemTotalKeys(redeem = "") {
  const op = (redeem || "").slice(-4, -2).toLowerCase();
  const map = {
    "51": 1, "52": 2, "53": 3, "54": 4,
    "55": 5, "56": 6, "57": 7, "58": 8
  };
  return map[op] || 3;
}

function parseScriptPushes(hex) {
  const clean = String(hex || "").trim();
  const pushes = [];
  let i = 0;

  const read = (bytes) => {
    const out = clean.slice(i, i + bytes * 2);
    i += bytes * 2;
    return out;
  };

  while (i < clean.length) {
    const opcodeHex = read(1);
    if (!opcodeHex) break;
    const opcode = parseInt(opcodeHex, 16);
    if (opcode == 0) {
      pushes.push("");
      continue;
    }
    let size = 0;
    if (opcode >= 1 && opcode <= 75) {
      size = opcode;
    } else if (opcode === 0x4c) {
      size = parseInt(read(1) || '0', 16);
    } else if (opcode === 0x4d) {
      const lo = read(1) || '00';
      const hi = read(1) || '00';
      size = parseInt(hi + lo, 16);
    } else if (opcode === 0x4e) {
      const b1 = read(1) || '00';
      const b2 = read(1) || '00';
      const b3 = read(1) || '00';
      const b4 = read(1) || '00';
      size = parseInt(b4 + b3 + b2 + b1, 16);
    } else {
      continue;
    }
    pushes.push(read(size));
  }
  return pushes;
}


function getRequiredSigsFromRedeem(redeem = "") {
  const hex = String(redeem || "").toLowerCase().trim();
  if (hex.length < 2) return 0;

  const op = parseInt(hex.slice(0, 2), 16);

  if (isNaN(op) || op < 0x51 || op > 0x60) return 0;

  return op - 0x50;
}

function getTotalKeysFromRedeem(redeem = "") {
  const hex = String(redeem || "").toLowerCase().trim();
  if (hex.length < 4) return 0;

  // avant OP_CHECKMULTISIG (ae)
  if (!hex.endsWith("ae")) return 0;

  const op = parseInt(hex.slice(-4, -2), 16);

  if (isNaN(op) || op < 0x51 || op > 0x60) return 0;

  return op - 0x50;
}

function isDerSignaturePush(push) {
  const clean = String(push || '').toLowerCase();

  if (!clean || clean.length < 10) return false;

  // DER signature starts with 30
  if (!clean.startsWith('30')) return false;

  // detect common sighash types
  const sighash = clean.slice(-2);

  return [
    '01', // SIGHASH_ALL
    '81', // SIGHASH_ALL | ANYONECANPAY
    '02',
    '82',
    '03',
    '83'
  ].includes(sighash);
}


function deriveSigningMetaFromDecoded(decoded, redeemScript = '') {
  const vin = Array.isArray(decoded?.vin) ? decoded.vin : [];
  let maxSigs = 0;
  let hasUnsignedInput = false;

  for (const input of vin) {
    const scriptHex = input?.scriptSig?.hex || '';
    if (!scriptHex) {
      hasUnsignedInput = true;
      continue;
    }

    const pushes = parseScriptPushes(scriptHex);
    const sigCount = pushes.filter(isDerSignaturePush).length;

    if (sigCount > maxSigs) maxSigs = sigCount;
    if (sigCount === 0) hasUnsignedInput = true;
  }

  const signedCount = Math.max(0, maxSigs);
  const requiredSigs = getRequiredSigsFromRedeem(redeemScript);
  const totalKeys = getTotalKeysFromRedeem(redeemScript);

  return {
    signedCount,
    requiredSigs,
    totalKeys,
    stageLabel: `${signedCount}of${totalKeys}`,
    signedLabel: `${signedCount}of${totalKeys} signed`,
    complete: signedCount >= requiredSigs,
    hasUnsignedInput
  };
}


async function analyzeHexSignatures(hex, redeemScript = '') {
  const decoded = await decodeHex(hex);
  return { decoded, ...deriveSigningMetaFromDecoded(decoded, redeemScript) };
}

function enrichOrderWithSigningMeta(order) {
  if (!order) return order;

  const signedCount = Number(order.signedCount || 0);
  const redeem = order.redeemScript || order.selectedUtxos?.[0]?.redeemScript || "";
  const requiredSigs = Number(order.requiredSigs || getRequiredSigsFromRedeem(redeem));
  const totalKeys = Number(order.totalKeys || getTotalKeysFromRedeem(redeem));
  const complete = signedCount >= requiredSigs;

  return {
    ...order,
    redeemScript: redeem,
    signedCount,
    requiredSigs,
    totalKeys,
    signedLabel: `${signedCount}of${totalKeys} signed`,
    stageLabel: `${signedCount}of${totalKeys}`,
    complete,
    completeLabel: complete ? 'complete' : 'incomplete',
    deleteLocked: signedCount >= 1,
    k1Complete: signedCount >= 1,
    k2Complete: signedCount >= Math.min(2, totalKeys),
    k3Complete: signedCount >= Math.min(3, totalKeys)
  };
}

function estimateConsolidationHealth(utxoCount) {
  const estimatedBytes = Number(utxoCount || 0) * 500;
  let state = 'green';
  if (estimatedBytes > HEALTH_WARN_MAX) state = 'red';
  else if (estimatedBytes > HEALTH_GREEN_MAX) state = 'yellow';
  const overflowBytes = Math.max(0, estimatedBytes - HEALTH_WARN_MAX);
  const consolidationRoundsNeeded = estimatedBytes <= HEALTH_GREEN_MAX ? 0 : Math.max(1, Math.ceil(estimatedBytes / HEALTH_GREEN_MAX) - 1);
  return {
    estimatedBytes,
    maxBytes: HEALTH_WARN_MAX,
    greenMaxBytes: HEALTH_GREEN_MAX,
    overflowBytes,
    state,
    percent: Math.min(100, Math.round((estimatedBytes / HEALTH_WARN_MAX) * 100)),
    consolidationRoundsNeeded
  };
}

function collectKeyholderActivity(stream) {
  const orders = getOrders(stream);
  const history = getHistory(stream);
  const all = [...orders, ...history];
  const out = {1: null, 2: null, 3: null};
  for (const item of all) {
    for (const slot of [1,2,3]) {
      const ts = item?.[`keyholder${slot}AtTs`] || item?.[`keyholder${slot}Ts`] || null;
      if (ts && (!out[slot] || ts > out[slot])) out[slot] = ts;
    }
  }
  return [1,2,3].map((slot) => ({
    slot,
    lastSignedAtTs: out[slot] || 0,
    lastSignedAt: out[slot] ? new Date(out[slot]).toISOString() : '',
    idleMs: out[slot] ? Math.max(0, Date.now() - out[slot]) : null
  }));
}

function blocksForPreset(preset) {
  const p = String(preset || "24h").toLowerCase();
  if (p === "24h") return 576;
  if (p === "3d") return 1728;
  if (p === "1w") return 4032;
  return 576;
}

async function rpcCall(method, params = []) {
  const protocol = process.env.BTCZ_RPC_PROTOCOL || "http";
  const host = process.env.BTCZ_RPC_HOST || "127.0.0.1";
  const port = process.env.BTCZ_RPC_PORT || "1979";
  const user = process.env.BTCZ_RPC_USER || "";
  const password = process.env.BTCZ_RPC_PASSWORD || "";

  const url = `${protocol}://${host}:${port}`;
  const auth = Buffer.from(`${user}:${password}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${auth}`
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "btcz-multisig",
      method,
      params
    })
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`RPC invalid JSON: ${text}`);
  }

  if (!res.ok) throw new Error(data?.error?.message || `RPC HTTP ${res.status}`);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  return data.result;
}

async function getCurrentBlockHeight() {
  const result = await rpcCall("getblockcount", []);
  return Number(result || 0);
}

function normalizeAddressUtxos(raw, address, redeemScript = "") {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((u) => ({
    address,
    txid: u.txid,
    outputIndex: Number(u.outputIndex ?? u.vout ?? 0),
    vout: Number(u.outputIndex ?? u.vout ?? 0),
    satoshis: Number(u.satoshis ?? 0),
    amount: zatoshiToBtcz(u.satoshis ?? 0),
    height: Number(u.height ?? 0),
    script: u.script || u.scriptPubKey || "",
    scriptPubKey: u.script || u.scriptPubKey || "",
    redeemScript
  })).filter((u) => u.txid && Number.isFinite(u.vout));
}

async function getAddressBalance(address) {
  const bal = await rpcCall("getaddressbalance", [{ addresses: [address] }]);
  return {
    balance: zatoshiToBtcz(bal?.balance),
    received: zatoshiToBtcz(bal?.received)
  };
}

const txMetaCache = new Map();

async function getTxMeta(txid) {
  if (!txid) return { coinbase: false };
  if (txMetaCache.has(txid)) return txMetaCache.get(txid);
  let meta = { coinbase: false };
  try {
    const tx = await rpcCall("getrawtransaction", [txid, 1]);
    meta = { coinbase: !!tx?.vin?.[0]?.coinbase, tx };
  } catch {
    meta = { coinbase: false };
  }
  txMetaCache.set(txid, meta);
  return meta;
}

async function enrichUtxosWithSourceMeta(utxos = [], options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize || 25));
  const enriched = [];

  for (let i = 0; i < utxos.length; i += batchSize) {
    const batch = utxos.slice(i, i + batchSize);
    const metas = await Promise.all(batch.map((u) => getTxMeta(u.txid)));
    for (let j = 0; j < batch.length; j++) {
      const u = batch[j];
      const meta = metas[j] || { coinbase: false };
      enriched.push({
        ...u,
        coinbase: !!meta.coinbase,
        spendRestricted: !!meta.coinbase,
        restrictionReason: meta.coinbase ? 'coinbase - must be shielded to z-address first' : ''
      });
    }
  }

  return enriched;
}

async function getAddressUtxos(address, redeemScript = "", options = {}) {
  const utxos = await rpcCall("getaddressutxos", [{ addresses: [address] }]);
  const normalized = normalizeAddressUtxos(utxos, address, redeemScript);
  if (options.enrich === false) return normalized;
  return enrichUtxosWithSourceMeta(normalized, options);
}

function cleanupExpiredOrdersAndLocks() {
  const locks = getLocks();
  let changedLocks = false;

  for (const stream of Object.keys(STREAMS)) {
    const orders = getOrders(stream);
    const active = [];

    for (const order of orders) {
      const expired = order.expiresAtTs && nowTs() > order.expiresAtTs && order.status !== "broadcasted";
      if (expired) {
        for (const inp of order.inputs || []) {
          const key = lockKey(inp.txid, inp.vout);
          if (locks[key] && locks[key].orderId === order.id) {
            delete locks[key];
            changedLocks = true;
          }
        }
        continue;
      }
      active.push(order);
    }

    if (active.length !== orders.length) setOrders(stream, active);
  }

  if (changedLocks) setLocks(locks);
}

function lockInputsForOrder(order) {
  const locks = getLocks();
  for (const inp of order.inputs || []) {
    locks[lockKey(inp.txid, inp.vout)] = {
      orderId: order.id,
      stream: order.stream,
      expiresAtTs: order.expiresAtTs,
      status: order.status
    };
  }
  setLocks(locks);
}

function unlockInputsForOrder(order) {
  const locks = getLocks();
  let changed = false;
  for (const inp of order.inputs || []) {
    const key = lockKey(inp.txid, inp.vout);
    if (locks[key] && locks[key].orderId === order.id) {
      delete locks[key];
      changed = true;
    }
  }
  if (changed) setLocks(locks);
}

function refreshLocksForOrder(order) {
  const locks = getLocks();
  let changed = false;
  for (const inp of order.inputs || []) {
    const key = lockKey(inp.txid, inp.vout);
    if (locks[key] && locks[key].orderId === order.id) {
      locks[key].expiresAtTs = order.expiresAtTs;
      locks[key].status = order.status;
      changed = true;
    }
  }
  if (changed) setLocks(locks);
}

function isInputLockedByOtherOrder(txid, vout, currentOrderId = null) {
  const locks = getLocks();
  const lock = locks[lockKey(txid, vout)];
  if (!lock) return false;
  if (currentOrderId && lock.orderId === currentOrderId) return false;
  if (lock.expiresAtTs && nowTs() > lock.expiresAtTs) return false;
  return true;
}

function autoSelectForSend(utxos, amount, fee, maxInputs, maxEstimatedBytes) {
  const target = Number(amount) + Number(fee);

  const available = [...utxos]
    .filter((u) => !u.spendRestricted && !isInputLockedByOtherOrder(u.txid, u.vout))
    .sort((a, b) => {
      const ah = Number(a.height || 0);
      const bh = Number(b.height || 0);
      if (ah !== bh) return ah - bh;
      return Number(a.vout || 0) - Number(b.vout || 0);
    });

  const picked = [];
  let total = 0;

  for (const u of available) {
    const nextInputCount = picked.length + 1;
    const est = estimateBytes(nextInputCount, 2);
    if (nextInputCount > maxInputs) break;
    if (est > maxEstimatedBytes) break;

    picked.push(u);
    total += Number(u.amount || 0);

    if (total >= target) break;
  }

  return {
    selected: picked,
    totalInputs: total,
    complete: total >= target
  };
}

function autoSelectForConsolidate(utxos, fee, maxInputs, maxEstimatedBytes) {
  const available = [...utxos]
    .filter((u) => !u.spendRestricted && !isInputLockedByOtherOrder(u.txid, u.vout))
    .sort((a, b) => a.satoshis - b.satoshis);

  const picked = [];
  let total = 0;

  for (const u of available) {
    const nextInputCount = picked.length + 1;
    const est = estimateBytes(nextInputCount, 1);
    if (nextInputCount > maxInputs) break;
    if (est > maxEstimatedBytes) break;

    picked.push(u);
    total += Number(u.amount || 0);
  }

  return {
    selected: picked,
    totalInputs: total,
    complete: total > fee
  };
}

function buildOutputs(mode, streamAddress, destination, amount, fee, totalInputs) {
  if (mode === "consolidate") {
    const consolidated = Number((totalInputs - fee).toFixed(8));
    if (consolidated <= 0) throw new Error("Fee trop grand pour consolidation");
    return { [streamAddress]: consolidated };
  }

  const change = Number((totalInputs - amount - fee).toFixed(8));
  if (!destination) throw new Error("Destination manquante");
  if (amount <= 0) throw new Error("Amount invalide");
  if (change < 0) throw new Error("Inputs insuffisants");

  if (destination === streamAddress) {
    return {
      [streamAddress]: Number((amount + change).toFixed(8))
    };
  }

  if (destination === streamAddress) {
    return {
      [streamAddress]: Number((amount + change).toFixed(8))
    };
  }

  if (destination === streamAddress) {
    return {
      [streamAddress]: Number((amount + change).toFixed(8))
    };
  }

  return {
    [destination]: Number(amount.toFixed(8)),
    [streamAddress]: change
  };
}

function canonicalDecoded(decoded) {
  const vin = Array.isArray(decoded?.vin)
    ? decoded.vin.map((i) => ({
        txid: i.txid,
        vout: Number(i.vout)
      }))
    : [];

  const vout = Array.isArray(decoded?.vout)
    ? decoded.vout.map((o) => {
        const value = Number(o.value ?? 0);
        let addresses = [];

        if (Array.isArray(o?.scriptPubKey?.addresses)) {
          addresses = [...o.scriptPubKey.addresses].sort();
        } else if (o?.scriptPubKey?.address) {
          addresses = [o.scriptPubKey.address];
        }

        return {
          value: Number(value.toFixed(8)),
          addresses
        };
      })
    : [];

  vin.sort((a, b) => `${a.txid}:${a.vout}`.localeCompare(`${b.txid}:${b.vout}`));
  vout.sort((a, b) => {
    const aa = `${a.addresses.join(",")}:${a.value}`;
    const bb = `${b.addresses.join(",")}:${b.value}`;
    return aa.localeCompare(bb);
  });

  return {
    vin,
    vout,
    locktime: Number(decoded?.locktime ?? 0),
    expiryheight: Number(decoded?.expiryheight ?? decoded?.expiryHeight ?? 0)
  };
}

async function decodeHex(hex) {
  return rpcCall("decoderawtransaction", [hex]);
}

function getEffectiveRedeemScript(order) {
  return String(
    order?.redeemScript ||
    order?.selectedUtxos?.[0]?.redeemScript ||
    ""
  ).trim();
}

function getEffectiveAddress(order) {
  return String(
    order?.address ||
    order?.selectedUtxos?.[0]?.address ||
    STREAMS[order?.stream]?.address ||
    ""
  ).trim();
}

function resolveOrderRedeem(order) {
  return order?.redeemScript || order?.selectedUtxos?.[0]?.redeemScript || "";
}

async function validateSubmittedHex(order, submittedHex) {
  const originalDecoded = await decodeHex(order.unsignedHex);
  const submittedDecoded = await decodeHex(submittedHex);

  const a = canonicalDecoded(originalDecoded);
  const b = canonicalDecoded(submittedDecoded);

  if (JSON.stringify(a.vin) !== JSON.stringify(b.vin)) {
    return { ok: false, reason: "inputs mismatch" };
  }

  if (JSON.stringify(a.vout) !== JSON.stringify(b.vout)) {
    return { ok: false, reason: "outputs mismatch" };
  }

  if (a.locktime !== b.locktime) {
    return { ok: false, reason: "locktime mismatch" };
  }

  if (a.expiryheight !== b.expiryheight) {
    return { ok: false, reason: "expiryheight mismatch" };
  }

  const effectiveRedeem = getEffectiveRedeemScript(order);
  if (effectiveRedeem) {
    const scriptHexes = (submittedDecoded?.vin || []).map((vin) => String(vin?.scriptSig?.hex || "").toLowerCase());
    const redeemLower = effectiveRedeem.toLowerCase();
    const redeemSeen = scriptHexes.every((hex) => !hex || hex.includes(redeemLower));
    if (!redeemSeen) {
      return { ok: false, reason: "redeemScript mismatch" };
    }
  }

  return { ok: true, decoded: submittedDecoded };
}

function buildCliCommands(order) {
  const rawInputs = (order.inputs || []).map((i) => ({
    txid: i.txid,
    vout: i.vout
  }));

  const rawOutputs = { ...(order.outputs || {}) };

  const signMeta = (order.selectedUtxos || []).map((u) => ({
    txid: u.txid,
    vout: u.vout,
    scriptPubKey: u.scriptPubKey,
    redeemScript: order.redeemScript || u.redeemScript || "",
    amount: Number(u.amount || 0)
  }));

  const expiry = Number(order.expiryheight || 0) || "BLOCEXPIRATION";
  const streamTag = String(order.stream || 'STREAM').toUpperCase();
  const orderTag = String(order.id || 'ORDER').slice(0, 8);
  const linuxFile = `sign-${streamTag}-${orderTag}-SIGN-$(date +%F-%H%M%S).txt`;
  const psFile = `sign-${streamTag}-${orderTag}-SIGN-$(Get-Date -Format yyyy-MM-dd-HHmmss).txt`;

  const linuxCreate =
`./bitcoinz-cli createrawtransaction "${JSON.stringify(rawInputs).replace(/"/g, '\"')}" "${JSON.stringify(rawOutputs).replace(/"/g, '\"')}" \ 0 \ ${expiry}`;

  const linuxSign =
`./bitcoinz-cli signrawtransaction "HEX" \ '${JSON.stringify(signMeta)}' '["PRIVKEY"]'`;

  const linuxSignWithFileOutput =
`${linuxSign} | tee ${linuxFile}`;

  const powershellCreate =
`/createrawtransaction '${JSON.stringify(rawInputs)}' '${JSON.stringify(rawOutputs)}' 0 ${expiry}`;

  const powershellSign =
`/signrawtransaction "HEX" '${JSON.stringify(signMeta)}' '["PRIVKEY"]' 'ALL'`;

  const powershellSignWithFileOutput =
`${powershellSign} | Tee-Object -FilePath "${psFile}"`;

  return {
    linuxCreate,
    linuxSign,
    linuxSignWithFileOutput,
    powershellCreate,
    powershellSign,
    powershellSignWithFileOutput
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.get("/api/streams/summary", async (req, res) => {
res.set("Cache-Control", "no-store");
  try {
    cleanupExpiredOrdersAndLocks();
    const out = {};

    for (const [key, info] of Object.entries(STREAMS)) {
      if (key === "CUSTOM") {
        out[key] = {
          address: "",
          balance: 0,
          received: 0,
          utxoCount: 0,
          status: "dynamic",
          health: estimateConsolidationHealth(0),
          keyholders: collectKeyholderActivity(key)
        };
        continue;
      }

      let balance = 0;
      let received = 0;
      let utxoCount = 0;

      try {
        const bal = await getAddressBalance(info.address);
        balance = bal.balance;
        received = bal.received;

        const utxos = await getAddressUtxos(info.address, info.redeemScript, { enrich: false });
        utxoCount = utxos.length;
      } catch (err) {
        console.error(`summary ${key} rpc error:`, err.message);
      }

      const orders = getOrders(key);
      const currentStatus = orders.some((o) => o.status === "openorder")
        ? "openorder"
        : orders.some((o) => o.status === "pending")
        ? "pending"
        : "idle";

      out[key] = {
        address: info.address,
        balance,
        received,
        utxoCount,
        status: currentStatus,
        health: estimateConsolidationHealth(utxoCount),
        keyholders: collectKeyholderActivity(key)
      };
    }

    res.json({ streams: out });
  } catch (err) {
    res.status(500).json({ error: err.message || "summary error" });
  }
});

app.post("/api/stream/:stream/summary", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();
    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const runtime = getStreamRuntimeConfig(stream, req.body);
    if (!runtime?.address) return res.status(400).json({ error: "address is required" });

    const bal = await getAddressBalance(runtime.address);
    const utxos = await getAddressUtxos(runtime.address, runtime.redeemScript, { enrich: false });

    const orders = getOrders(stream).filter((o) => o.address === runtime.address);
    const status = orders.some((o) => o.status === "openorder")
      ? "openorder"
      : orders.some((o) => o.status === "pending")
      ? "pending"
      : "idle";

    res.json({
      address: runtime.address,
      balance: bal.balance,
      received: bal.received,
      utxoCount: utxos.length,
      status,
      health: estimateConsolidationHealth(utxos.length),
      keyholders: collectKeyholderActivity(stream)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "stream summary error" });
  }
});

app.post("/api/stream/:stream/utxos", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();
    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const runtime = getStreamRuntimeConfig(stream, req.body);
    if (!runtime?.address) return res.status(400).json({ error: "address is required" });

    const offset = Math.max(0, Number(req.query.offset || req.body?.offset || 0));
    const requestedLimit = Number(req.query.limit || req.body?.limit || 100);
    const showAll = String(req.query.showAll || req.body?.showAll || '').toLowerCase() === 'true';
    const limit = showAll ? 5000 : Math.min(500, Math.max(1, requestedLimit || 100));

    const rawUtxos = await getAddressUtxos(runtime.address, runtime.redeemScript, { enrich: false });
    const total = rawUtxos.length;
    const page = rawUtxos.slice(offset, offset + limit);
    const enriched = await enrichUtxosWithSourceMeta(page, { batchSize: 25 });

    const locks = getLocks();
    const items = enriched.map((u) => {
      const lk = locks[lockKey(u.txid, u.vout)];
      return {
        ...u,
        locked: !!lk && (!lk.expiresAtTs || nowTs() <= lk.expiresAtTs),
        lock: lk || null
      };
    });

    const nextOffset = offset + items.length;
    res.json({
      items,
      total,
      offset,
      limit,
      nextOffset,
      hasMore: nextOffset < total,
      shown: nextOffset,
      spendableShown: items.filter((u) => !u.coinbase).length,
      coinbaseShown: items.filter((u) => !!u.coinbase).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "stream utxos error" });
  }
});

app.get("/api/z-addresses", async (req, res) => {
  try {
    const addresses = await rpcCall("z_listaddresses", []);
    res.json({ addresses: Array.isArray(addresses) ? addresses : [] });
  } catch (err) {
    res.status(500).json({ error: err.message || "z-list error" });
  }
});

app.post("/api/stream/:stream/shield-coinbase", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();
    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const runtime = getStreamRuntimeConfig(stream, req.body);
    if (!runtime?.address) return res.status(400).json({ error: "address is required" });
    const zAddress = String(req.body?.zAddress || '').trim();
    if (!zAddress || !zAddress.startsWith('z')) {
      return res.status(400).json({ error: 'valid z-address is required' });
    }

    const utxos = await getAddressUtxos(runtime.address, runtime.redeemScript);
    const coinbaseUtxos = utxos.filter((u) => !!u.coinbase);
    if (!coinbaseUtxos.length) {
      return res.status(400).json({ error: 'no coinbase UTXO available to shield' });
    }

    const result = await rpcCall('z_shieldcoinbase', [runtime.address, zAddress]);
    res.json({ ok: true, result, coinbaseCount: coinbaseUtxos.length, fromAddress: runtime.address, zAddress });
  } catch (err) {
    res.status(500).json({ error: err.message || 'shield-coinbase error' });
  }
});

app.get("/api/stream/:stream/orders", (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();
    const stream = String(req.params.stream || "").toUpperCase();
    if (!STREAMS[stream] && stream !== "CUSTOM") {
      return res.status(404).json({ error: "unknown stream" });
    }
    res.json({ orders: getOrders(stream).map((o) => enrichOrderWithSigningMeta(publicOrder(o))) });
  } catch (err) {
    res.status(500).json({ error: err.message || "orders error" });
  }
});

app.get("/api/stream/:stream/order/:orderId", (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();
    const stream = String(req.params.stream || "").toUpperCase();
    const orderId = String(req.params.orderId || "").trim();

    if (!STREAMS[stream] && stream !== "CUSTOM") {
      return res.status(404).json({ error: "unknown stream" });
    }
    if (!orderId) return res.status(400).json({ error: "orderId is required" });

    const orders = getOrders(stream);
    const order = orders.find((o) => o.id === orderId);
    if (!order) return res.status(404).json({ error: "order not found" });

    const cli = buildCliCommands(order);
    const ownerToken = String(req.query.ownerToken || "").trim();
    const pin = normalizePin(req.query.pin || "");
    const ownerOk = !!ownerToken && ownerToken === String(order.ownerToken || "");
    const pinOk = !!pin && pin === String(order.pin || "");
    res.json({
      order: enrichOrderWithSigningMeta(ownerViewOrder(order, ownerOk ? ownerToken : "", pinOk)),
      cli,
      ownerAuthorized: ownerOk,
      pinAccepted: pinOk
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "get order error" });
  }
});



app.post("/api/debug/custom-build", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.body?.stream || "CUSTOM").toUpperCase();
    const ctx = resolveStreamContext(stream, req.body);

    const info = {
      label: ctx.label,
      address: ctx.address,
      redeemScript: ctx.redeemScript || ""
    };

    const fee = Number(req.body?.fee || DEFAULT_FEE);
    const maxInputs = Number(req.body?.maxInputs || DEFAULT_MAX_INPUTS);
    const maxEstimatedBytes = Number(req.body?.maxEstimatedBytes || DEFAULT_MAX_ESTIMATED_BYTES);

    const utxos = await getAddressUtxos(info.address, info.redeemScript);
    const unlocked = utxos.filter((u) => !u.spendRestricted && !isInputLockedByOtherOrder(u.txid, u.vout));

    const pick = autoSelectForConsolidate(utxos, fee, maxInputs, maxEstimatedBytes);

    res.json({
      ok: true,
      ctx,
      fee,
      maxInputs,
      maxEstimatedBytes,
      utxoCount: utxos.length,
      unlockedCount: unlocked.length,
      firstUtxos: utxos.slice(0, 10),
      firstUnlocked: unlocked.slice(0, 10),
      pick
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "debug custom build error" });
  }
});

app.get("/api/stream/:stream/history", (req, res) => {
  try {
    const stream = String(req.params.stream || "").toUpperCase();
    if (!STREAMS[stream] && stream !== "CUSTOM") {
      return res.status(404).json({ error: "unknown stream" });
    }

    const offset = Math.max(0, Number(req.query.offset || 0));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const items = getHistory(stream);
    const sliced = items.slice(offset, offset + limit).map((item) => ({
      ...enrichOrderWithSigningMeta(publicOrder(item)),
      cli: buildCliCommands(item)
    }));

    res.json({ history: sliced, total: items.length, offset, limit, hasMore: offset + limit < items.length });
  } catch (err) {
    res.status(500).json({ error: err.message || "history error" });
  }
});

app.post("/api/stream/:stream/build", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.params.stream || "").toUpperCase();

    let ctx;
    if (stream === "CUSTOM") {
      const address = String(req.body?.address || req.body?.customAddress || "").trim();
      const redeemScript = String(req.body?.redeemScript || req.body?.customRedeemScript || "").trim();

      if (!address) {
        return res.status(400).json({ error: "custom address missing" });
      }

      ctx = {
        streamKey: "CUSTOM",
        label: "Custom Multisig",
        address,
        redeemScript
      };
    } else {
      if (!streamExists(stream)) {
        return res.status(404).json({ error: "unknown stream" });
      }

      const s = streamInfo(stream);
      ctx = {
        streamKey: stream,
        label: s.label,
        address: s.address,
        redeemScript: s.redeemScript || ""
      };
    }

    const info = {
      label: ctx.label,
      address: ctx.address,
      redeemScript: ctx.redeemScript || ""
    };

    const mode = String(req.body?.mode || "send").toLowerCase() === "consolidate" ? "consolidate" : "send";
    const destination = String(req.body?.destination || "").trim();
    const requestedAmount = Number(req.body?.amount || 0);
    const amount = mode === "consolidate" ? 0 : requestedAmount;
    const requestedFee = Number(req.body?.fee || DEFAULT_FEE);
    const feeTouched = !!req.body?.feeTouched;
    const locktime = Number(req.body?.locktime || 0);
    const expiryPreset = String(req.body?.expiryPreset || "24h");
    const manualExpiryHeight = req.body?.expiryheight;
    const currentBlock = await getCurrentBlockHeight();
    const expiryheight = Number(
      manualExpiryHeight && Number(manualExpiryHeight) > 0
        ? Number(manualExpiryHeight)
        : currentBlock + blocksForPreset(expiryPreset)
    );
    const maxInputs = Number(req.body?.maxInputs || DEFAULT_MAX_INPUTS);
    const maxEstimatedBytes = Number(req.body?.maxEstimatedBytes || DEFAULT_MAX_ESTIMATED_BYTES);

    const utxos = await getAddressUtxos(info.address, info.redeemScript);

    let pick;
    if (mode === "consolidate") {
      // première passe sans fee réel, juste pour choisir les inputs
      pick = autoSelectForConsolidate(utxos, 0, maxInputs, maxEstimatedBytes);
    } else {
      pick = autoSelectForSend(utxos, amount, requestedFee, maxInputs, maxEstimatedBytes);
    }

    if (!pick.selected.length) {
      return res.status(400).json({
        error: "Aucun UTXO disponible pour cette transaction",

        debug: {
          stream: ctx.streamKey,
          address: info.address,
          utxoCount: utxos.length,
          unlockedCount: utxos.filter((u) => !u.spendRestricted && !isInputLockedByOtherOrder(u.txid, u.vout)).length,
          requestedFee,
          maxInputs,
          maxEstimatedBytes
        }
      });
    }

    const inputs = pick.selected.map((u) => ({ txid: u.txid, vout: u.vout }));
    const inputCount = inputs.length;
    const outputCount = mode === "consolidate" ? 1 : 2;
    const estimatedBytes = estimateBytesMultisig(inputCount, outputCount, mode);
    const minimumFeeSats = Math.ceil(estimatedBytes);
    const feeSats = feeTouched
      ? Math.max(btczToZatoshi(requestedFee), minimumFeeSats)
      : minimumFeeSats;
    const fee = satsToBtcz(feeSats);

    if (mode === "consolidate") {
      pick = autoSelectForConsolidate(utxos, fee, maxInputs, maxEstimatedBytes);
    } else {
      pick = autoSelectForSend(utxos, amount, fee, maxInputs, maxEstimatedBytes);
    }

    if (!pick.complete) {
      return res.status(400).json({
        error: mode === "consolidate"
          ? "Consolidation impossible avec la limite actuelle"
          : "Fonds insuffisants avec la limite actuelle"
      });
    }

    const restricted = pick.selected.filter((u) => !!u.spendRestricted);
    if (restricted.length) {
      return res.status(400).json({
        error: 'Coinbase UTXO must be shielded to a z-address first',
        restrictedUtxos: restricted.map((u) => ({ txid: u.txid, vout: u.vout, amount: u.amount, reason: u.restrictionReason }))
      });
    }

    const finalInputs = pick.selected.map((u) => ({ txid: u.txid, vout: u.vout }));
    const finalInputCount = finalInputs.length;
    const finalOutputCount = mode === "consolidate" ? 1 : 2;
    const finalEstimatedBytes = estimateBytesMultisig(finalInputCount, finalOutputCount, mode);
    const finalMinimumFeeSats = Math.ceil(finalEstimatedBytes);
    const finalFeeSats = feeTouched
      ? Math.max(btczToZatoshi(requestedFee), finalMinimumFeeSats)
      : finalMinimumFeeSats;
    const finalFee = satsToBtcz(finalFeeSats);

    const outputs = buildOutputs(mode, info.address, destination, amount, finalFee, pick.totalInputs);
    const hex = await rpcCall("createrawtransaction", [finalInputs, outputs, locktime, expiryheight]);

    const finalEstimatedBytesValue = finalEstimatedBytes;
    const hexBytes = Math.ceil(String(hex || "").length / 2);
    const selectionNote = mode === "consolidate"
      ? "consolidate balaie les UTXO jusqu'à la limite; amount est ignoré; fee auto = 1 sat/byte"
      : "send prend le minimum d'UTXO nécessaire";

    const order = {
      id: txRefId(),
      stream: ctx.streamKey,
      address: info.address,
      redeemScript: info.redeemScript || "",
      requiredSigs: getRequiredSigsFromRedeem(info.redeemScript || ""),
      totalKeys: getTotalKeysFromRedeem(info.redeemScript || ""),
      mode,
      status: "pending",
      createdAt: nowIso(),
      createdTs: nowTs(),
      expiresAtTs: nowTs() + PENDING_MS,
      timerStopped: false,
      unsignedHex: hex,
      unsignedHash: hashHex(hex),
      inputs: finalInputs,
      selectedUtxos: pick.selected,
      outputs,
      amount: Number(amount.toFixed(8)),
      fee: Number(finalFee.toFixed(8)),
      feeSats: Number(finalFeeSats),
      feeAuto: !feeTouched,
      feeMode: feeTouched ? "manual_or_min_1sat_per_byte" : "auto_min_1sat_per_byte",
      totalInputs: Number(pick.totalInputs.toFixed(8)),
      change: mode === "consolidate"
        ? Number((pick.totalInputs - finalFee).toFixed(8))
        : Number((pick.totalInputs - amount - finalFee).toFixed(8)),
      keyholder1Hex: "",
      keyholder2Hex: "",
      keyholder3Hex: "",
      keyholder1AtTs: 0,
      keyholder2AtTs: 0,
      keyholder3AtTs: 0,
      signedCount: 0,
      finalHex: "",
      txid: "",
      inputCount,
      outputCount,
      estimatedBytes,
      hexBytes,
      selectionNote,
      requestedAmount: Number(requestedAmount.toFixed(8)),
      currentBlock,
      expiryPreset,
      expiryheight,
      address: info.address,
      redeemScript: info.redeemScript || "",
      requiredSigs: getRequiredSigsFromRedeem(info.redeemScript || ""),
      totalKeys: getTotalKeysFromRedeem(info.redeemScript || ""),
      pin: normalizePin(req.body?.customPin || "") || generateOrderPin(),
      pinFails: 0,
      pinCooldownUntil: 0,
      ownerToken: generateOwnerToken(),
      summaryText: [
        `Mode: ${mode}`,
        `Requested amount: ${Number(requestedAmount || 0).toFixed(8)} BTCZ`,
        `Effective amount: ${Number(amount || 0).toFixed(8)} BTCZ`,
        `Fee: ${Number(finalFee || 0).toFixed(8)} BTCZ`,
        `Total inputs: ${Number(pick.totalInputs || 0).toFixed(8)} BTCZ`,
        `Change: ${mode === "consolidate" ? Number((pick.totalInputs - finalFee).toFixed(8)) : Number((pick.totalInputs - amount - finalFee).toFixed(8))} BTCZ`,
        `Inputs used: ${inputCount}`,
        `Outputs used: ${outputCount}`,
        `Estimated bytes: ${estimatedBytes}`,
        `Fee sats: ${finalFeeSats}`,
        `Fee mode: ${mode === "consolidate" ? "1 sat/byte" : "manual or minimum 1 sat/byte"}`,
        `HEX bytes: ${hexBytes}`,
        `Current block: ${currentBlock}`,
        `Expiry preset: ${expiryPreset}`,
        `Expiry height: ${expiryheight}`,
        `Note: ${selectionNote}`
      ].join("\n")
    };

    const orders = getOrders(ctx.streamKey);
    orders.unshift(order);
    setOrders(ctx.streamKey, orders);
    lockInputsForOrder(order);

    const cli = buildCliCommands(order);

    res.json({
      ok: true,
      order: enrichOrderWithSigningMeta(ownerViewOrder(order, order.ownerToken)),
      hex,
      inputs: finalInputs,
      selectedUtxos: pick.selected,
      outputs,
      totalInputs: order.totalInputs,
      amount: order.amount,
      fee: order.fee,
      feeSats: order.feeSats,
      feeAuto: order.feeAuto,
      feeMode: order.feeMode,
      change: order.change,
      estimatedBytes: order.estimatedBytes,
      hexBytes: order.hexBytes,
      inputCount: order.inputCount,
      outputCount: order.outputCount,
      selectionNote: order.selectionNote,
      summaryText: order.summaryText,
      currentBlock: order.currentBlock,
      expiryPreset: order.expiryPreset,
      expiryheight: order.expiryheight,
      cli,
      pin: order.pin,
      ownerToken: order.ownerToken
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "build error" });
  }
});

app.post("/api/decoderawtransaction", async (req, res) => {
  try {
    const hex = String(req.body?.hex || "").trim();
    if (!hex) return res.status(400).json({ error: "hex is required" });
    const result = await decodeHex(hex);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message || "decoderawtransaction error" });
  }
});

app.post("/api/stream/:stream/submit-keyholder", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const orderId = String(req.body?.orderId || "").trim();
    const slot = Number(req.body?.slot || 0);
    const hex = String(req.body?.hex || "").trim();

    if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: "slot must be 1, 2 or 3" });
    if (!orderId) return res.status(400).json({ error: "orderId is required" });
    if (!hex) return res.status(400).json({ error: "hex is required" });

    const { orders, index: idx, order } = findOrderIndex(stream, orderId);
    if (idx === -1) return res.status(404).json({ error: "order not found" });

    const pinCheck = verifyOrderPin(order, req.body?.pin);
    if (!pinCheck.ok) {
      setOrders(stream, orders);
      return res.status(pinCheck.status).json({ error: pinCheck.error });
    }

    if (order.status === "broadcasted") return res.status(400).json({ error: "order already broadcasted" });
    if (order[`keyholder${slot}Hex`]) return res.status(400).json({ error: `K${slot} already submitted` });

    const validation = await validateSubmittedHex(order, hex);
    if (!validation.ok) return res.status(400).json({ error: validation.reason || "invalid keyholder hex" });

    const effectiveRedeem = getEffectiveRedeemScript(order);
    const analysis = deriveSigningMetaFromDecoded(validation.decoded, effectiveRedeem);
    if (analysis.signedCount !== slot) {
      return res.status(400).json({ error: `K${slot} requires exactly ${slot}of${analysis.totalKeys} signed` });
    }

    order.address = getEffectiveAddress(order);
    order.redeemScript = effectiveRedeem;
    order.requiredSigs = analysis.requiredSigs;
    order.totalKeys = analysis.totalKeys;
    order[`keyholder${slot}Hex`] = hex;
    order[`keyholder${slot}AtTs`] = nowTs();
    order.signedCount = analysis.signedCount;

    if (analysis.signedCount >= 1 && order.status === "pending") {
      order.status = "openorder";
      order.timerStopped = true;
      order.expiresAtTs = nowTs() + OPENORDER_MS;
      refreshLocksForOrder(order);
    }

    if (analysis.complete && !order.finalHex) {
      order.finalHex = hex;
      order.status = "complete";
    }

    orders[idx] = order;
    setOrders(stream, orders);

    res.json({ ok: true, order: enrichOrderWithSigningMeta(ownerViewOrder(order, String(req.body?.ownerToken || ""))) });
  } catch (err) {
    res.status(500).json({ error: err.message || "submit-keyholder error" });
  }
});

app.post("/api/stream/:stream/finalize", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const orderId = String(req.body?.orderId || "").trim();
    const finalHex = String(req.body?.finalHex || "").trim();

    if (!orderId) return res.status(400).json({ error: "orderId is required" });
    if (!finalHex) return res.status(400).json({ error: "finalHex is required" });

    const { orders, index: idx, order } = findOrderIndex(stream, orderId);
    if (idx === -1) return res.status(404).json({ error: "order not found" });

    const pinCheck = verifyOrderPin(order, req.body?.pin);
    if (!pinCheck.ok) {
      setOrders(stream, orders);
      return res.status(pinCheck.status).json({ error: pinCheck.error });
    }

    const validation = await validateSubmittedHex(order, finalHex);
    if (!validation.ok) return res.status(400).json({ error: validation.reason || "invalid final hex" });

    const effectiveRedeem = getEffectiveRedeemScript(order);
    const analysis = deriveSigningMetaFromDecoded(validation.decoded, effectiveRedeem);
    if (analysis.signedCount < analysis.requiredSigs) {
      return res.status(400).json({ error: "Not enough signatures for this redeem script" });
    }

    order.address = getEffectiveAddress(order);
    order.redeemScript = effectiveRedeem;
    order.requiredSigs = analysis.requiredSigs;
    order.totalKeys = analysis.totalKeys;
    order.finalHex = finalHex;
    order.signedCount = analysis.signedCount;
    order.status = "final";
    order.timerStopped = true;
    order.expiresAtTs = nowTs() + OPENORDER_MS;
    orders[idx] = order;
    setOrders(stream, orders);
    refreshLocksForOrder(order);

    res.json({ ok: true, order: enrichOrderWithSigningMeta(ownerViewOrder(order, String(req.body?.ownerToken || ""))) });
  } catch (err) {
    res.status(500).json({ error: err.message || "finalize error" });
  }
});

app.post("/api/stream/:stream/broadcast", async (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.params.stream || "").toUpperCase();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });

    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId is required" });

    const { orders, index: idx, order } = findOrderIndex(stream, orderId);
    if (idx === -1) return res.status(404).json({ error: "order not found" });

    const pinCheck = verifyOrderPin(order, req.body?.pin);
    if (!pinCheck.ok) {
      setOrders(stream, orders);
      return res.status(pinCheck.status).json({ error: pinCheck.error });
    }

    const orderOwnerToken = String(req.body?.ownerToken || "");
    const finalHex = String(req.body?.finalHex || order.finalHex || "").trim();
    if (!finalHex) return res.status(400).json({ error: "finalHex is required" });

    const validation = await validateSubmittedHex(order, finalHex);
    if (!validation.ok) return res.status(400).json({ error: validation.reason || "invalid broadcast hex" });

    const effectiveRedeem = getEffectiveRedeemScript(order);
    const analysis = deriveSigningMetaFromDecoded(validation.decoded, effectiveRedeem);
    if (analysis.signedCount < analysis.requiredSigs) {
      return res.status(400).json({ error: 'final hex is not complete enough to broadcast' });
    }

    const txid = await rpcCall("sendrawtransaction", [finalHex]);

    order.address = getEffectiveAddress(order);
    order.redeemScript = effectiveRedeem;
    order.requiredSigs = analysis.requiredSigs;
    order.totalKeys = analysis.totalKeys;
    order.finalHex = finalHex;
    order.signedCount = analysis.signedCount;
    order.txid = txid;
    order.status = "broadcasted";
    order.timerStopped = true;
    order.broadcastAt = nowIso();

    pushHistory(stream, order);

    orders.splice(idx, 1);
    setOrders(stream, orders);
    unlockInputsForOrder(order);

    res.json({ ok: true, txid, order: enrichOrderWithSigningMeta(ownerViewOrder(order, orderOwnerToken)) });
  } catch (err) {
    res.status(500).json({ error: err.message || "broadcast error" });
  }
});

app.delete("/api/stream/:stream/order/:orderId", express.json({ limit: "1mb" }), (req, res) => {
  try {
    cleanupExpiredOrdersAndLocks();

    const stream = String(req.params.stream || "").toUpperCase();
    const orderId = String(req.params.orderId || "").trim();

    if (!STREAMS[stream] && stream !== "CUSTOM") {
      return res.status(404).json({ error: "unknown stream" });
    }
    if (!orderId) return res.status(400).json({ error: "orderId is required" });

    const { orders, index: idx, order } = findOrderIndex(stream, orderId);
    if (idx === -1) return res.status(404).json({ error: "order not found" });

    const pinCheck = verifyOrderPin(order, req.body?.pin || req.query.pin);
    if (!pinCheck.ok) {
      setOrders(stream, orders);
      return res.status(pinCheck.status).json({ error: pinCheck.error });
    }
    if (String(order.status || '').toLowerCase() === 'broadcasted' || order.txid) {
      return res.status(400).json({ error: 'broadcasted orders cannot be cancelled' });
    }
    unlockInputsForOrder(order);
    orders.splice(idx, 1);
    setOrders(stream, orders);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "delete order error" });
  }
});

app.post("/api/stream/:stream/order/:orderId/access", (req, res) => {
  try {
    const stream = String(req.params.stream || "").toUpperCase();
    const orderId = String(req.params.orderId || "").trim();
    if (!streamExists(stream)) return res.status(404).json({ error: "unknown stream" });
    const { order } = findOrderIndex(stream, orderId);
    if (!order) return res.status(404).json({ error: "order not found" });

    const ownerToken = String(req.body?.ownerToken || "").trim();
    const pin = normalizePin(req.body?.pin || "");
    const ownerOk = !!ownerToken && ownerToken === String(order.ownerToken || "");
    const pinOk = !!pin && pin === String(order.pin || "");

    res.json({
      ok: ownerOk || pinOk,
      ownerAuthorized: ownerOk,
      pinAccepted: pinOk,
      order: enrichOrderWithSigningMeta(ownerViewOrder(order, ownerOk ? ownerToken : "", pinOk))
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "order access error" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDataDir();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`btcz-multisig listening on ${PORT}`);
});
