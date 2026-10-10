# ADR-3: Credentials are sealed with AES-256-GCM under a server-held key

`AuthMethod.credentialCiphertext` must be unreadable at rest; `INPUT.md` §3.1 forbids plaintext API keys and §12 leaves the scheme to the implementer.

## Context

Bun provides `crypto.subtle` with AES-GCM, so authenticated encryption needs no dependency. Implemented in `src/crypto/secrets.ts`.

## Decision

AES-256-GCM with a 256-bit key read from `NEXUS_SECRET_KEY_FILE` (mode 0600, generated on first run). Each record gets a fresh 12-byte IV; the envelope is `v1.<iv>.<tag>.<ciphertext>`, all base64. Decryption rejects a malformed envelope and fails authentication on any tampering.

## Consequences

- Tampering and wrong-key reads fail loudly rather than returning garbage.
- The version prefix allows a future scheme change without a data migration guess.
- Losing the key file makes stored credentials unrecoverable; users must re-enter them. That is the intended failure mode.
- The key is not rotated in V1; rotation would need a re-encrypt pass.
- GCM is not nonce-reuse safe, so the IV must stay random per record — never derived from the plaintext.

## Related

- `docs/plans/pi-session-server.md` — ADR-3
- `src/crypto/secrets.ts`, `test/unit/secrets.test.ts`
