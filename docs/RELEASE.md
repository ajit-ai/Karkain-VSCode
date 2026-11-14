# Release Process

## Versioning

Semantic Versioning. **Karkain Language Tools 1.0.0 is released** (GitHub
Releases from the `v1.0.0` tag). Verified release gates: merge commit
`ceea1b80260babd43511a6f6dbc85f3e27debd0b` (PR #1) is green on CI run #13
(`43587837685`, all six legs on Windows/Ubuntu/macOS); unit 224/224;
extension-host suite green on all three OSes; VSIX packaging verified from
the exact tagged commit; GitHub Release carries the freshly built
`karkain-1.0.0.vsix`. Real-world user validation, and the upstream Karkain
LSP empty-envelope fix, remain open items for a later change — see
"Known limitations" in the README and in `CHANGELOG.md`.

The activation banner reads the version from the manifest at runtime, so no
source edit is needed for a bump.

## Cutting a release (owner)

1. Update `CHANGELOG.md` (new `## [x.y.z]` section) and bump `version` in
   `package.json` (keep the README `.vsix` filename in sync).
2. Run the full gate locally: `typecheck`, `lint`, `format:check`,
   `test:unit`, `test:lsp-smoke:proxy` against a 1.2.0+ binary,
   `test:integration`, `package`, install the `.vsix` and smoke-test (open
   `.kark`, check, build, run, test).
3. Commit to `develop`, merge to `main`, push both.
4. Create the tag on the merged commit and push it: `git tag v1.0.0 && git
push origin v1.0.0`. The tag must match `package.json` or the release
   workflow fails fast.
5. `release.yml` validates, packages and creates the GitHub Release with the
   `.vsix` asset and the CHANGELOG section as notes. Verify the Release page
   and install the attached `.vsix` on a clean profile before announcing.

## Marketplace (manual, separate step — never automated)

Marketplace publication is an explicit owner decision, not part of CI:

1. Create the publisher (placeholder in the manifest: `"publisher": "karkain"`)
   and a Personal Access Token with Marketplace scope.
2. Confirm readiness: icon (128×128 `images/karkain-icon.png`), display name,
   description, categories, keywords, license (MIT), repository/homepage/issue
   links, compatible `engines.vscode`, README, CHANGELOG, SUPPORT.
3. `npx @vscode/vsce publish` (dry-run with `vsce package` first). Do not
   publish pre-release or broken builds; the `.vsix`-installable GitHub
   Release is the quality bar that must pass first.
