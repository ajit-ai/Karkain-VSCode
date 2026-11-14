# Language Syntax Reference (verified subset)

This page reflects syntax **accepted by the reference implementation**, not the
aspirational SPEC. Shapes the compiler rejects are listed as rejected.

## Functions

```karkain
func add(a, b) {
    return a + b
}

func main() {
    print(add(1, 41))   // 42
}
```

Parameters have no type annotations (`func add(a: int)` is a parse error);
return types are inferred from `return`.

## Bindings

```karkain
let x = 42
const PI = 3.14159
```

`let x: int = 42` (annotated) is **not** accepted; `let = 42` is rejected
(`let` requires a name).

## Structs

```karkain
type Counter struct { value int }
```

They are constructed positionally: `Counter{value: 1}` is **not** the shape;
see the project fixtures for accepted forms.

## Comments

```karkain
// line comment
/* block
   comment */
```

## Control flow

```karkain
if x > 1 {
    print("big")
} else {
    print("small")
}

for x in items {
    print(x)
}
```

## Rejected by the real parser (do not copy)

- `func add(a: int, b: int) -> int` — unexpected `:` / `>`.
- `struct Name { ... }` bare at top level — use `type Name struct { ... }`.
- `let = 42` — missing binding name.

## Unicode

The lexer accepts UTF-8 source, but keep identifiers ASCII: string literals
are Karkain strings (UTF-8 byte strings) — `len()` counts bytes, `s[i]` reads
one byte.
