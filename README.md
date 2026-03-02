# Sovereign Vault

**Passphrase-only at-rest encryption for AI agents** — a hierarchical key derivation system where a single passphrase protects all agent state. No OS keystores. No machine binding. No recovery backdoor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![sodium-native](https://img.shields.io/badge/crypto-sodium--native-green.svg)](https://github.com/nicedoc/sodium-native)

---

## The Problem

Desktop AI agents store sensitive data: private keys, memories, API keys, trust graphs, conversation history. Most Electron apps protect these with `safeStorage` (DPAPI on Windows, Keychain on macOS). But:

- An attacker with OS admin access can crack DPAPI/Keychain in minutes
- Machine-bound keys mean losing your machine loses your agent
- Platform keystores are transparent to admin-level attackers
- Recovery phrases stored on disk defeat their purpose

The current state of the art is: *your agent's secrets are as secure as your OS login password.*

## The Solution

Replace the entire key hierarchy with **a single root of trust the user carries in their head**: a passphrase sentence.

```
User Passphrase (>=8 words, never stored, never on disk)
  + salt (16 bytes random, stored in .vault-salt)
  |
  v  Argon2id (opslimit=4, memlimit=256MB)
  |
  masterKey (32 bytes, SecureBuffer -- zeroed after ~100ms)
  |
  +-- BLAKE2b KDF (id=1, ctx="AF_VAULT") --> vaultKey    (AES-256-GCM for all vault files)
  +-- BLAKE2b KDF (id=2, ctx="AF_HMAC_") --> hmacKey     (HMAC-SHA256 integrity signing)
  +-- BLAKE2b KDF (id=3, ctx="AF_IDENT") --> identityKey (wrapping Ed25519/X25519 private keys)
```

**The cost of attack goes from "run mimikatz" (seconds) to "brute-force Argon2id with 256MB memory per attempt" (millennia).**

## Key Innovations

### SecureBuffer — Guard-Paged Memory

All key material lives in `sodium_malloc()` backed memory with:

- **Guard pages** — Memory access violations on buffer overflow/underflow
- **mlock** — Pinned to RAM, never swapped to disk
- **Three-state protection**: NOACCESS (default), READONLY, READWRITE
- **Canary bytes** — Detect heap corruption
- **Automatic zeroing** on destroy

```typescript
import { SecureBuffer } from 'sovereign-vault';

// Allocate secure memory (starts in NOACCESS state)
const key = SecureBuffer.alloc(32);

// The withAccess() borrow pattern (inspired by Rust's ownership model)
key.withAccess('readwrite', (buf) => {
  // buf is writable only inside this callback
  buf.set(keyMaterial);
});
// Automatically returns to NOACCESS when callback exits

// Copy from source and wipe source
const imported = SecureBuffer.from(untrustedBuffer);
// untrustedBuffer is now zeroed, imported is READONLY

// Explicit cleanup
key.destroy(); // memzero + free
```

### Canary Verification

The vault verifies the passphrase without storing it or its hash:

```typescript
// On first setup: encrypt a known plaintext with the vault key
createCanary(vaultKey, vaultDir);

// On unlock: decrypt and check -- wrong passphrase = wrong key = decryption fails
const correct = verifyCanary(vaultKey, vaultDir);
if (!correct) {
  console.log('Wrong passphrase');
  // No password hash was exposed. No timing attack is possible.
}
```

### Two-Phase Boot

The vault enables a clean separation between pre-auth and post-auth application state:

```
Phase A (vault locked):
  - UI shell loads
  - Settings load (plaintext fallback)
  - Express server starts
  - Window renders PassphraseGate

Phase B (vault unlocked -- triggered by correct passphrase):
  - HMAC key injected into integrity system
  - Settings/memory/trust-graph reloaded from encrypted state
  - Agent network initialized with decrypted identity keys
  - All engines start
```

## Installation

```bash
npm install sovereign-vault
```

Requires `sodium-native` (libsodium bindings for Node.js).

## Usage

### Initialize a New Vault

```typescript
import { initializeNewVault, unlockVault, isVaultInitialized } from 'sovereign-vault';

// First-time setup
await initializeNewVault('my eight word passphrase that only I know');
// Creates: .vault-salt, .vault-canary, .vault-meta.json

// Subsequent launches
const success = await unlockVault('my eight word passphrase that only I know');
// Derives keys in 1-4 seconds (Argon2id is intentionally slow)
```

### Encrypt/Decrypt Files

```typescript
import { vaultWrite, vaultRead, vaultReadJSON } from 'sovereign-vault';

// Encrypt data to disk
await vaultWrite('/path/to/memories.vault', JSON.stringify(memories));

// Decrypt from disk
const data = vaultRead('/path/to/memories.vault');
const memories = vaultReadJSON<MemoryStore>('/path/to/memories.vault');
```

### Borrow Identity Keys

```typescript
import { withIdentityKey } from 'sovereign-vault';

// Borrow the decrypted Ed25519 private key for signing
const signature = await withIdentityKey((privateKey) => {
  return ed25519Sign(message, privateKey);
});
// privateKey is back in NOACCESS state -- cannot be read
```

### Graceful Degradation

```typescript
import { isVaultUnlocked, vaultRead } from 'sovereign-vault';

// When vault is locked, encrypted files return null (not crash)
const data = vaultRead('/path/to/secrets.vault');
if (data === null) {
  // Use plaintext fallback or show PassphraseGate
}
```

## Security Properties

| Property | Guarantee |
|----------|-----------|
| Key derivation | Argon2id (opslimit=4, memlimit=256MB) — 1-4 second derivation |
| Encryption | AES-256-GCM with random 12-byte IV per write |
| Key material in memory | sodium_malloc with guard pages, mlock, canary bytes |
| Master key lifetime | ~100ms (derived, sub-keys extracted, then destroyed) |
| Passphrase storage | Never stored, never hashed, never on disk |
| Machine binding | None — fully portable across machines |
| Recovery mechanism | None — the passphrase IS the recovery (by design) |
| OS dependency | None — no DPAPI, no Keychain, no safeStorage |

## Passphrase Requirements

- Minimum 8 words (enforced by API)
- No maximum length
- Unicode supported
- Normalized before derivation (NFKD)
- Never transmitted, logged, or stored

## Configuration

```typescript
import { ARGON2_OPSLIMIT, ARGON2_MEMLIMIT, KDF_CONTEXTS } from 'sovereign-vault';

// Tune Argon2id parameters (defaults are recommended)
// opslimit: 4 (iterations)
// memlimit: 268435456 (256MB)
// These create a 1-4 second derivation time — anti-brute-force by design

// KDF contexts for sub-key derivation
// "AF_VAULT" — vault file encryption key
// "AF_HMAC_" — integrity signing key
// "AF_IDENT" — identity key encryption key
```

## Part of the Agent Friday Ecosystem

Extracted from [Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday) — an open-source AGI operating system. The Sovereign Vault was designed as part of the "Crypto Sprint" security hardening initiative (21 sprints over 3 days) and the Sovereign Vault v2 architecture redesign.

**Related projects:**
- [Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday) — The AGI OS
- [claw-framework](https://github.com/FutureSpeakAI/claw-framework) — Compiled governance laws with attestation protocol
- [agent-integrity](https://github.com/FutureSpeakAI/agent-integrity) — HMAC-signed identity protection
- [trust-graph-engine](https://github.com/FutureSpeakAI/trust-graph-engine) — Multi-dimensional trust scoring

## Credits

Built by **Scott Webster** ([FutureSpeak.AI](https://github.com/FutureSpeakAI)) and **Claude Opus 4.6** (Anthropic).

The Sovereign Vault v2 architecture — passphrase-only key hierarchy, SecureBuffer with Rust-inspired borrow semantics, two-phase boot, and the philosophical framework of "the passphrase as a declaration of sovereignty" — was designed through an intensive collaborative session interpreted through Heidegger's hermeneutic circle: each component (passphrase, vault, SecureBuffer, boot sequence) was understood through the whole, and the whole was deepened by understanding each part.

## License

MIT — see [LICENSE](LICENSE)
