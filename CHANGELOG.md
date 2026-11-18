# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- Chinese-first README with a full English translation, language switcher, CI/release/license/
  Node badges, quick links, one-line install, table of contents, Mermaid architecture diagram,
  example flows, documentation index, troubleshooting table, disclaimer, and clearer
  configuration/security sections.

## [0.2.1] - 2026-11-18

### Fixed

- `npm test` now enumerates `test/*.test.mjs` explicitly instead of passing the
  `test/` directory to `node --test`, which Node 20/22 treated as a module path.
  This restores the GitHub Actions matrix (Node 20/22/24).

## [0.2.0] - 2026-11-18

### Added

- Settings transfer tab: export an inventory plus configured credential values as an
  AES-256-GCM encrypted bundle; import it on another machine with merge or replace mode.
- Write-only credential value field in the SSH and PAT record editors.
- Advanced PAT header-format section (Bearer, token, Basic, custom header) with Bearer as
  the default; the main form no longer asks every user to choose an auth scheme.
- Syntax gate (`npm run check`) and expanded unit-test script.

### Fixed

- `allowLoopbackHttp=false` now actually rejects loopback plain HTTP instead of being
  ignored.
- Provider errors no longer flow into model-visible tool errors or browser state; they
  are reduced to a generic credential-resolution failure.
- A failed post-write inventory load removes a newly created file when no previous file
  existed, rather than leaving a bad inventory behind.
- Transfer errors are split by card; export offers a retry download; replace import has a
  separate confirm row; file reads cannot resurrect an older selection.

### Changed

- Reduced settings-page helper text and removed the inventory path/permissions footer.
- Passphrases are validated at eight characters minimum and are never stored or echoed.

### Security

- Host-side scrypt + AES-256-GCM encryption/decryption with authenticated envelopes;
  wrong passphrases and tampered bundles fail without partial plaintext.
- Imported bundles are validated before writing; smuggled secret fields and unsupported
  KDF/format versions are rejected.
- Export responses, import responses, and inventory files are asserted not to contain
  plaintext credential values.

## [0.1.0] - 2026-11-18

### Added

- Initial SSH/PAT inventory, tag matching, metadata-only system prompt section, Host-side
  credential resolution, SSH/PAT tools, Settings CRUD/config UI, and security tests.
