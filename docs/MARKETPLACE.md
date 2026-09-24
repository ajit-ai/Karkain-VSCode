# Marketplace Readiness & Owner Runbook

Status (verified 2026-09-24 against v0.9.0): **ready pending owner actions**.
No code changes are required to publish; the remaining steps all need the
owner's Microsoft/publisher identity and cannot be done by automation.

## Readiness checklist (all verified)

| Requirement              | State                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Unique extension id      | `karkain.karkain` (name `karkain`)                          |
| Publisher field          | `"karkain"` placeholder — publisher must be created (owner) |
| Version                  | `0.9.0` semver                                              |
| Engine                   | `^1.75.0`                                                   |
| Display name             | Karkain for Visual Studio Code                              |
| Description (236 chars)  | present                                                     |
| Categories               | Programming Languages, Formatters, Linters (all valid)      |
| Keywords                 | present                                                     |
| Icon                     | 128×128 PNG, pixel-verified, packaged in the VSIX           |
| License                  | MIT (`LICENSE` → `LICENSE.txt` in VSIX)                     |
| Repository/homepage/bugs | all point at `ajit-ai/Karkain-VSCode`                       |
| README / CHANGELOG       | packaged; release notes feed GitHub Releases                |
| `vsce package`           | green, no manifest errors (one non-blocking bundling hint)  |
| Pricing / Q&A            | defaults (free, Marketplace Q&A) — acceptable               |

## Owner action 1 — create the publisher (one time)

1. Sign in at <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that will own the publisher.
2. Create publisher id **`karkain`** (must match the manifest exactly).
3. Create a Personal Access Token (Azure DevOps: User Settings → Personal
   access tokens) with the **Marketplace → Manage** scope. Store it as a
   secret; never commit it.

## Owner action 2 — cut the v0.9.0 release first (recommended order)

The Marketplace listing should trail a verified GitHub Release, never lead it:

```sh
git tag v0.9.0
git push origin v0.9.0
```

`release.yml` then validates, packages and publishes the GitHub Release with
the `.vsix` asset. Install that asset on a clean profile and smoke-test
(open `.kark`, check, build, run, test) before publishing.

## Owner action 3 — publish (manual, from your machine)

```sh
npx @vscode/vsce publish -p <personal-access-token>
```

Verify the listing page (icon, README rendering, version), then install from
the Marketplace into a clean profile as the final acceptance check. To
unlist or update later, repeat `vsce publish` with a bumped version — never
re-publish the same version number.

## What automation will never do

CI and release workflows stop at the GitHub Release. Nothing in this
repository holds credentials, and no workflow publishes to the Marketplace.
