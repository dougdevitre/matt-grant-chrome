# Extension icons

These four PNGs are referenced by `extension/public/manifest.json` (both the
top-level `icons` map and `action.default_icon`) and are copied into the build
output by Vite (`publicDir: "public"`).

| File          | Size    | Used for                          |
| ------------- | ------- | --------------------------------- |
| `icon-16.png` | 16×16   | toolbar / favicon                 |
| `icon-32.png` | 32×32   | Windows, retina toolbar           |
| `icon-48.png` | 48×48   | extensions management page        |
| `icon-128.png`| 128×128 | install dialog + store listing    |

> **PLACEHOLDER — replace before final upload.** These are a generated navy
> "MG" monogram. Swap in the official campaign logo at the same four sizes
> (square PNG, transparent background recommended). Keep the same filenames so
> no manifest changes are needed. A square source ≥512px regenerates cleanly.
