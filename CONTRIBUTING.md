# Contributing

Thanks for improving `dsh-credential-hub`. This project is a DSH Host plugin plus a
no-build Client settings page. Keep changes focused; security-sensitive code needs tests.

## Setup

Requirements: Node.js >= 20 (the DSH desktop runtime is newer) and a DSH profile with a
credentials service when testing against a real Host.

```sh
npm ci
npm run check
npm test
```

`npm test` runs the syntax gate first, then the unit, route, and security tests. For the
optional live scenario:

```sh
npm run test:live
```

The live scenario needs a reachable DSH installation and model access; it starts local mock
SSH/HTTP endpoints and does not use production credentials.

## Code style

- ESM only, no build step for Host or Client code.
- Two-space indentation; keep the style of the surrounding file.
- Comments explain *why* (trust boundaries, compatibility workarounds), not what the next
  line obviously does.
- Reuse the existing Client helpers and theme tokens; do not introduce a second design
  system for one panel.
- Keep error codes stable (`src/errors.js`) and make failures actionable without echoing
  user input or credential values.

## Tests

Add or update tests when changing:

- inventory parsing/normalization or file permissions;
- ref validation or credential status;
- tool output schemas or redaction;
- settings routes, write-only values, or encrypted export/import;
- Client bundle id, locale keys, or slot registration.

Never put a real key, token, password, or passphrase in a test, example, fixture, log, or
screenshot. Use obviously fake values and temporary directories.

## Pull requests

Please include:

- a short description of the user-visible change and the security impact;
- the commands you ran (`npm run check`, `npm test`, and optionally `npm run test:live`);
- documentation updates for new settings, routes, or files;
- a `CHANGELOG.md` entry for user-visible changes.

Do not commit a real `inventory.yml`, an exported `*.dshcredhub.json` bundle, `.env` files,
or `node_modules`. The repository `.gitignore` covers those.

## Community

Be respectful and constructive; see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Release checklist

- Run `npm run check` and `npm test`; run `npm run test:live` only when a real DSH/model
  environment is available.
- Verify `package.json` `repository`, `homepage`, and `bugs` point at the real project URLs
  before publishing.
- Update `CHANGELOG.md`, the version, and the README compatibility/status line.
- Confirm no `inventory.yml`, `*.dshcredhub.json`, `.env`, or real credential material is
  staged.

## Security reports

Do not open a public issue with exploit details or secret material. Follow
[SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
