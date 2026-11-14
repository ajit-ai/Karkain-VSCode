# Testing Guide

## What the toolchain does

```
karkain test <path>
```

Discovers `*_test.kark` files, runs `test_*` functions, prints per-test
PASS/FAIL lines with durations and an `N passed; N failed` total. Exit code
is `4` on any failure, `0` otherwise. `--filter <pattern>` limits to test
names containing the substring; `test --compile [dir]` runs the
compile-pass/compile-fail corpus.

## What this extension does

- Discovers `test_*` functions via the language server's document symbols
  (textual fallback with a logged note when symbols are unavailable).
- Shows them in the **Testing** view grouped by file.
- Runs a file or individual tests; results, assertion output and summary land
  in the `Karkain Test` output channel and under each test.

## Linker requirement (important)

`karkain test` **builds and links a native binary**. Without a C toolchain
(`gcc`, `clang` or `cl.exe`) it cannot run, and the extension surfaces that
directly: the run output will contain `no cross-linker available …` — install
a C toolchain or `KARKAIN_KCC`. This is a **toolchain** limitation, not an
extension failure.

## Engine caveat

The default kcc engine owns the test runner; with no C compiler it cannot
link either. `KARKAIN_ENGINE=go karkain test` exists and shares the same
linker requirement.
