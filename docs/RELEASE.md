# Release Process

## Versioning

Semantic Versioning, currently pre-1.0 (`0.x`). The activation banner reads
the version from the manifest at runtime, so no source edit is needed for a
bump. 1.0 is declared only when every §30 gate holds: core language support,
diagnostics, build, run, IntelliSense, tests, green CI, VSIX packaging,
complete docs and understood cross-platform behavior — plus real-world
validation beyond this repository.

## Cutting a release (owner)

1. Update `CHANGELOG.md` (new `## [x.y.z]` section) and bump `version` in
   `package.json` (keep the README `.vsix` filename in sync).
2. Run the full gate locally: `typecheck`, `lint`, `format:check`,
   `test:unit`, both smoke gates against a 1.1.0+ binary, `package`, install
   the `.vsix` and smoke-test (open `.kark`, check, build, run, test).
3. Commit to `develop`, merge to `main`, push both.
4. Tag and push the tag: `git tag v0.9.0 && git push origin v0.9.0`. The tag
   must match `package.json` or the release workflow fails fast.
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
