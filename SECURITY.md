# Security policy

## Supported versions

Security fixes are applied to the latest published minor line. This repository is currently
on the 0.2.x line; older snapshots may not receive fixes.

## Reporting a vulnerability

Please use the private **Security → Advisories** channel at
<https://github.com/PandaBoby/dsh-credential-hub/security/advisories/new>. Do not open a
public issue containing exploit steps, a private key, a PAT, a passphrase, or an exported
bundle. If that channel is unavailable, contact `@PandaBoby` and ask for a private channel
before sending details.

Include the affected version/commit, a minimal reproduction, and the impact. We will
acknowledge the report, investigate, and coordinate a fix and disclosure. No response-time
or bounty guarantee is implied.

## Threat model and boundaries

The intended boundary is that **plaintext credentials never enter a model-visible channel**:

- `inventory.yml` contains metadata and `credentialRef` names only. It is trusted local
  configuration, not a place for secrets.
- `credential_hub_match` and the system-prompt section are metadata-only.
- `credential_hub_resolve` reports presence/source and a fixed mask; it does not return the
  value.
- SSH and PAT tools resolve values inside the Host process and redact echoed values from
  results and errors.
- The settings page can write a value through `ctx.credentials.set()` and can export an
  encrypted bundle. Export returns ciphertext only; import decrypts and validates in the
  Host. Passphrases and private keys are not written to the inventory or logs.
- The settings routes rely on DSH Connection authentication and Host/Origin checks; they do
  not add an independent authentication layer.

Out of scope for this boundary: a compromised OS account, a malicious DSH build or plugin
running with the same privileges, a browser/DevTools compromise while a passphrase is
typed, and the operator voluntarily sharing an exported bundle and passphrase. SSH host-key
trust and PAT endpoint trust remain operator decisions; see the README for the defaults.

## Handling secrets

If you accidentally expose a key or token, rotate it in its source system and update the
DSH credential store. Deleting a file or a chat message is not sufficient once the value
has left the machine. If an exported bundle is exposed, treat every credential referenced
by that export as compromised and rotate them.
