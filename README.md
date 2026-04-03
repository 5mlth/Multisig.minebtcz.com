# BTCZ Multisig Coordinator v1

Experimental multisig coordination tool for BitcoinZ-style t3 multisig.

## Features
- Build send/consolidate transactions
- Open orders
- Keyholder signature workflow
- History
- Custom stream support
- CLI templates

## Status
Alpha / experimental

## Safety
Do not use production funds without review and testing.
Never commit private keys, RPC passwords, or real secrets.

## Run
1. Copy `.env.example` to `.env`
2. Fill in your values
BTCZ_RPC_USER=your_rpc_user
BTCZ_RPC_PASSWORD=your_rpc_password
3. Start with Docker Compose

How It Works

This tool is a **multisig coordination engine** designed for t3 (P2SH) multisig addresses.

It allows multiple keyholders to safely build, sign, and broadcast transactions together.

### Step 1 – Load a Multisig

You can use:

- An official stream (BP / ZF / MG)
- Or your own multisig via **Open Custom Multisig**

For custom usage:

- Enter your **t3 address**
- Enter your **redeem script**
- Click **Load Custom Multisig**

The system will load:

- UTXOs
- Balance
- Open orders
- History

### Step 2 – Build a Transaction

You can choose between:

**Consolidate**
- Merges UTXOs
- Sends everything back to the same t3 address
- Fee is automatically calculated (1 sat/byte)

**Send**
- Enter a destination (t1 address)
- Enter amount

Click **Auto Build Transaction**

The transaction is valid for **10 minutes** after creation.

### Step 3 – Sign (Keyholders)

Each keyholder:

1. Copies the HEX
2. Uses the provided CLI template
3. Replaces `PRIVKEY` with their private key
4. Signs locally
5. Pastes the signed HEX in the interface

### Step 4 – Open Order

Once the **first valid signature** is submitted:

- The transaction becomes an **Open Order**
- Remaining keyholders have **7 days** to sign
- Multiple transactions can run in parallel

### Step 5 – Finalize & Broadcast

- Click **Finalize**
- Then **Broadcast**

The transaction is sent to the network.

## 🤝 Why This Tool Matters

Traditional multisig is often:

- Manual
- Error-prone
- Hard to coordinate

This tool solves that by providing:

- Shared transaction state
- Signature validation
- Parallel workflows
- Clear UI + CLI integration

## 🌍 Use Cases

This tool can be used by **any multisig team**, not just BTCZ.

### Treasury Management
- Shared funds between multiple operators
- Secure spending approval

### Mining Pools
- Coordinated payouts
- UTXO consolidation

### Teams / DAOs
- Multi-member fund control
- Transparent coordination

### Infrastructure Operators
- Cold storage workflows
- Multi-key security

## 🧠 Key Idea

This is not just a wallet.

It is a **multisig coordination system**.

## ⚠️ Important

- Private keys never leave the keyholders
- Always sign locally
- Do not use production funds without testing

## 💡 Open Custom Advantage

Any team can plug in their own multisig and use the same workflow as the official BTCZ keyholders.
