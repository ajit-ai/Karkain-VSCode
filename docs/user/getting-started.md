# Getting Started with Karkain

Karkain is a compiled, statically-oriented language. A program runs from
`func main()`. Files use the `.kark` extension.

## 1. Install the toolchain

```
karkain --version
```

You need **Karkain 1.1.0 or newer** (verified against **1.2.0**). For VS Code
support, also install this extension. For `build`/`run`/`test`, you need a C
compiler (GCC/Clang/MSVC) on your PATH.

## 2. Your first program

Create `hello.kark`:

```karkain
func main() {
    print("Hello, Karkain!")
}
```

Check it, then run it:

```
karkain check hello.kark
karkain run hello.kark
```

## 3. Create a project

```
karkain init my_app
cd my_app
```

`init` emits a flat `karkain.toml` (name, version, description, license,
targets) with `src/main.kark` and `tests/`. Or use the command palette:
**Karkain: New Project…**

## 4. In VS Code

- The **Karkain** activity bar (left) hosts the Control Center: Overview,
  quick actions, Projects & Files, the Compiler Command catalogue,
  Standard Library, Examples and this documentation.
- Editor shortcuts: `Ctrl+Alt+R` run, `Ctrl+Alt+B` build, `Ctrl+Alt+C` check,
  `Ctrl+Alt+T` test, `Ctrl+Alt+D` debug (on `.kark` files only).
- Problems panel shows `karkain check` diagnostics when available.

## Requirements on Windows

See [Toolchain Setup](toolchain-setup.md) if `check` exits 6 with
`cannot locate src/compiler`.
