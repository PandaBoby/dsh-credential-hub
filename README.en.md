<div align="center">

<h1>dsh-credential-hub</h1>

<p><strong>Credential routing for DSH: tag-matched SSH hosts and PAT tokens, with secret values kept out of prompts, tool arguments, and tool results.</strong></p>

<p><a href="README.en.md">English</a> · <a href="README.md">简体中文</a></p>

<p>
  <a href="https://github.com/PandaBoby/dsh-credential-hub/actions/workflows/ci.yml"><img src="https://github.com/PandaBoby/dsh-credential-hub/actions/workflows/ci.yml/badge.svg?branch=main&amp;style=flat-square" alt="CI status" /></a>
  <a href="https://github.com/PandaBoby/dsh-credential-hub/releases"><img src="https://img.shields.io/github/v/release/PandaBoby/dsh-credential-hub?style=flat-square&amp;label=release" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" alt="Node" /></a>
</p>

</div>

---

`dsh-credential-hub` adds a **credential routing layer** to
[DeepSeek Harness](https://github.com/deepseek-ai). It keeps a metadata inventory of SSH hosts
and PAT tokens so the model can find the right `alias` from natural language; the Host then
resolves the key or token internally and hands it directly to the system `ssh` or `fetch`.

The inventory stores only `credentialRef` names. Prompts contain metadata only. The Settings
page supports write-only value entry and AES-256-GCM encrypted transfer between machines.

> The Chinese README is the canonical version. This English translation is kept in sync.

<details>
<summary><strong>Contents</strong></summary>

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Tools](#tools)
- [Matching and prompts](#matching-and-prompts)
- [Encrypted transfer](#encrypted-transfer)
- [Configuration](#configuration)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Development and testing](#development-and-testing)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

</details>

## Features

- **Tag-matched routing.** Chinese/English tags, descriptions, aliases, hosts, and platforms
  participate in matching; production and staging references do not bleed into each other.
- **Metadata-only prompts.** The system prompt lists alias, tags, description, and
  `credentialRef` — never host, port, or key material.
- **Host-side resolution.** SSH and PAT tools read credentials inside the Host. Values never
  enter tool arguments, tool results, or the model context.
- **Settings UI.** Record CRUD, search, write-only values, runtime configuration, and encrypted
  import/export.
- **No build step.** The Host is ESM; the Client uses `React.createElement` and loads directly.

## Requirements

| Component | Requirement |
|---|---|
| DSH | `>= 0.2.2-rc.1`; tested with `0.2.2-rc.3` |
| Credentials service | profile must mount `@deepseek-ai/dsh-credentials-local` or an equivalent |
| Node.js | `>= 20`; the DSH runtime is sufficient |
| SSH | system OpenSSH client (required by the SSH tool) |

> Without a credentials service, the plugin stays at
> `pending (waiting for service: credentials)` instead of pretending the inventory is usable.

## Quick start

### 1. Install

Desktop: **Settings → Plugins → Add plugin → Install local plugin directory**, then select
this repository.

CLI (custom profile):

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-credential-hub
```

The bundle inserts a `credential-hub` row. Defaults live in
[`cordis.patch.yml`](cordis.patch.yml).

### 2. Add records

Open **Settings → Credential Routing Hub** and add records under **SSH hosts** or **PAT
tokens**. You can also edit the YAML directly:

```text
$DSH_HOME/credential-hub/inventory.yml
# usually ~/.dsh/credential-hub/inventory.yml
```

If the file does not exist, the plugin creates an empty 0600 inventory and a 0700 directory.
See [`examples/inventory.example.yml`](examples/inventory.example.yml).

```yaml
version: 1

ssh:
  - alias: prod-web-01
    tags: ["env:production", "service:web"]
    description: Production web host
    host: 10.0.0.10
    port: 22
    username: deploy
    credentialRef: SSH_PROD_WEB_KEY

pat:
  - alias: github-prod-token
    tags: ["platform:github", "env:production"]
    description: Production GitHub token
    platform: github
    baseUrl: https://api.github.com
    authScheme: bearer
    credentialRef: PAT_GITHUB_PROD
```

| Field | Meaning |
|---|---|
| `alias` | Globally unique, `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` |
| `tags` | String array, at most 32; `env:*`, `service:*`, `platform:*` are recommended |
| `description` | Human-readable description, at most 500 characters |
| `credentialRef` | DSH credential reference; **never a value** |
| SSH `host` / `username` | Required; `port` is optional and defaults to 22 |
| PAT `baseUrl` | Optional but strongly recommended; the token is scoped to this origin |
| PAT `authScheme` | `bearer` (default), `token`, `basic`, or `header` |
| PAT `headerName` / `username` | Required for `header` / `basic` modes |

### 3. Store the actual values

Private keys and tokens belong in the DSH credential store; the inventory keeps only the
reference:

- The Settings **Credential value** field is **write-only**: the value is stored without being
  echoed, written to the inventory, or returned.
- You can also use the **Settings → Account** credential area.
- From a trusted Host plugin, call `ctx.credentials.set()`:

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'

await ctx.credentials.set(credentialRef('SSH_PROD_WEB_KEY'), await readFile('id_ed25519', 'utf8'))
await ctx.credentials.set(credentialRef('PAT_GITHUB_PROD'), 'github_pat_...')
```

For tests or CI, startup environment variables work as a fallback:
`SSH_PROD_WEB_KEY=... PAT_GITHUB_PROD=... dsh ...`. Store values take precedence and rotations
apply on the next operation.

> **Never put a private key or PAT in `inventory.yml`.** Inventory validation rejects
> `privateKey`, `token`, `password`, `secret`, `passphrase`, and similar fields.

## How it works

```text
inventory.yml ──metadata──> system prompt section + credential_hub_match
      │
      └──credentialRef──> credential_hub_ssh_exec / credential_hub_pat_request
                                  │
                                  └── ctx.credentials.resolve()  (Host only)

Settings UI ──authenticated routes──> inventory CRUD / config
                                  └── ctx.credentials.set() / encrypted bundle
```

The inventory stores references only; the DSH credential service owns the values. SSH/PAT
tools resolve inside the Host and pass values directly to `ssh` or `fetch`. The model sees
metadata, exit status, and redacted output only.

### Two naming constraints

1. **`credentialRef` is a POSIX identifier.** The grammar is `^[A-Za-z_][A-Za-z0-9_]*$`;
   `ssh/prod-key` is rejected. Use `SSH_PROD_WEB_KEY`.
2. **Prompt variable names are lowercase with underscores.** The plugin registers
   `ssh_inventory_summary` and `pat_inventory_summary`, not camelCase names.

The prompt section uses order **3200**. First-party tool guidance currently occupies
1000–3100, so 3200 places the credential overview after tool guidance and before
`TOOLS_SDK` (5000).

## Tools

| Tool | Purpose | Touches a secret? |
|---|---|---|
| `credential_hub_match` | Match records from natural-language clues; returns metadata only; empty array on no match | No |
| `credential_hub_resolve` | Report whether a ref is configured, its source, and writability; returns a fixed mask | Checks presence, discards the value |
| `credential_hub_ssh_exec` | Run one command on a matched host; the Host resolves the key | Value only in Host memory and a 0600 temporary file |
| `credential_hub_pat_request` | Send an HTTP request with a matched PAT; the Host attaches the auth header | Value only in the Host request header |

### Typical flow

```text
User: check the web logs in production
→ credential_hub_match({ query: "production web logs", kind: "ssh" })
← [{ alias: "prod-web-01", kind: "ssh", tags: ["env:production","service:web"], ... }]
→ credential_hub_ssh_exec({ alias: "prod-web-01", command: "tail -n 20 /var/log/web/app.log" })
← ssh prod-web-01 ... exit 0 ... <redacted logs>
```

## Matching and prompts

- Case-insensitive; ASCII words, CJK 2–4 character n-grams, and tag key/value pairs all match.
- Built-in Chinese/English synonyms: `生产/线上/prod` → `production`, `测试/预发/stage` →
  `staging`, and more.
- An environment word in the query excludes records with a conflicting `env:*` tag; records
  without an `env` tag are treated as unknown.
- Action/platform words infer the kind; an explicit `kind` parameter wins.
- Multiple matches are returned in score order; the model chooses using `alias`, `tags`, and
  `description`.

Each system-prompt line contains only:

```text
- prod-web-01｜tags: env:production, service:web｜Production web host｜credentialRef: SSH_PROD_WEB_KEY
```

`{{...}}` inside descriptions is escaped so it cannot become a prompt variable. If the
inventory edit fails to parse, the prompt keeps the last usable snapshot and appends a
“last change could not be parsed” note; YAML errors report line/column and a code, never the
source line.

## Encrypted transfer

The **Import / Export** tab supports moving a setup between machines:

| Action | Behavior |
|---|---|
| Export | The Host reads the inventory and configured values, encrypts them, and returns ciphertext only |
| Merge import | Keeps current records; an imported alias replaces the current one |
| Replace import | Replaces the current inventory; old credential-store entries are not deleted |

- The passphrase must be at least 8 characters; it is never stored or echoed, and cannot be
  recovered after loss.
- Algorithm: scrypt (`N=32768, r=8, p=1`) derives a 256-bit key; AES-256-GCM; random 16-byte
  salt and 12-byte IV; AAD binds the format version.
- Envelope: `format=dsh-credential-hub.encrypted`, `version=1`, `kdf`, `cipher`, and
  `payload` (base64 ciphertext). Import accepts the same format version only.
- Decryption/format/inventory validation happens before any inventory write. If a credential
  write fails after the inventory is committed, the response names the failed refs.
- **The file is still sensitive**: anyone with the file and passphrase can recover every
  configured credential. Transfer it over a trusted channel, delete temporary copies, and
  import bundles you created yourself.

## Configuration

`cordis.patch.yml` row config (also overridable in the profile user patch layer):

| Field | Default | Meaning |
|---|---|---|
| `inventoryPath` | `''` | Empty means `$DSH_CREDENTIAL_HUB_INVENTORY` or `$DSH_HOME/credential-hub/inventory.yml` |
| `promptSection` | `true` | Inject the metadata overview |
| `maxPromptEntriesPerKind` | `20` | Maximum entries per kind in the overview; matching still sees all |
| `sshTimeoutMs` | `60000` | Default SSH command timeout |
| `httpTimeoutMs` | `30000` | Default PAT request timeout |
| `maxOutputBytes` | `65536` | Per-stream stdout/stderr limit |
| `maxHttpResponseBytes` | `262144` | Response body limit |
| `allowLoopbackHttp` | `true` | Allow loopback plain HTTP; set `false` to reject it entirely |
| `allowCrossOriginPat` | `false` | Allow PATs across origins (dangerous) |
| `followRedirects` | `false` | Follow redirects automatically (may leak tokens) |
| `sshBinary` | `ssh` | OpenSSH client path |
| `sshConfigFile` | `''` | Empty means no `-F` |
| `sshKnownHostsFile` | `''` | Empty means the user default `known_hosts` |
| `sshStrictHostKeyChecking` | `accept-new` | `yes` / `accept-new` / `no` |
| `sshConnectTimeoutMs` | `10000` | SSH connection timeout |

The Settings page edits only `promptSection`, `maxPromptEntriesPerKind`, `sshTimeoutMs`,
`httpTimeoutMs`, `allowLoopbackHttp`, `allowCrossOriginPat`, `followRedirects`, and
`sshStrictHostKeyChecking`. `inventoryPath`, `maxOutputBytes`, `maxHttpResponseBytes`,
`sshBinary`, `sshConfigFile`, `sshKnownHostsFile`, and `sshConnectTimeoutMs` are changed through
the profile patch / YAML.

## Security model

1. **Inventory carries references only.** `inventory.yml` stores `credentialRef` names and is
   safe to screenshot or commit. The one exception is an explicitly exported encrypted bundle,
   which contains encrypted values and must be handled as confidential.
2. **Prompts contain metadata only.** `credential_hub_match` never calls the credential
   service; `resolve` reports presence only.
3. **Values are resolved only on the Host.** Tools call `ctx.credentials.resolve()` inside
   `execute` and hand the value directly to `ssh` or `fetch`. The Settings page can write a
   value but cannot read it back in plaintext.
4. **Results are redacted.** SSH stdout/stderr and PAT response bodies replace the raw value,
   URL-encoded value, base64 value, Basic `user:secret`, and individual PEM lines.
5. **PATs stay on their origin.** Requests default to the record's `baseUrl` origin; redirects
   are not followed by default.
6. **Plain HTTP is restricted.** Non-loopback endpoints must use HTTPS; setting
   `allowLoopbackHttp=false` rejects loopback HTTP too.
7. **Temporary keys are 0600.** The private key is written under `mkdtemp`, passed via `ssh -i`,
   and removed when the process exits.
8. **Encrypted bundle plaintext stays in Host memory.** Export returns ciphertext only; import
   decrypts and validates on the Host. Passphrases and plaintext are never logged or echoed.
9. **The inventory is trusted local configuration.** `description`/`tags` enter the prompt; do
   not sync untrusted inventories or bundles, or metadata can become a prompt-injection surface.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plugin stays at `pending (waiting for service: credentials)` | Mount `@deepseek-ai/dsh-credentials-local` or an equivalent service for the profile |
| Invalid `credentialRef` | Use a POSIX identifier such as `SSH_PROD_WEB_KEY`, not a slash-separated path |
| SSH authentication fails | Only passphrase-less keys are supported; check `sshBinary`, `sshKnownHostsFile`, and host-key policy |
| PAT returns 401/403 | Check `baseUrl`, `authScheme`, and `headerName`; GitHub usually uses Bearer, GitLab often uses `PRIVATE-TOKEN` |
| Import fails | A wrong passphrase or corrupt file fails uniformly; only the current format version is accepted; failed validation writes nothing |
| Settings changes do not appear | Refresh the Web page or restart DSH; Host changes usually need a plugin-row reload |
| Export download does not start | Check browser download blocking; the page keeps a “Download again” button |

## Development and testing

```sh
npm ci
npm run check   # node --check for every shipped JS file
npm test        # check + unit/route/security tests
npm run test:live  # optional: real DSH + model + local mock SSH/HTTP
```

- CI runs `npm ci` and `npm test` on Node 20/22/24; live tests are opt-in and never start in CI.
- Current suite: **75 pass / 0 fail**, covering inventory validation, matching, prompts, tool
  schemas, redaction, write-only values, encrypted bundles, route error branches, provider
  error redaction, partial credential failures, and inventory-write rollback.
- Host code lives in `index.js` + `src/`; the Client is `client.js`. Refresh the page after
  Client changes.
- Tests use temporary directories and fake credentials. Never commit a real `inventory.yml`,
  `*.dshcredhub.json`, `.env`, or secret material.

Detailed verification records are in [`docs/manual-tests.md`](docs/manual-tests.md) and
[`docs/ui-verification.md`](docs/ui-verification.md).

## Known limitations

- **No SSH password auth or passphrase-protected keys.** `BatchMode=yes` +
  `IdentitiesOnly=yes` requires passphrase-less keys.
- **No persistent SSH host-key management.** The default `accept-new` uses the user's
  `known_hosts`; for high-security environments set `yes` and maintain it in advance.
- **PATs are a generic HTTP client.** They are scoped to the `baseUrl` origin but do not
  understand a specific API; the request path is model-selected.
- **Settings writes values but does not read them back.** A saved value cannot be viewed in the
  page; export yields only an encrypted file.
- **Encrypted bundles still contain secrets.** Anyone with the file and passphrase can recover
  configured credentials; a lost passphrase cannot be recovered, and replace import leaves old
  credential-store entries in place.
- **Saving runtime configuration restarts the plugin row.** Ordinary fields are not hot-reloaded.
- **Compatibility is tested with DSH 0.2.2-rc.3.** Run `npm test` and the live acceptance after
  upgrading DSH.

## Contributing

- Development, testing, and PR conventions: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Community behavior: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Security reports: follow [`SECURITY.md`](SECURITY.md). Do not open a public issue with keys or
  passphrases.
- Release history: [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT. See [`LICENSE`](LICENSE).

<div align="center">
<sub>Built for DeepSeek Harness · metadata routed, values kept on the Host.</sub>
</div>
