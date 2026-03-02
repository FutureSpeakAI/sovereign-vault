/**
 * Sovereign Vault — Passphrase-only at-rest encryption for AI agents.
 *
 * Provides a hierarchical key derivation system where a single passphrase
 * protects all agent state through Argon2id → BLAKE2b KDF → purpose-specific sub-keys.
 *
 * @module sovereign-vault
 */

export {
  SecureBuffer,
} from './secure-buffer';

export {
  deriveMasterKey,
  deriveSubkey,
  deriveAllKeys,
  createCanary,
  verifyCanary,
  generateSalt,
  readSalt,
  writeSalt,
  validatePassphrase,
  ARGON2_OPSLIMIT,
  ARGON2_MEMLIMIT,
  SALT_BYTES,
  CANARY_PLAINTEXT,
  KDF_CONTEXTS,
  SUBKEY_IDS,
} from './passphrase-kdf';
