# Local Skill usage

The entry point is `.agents/skills/ai-reference-gallery/scripts/gallery.cjs`; commands run from the repository root. `node .../gallery.cjs help` displays the current flags.

## Search

- `search --type pose|outfit --query "words" --category "value" --limit 10`
- `categories --type pose|outfit`
- `--lang zh-CN|en|ja` displays translated category and pose names where provided.
- Search performs case-insensitive substring matching across the ID and original / localized catalog fields. Multiple whitespace-separated terms must **all** match. There is no embedding model or external semantic search API; translate vague descriptions to useful catalog keywords first.
- Use `--include-duo` to include two-person poses. Explicit pose IDs work even if they are two-person assets.

## Composition

`compose` chooses one real catalog pose from each pose group and one outfit per output. You can provide `--pose-id`, `--outfit-id`, `--pose-query`, `--outfit-query`, `--pose-category`, `--outfit-category`, `--include-duo`, `--seed`, `--count`, `--person`, `--outfit-image`, `--background white|soft`, `--labels true|false`, `--lang`, `--out FILE.png` (one result), `--out-dir DIR` (one or multiple), and `--overwrite`.

Outputs for `output/example.png`:

- `output/example.png`: actual exported PNG created using `composition.js`.
- `output/example.txt`: AI creation prompt for the selected reference positions and roles.
- `output/example.json`: catalog IDs, localized labels, dimensions and export file names.

Automatic output names are `reference-001.png`, `reference-002.png`, etc. Files are not uploaded or sent to an AI model. The local rendering server is bound to 127.0.0.1 on an ephemeral port and shuts down when export finishes.

## Four-grid and nine-grid

Use `grid --size 4` for a **2×2 layout** or `grid --size 9` for a **3×3 layout**. Each cell is a complete, independently selected two- or three-image reference board. They are numbered reading left to right, top to bottom. The final output is **one comparison PNG**, not 4/9 separate files. By default it is saved as `output/skill-grids/grid-4.png` or `grid-9.png`; set `--out` or `--out-dir` to change the location.

The companion `.txt` describes the grid and provides a separate AI prompt for each numbered cell. The `.json` lists row, column, pose ID, outfit ID, and optional photo reference for each cell, plus the final PNG dimensions.

```bash
# Four distinct outfits/poses.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 4 --pose-category 站姿 --outfit-category spring --seed lookbook-4

# Nine poses using one fixed outfit.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 9 --outfit-id SPR-0001 --seed pose-set-9

# Four variations with one uploaded person reference.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 4 --person "C:/Photos/person.jpg" --out output/my-four-grid.png
```

Grid accepts the same catalog filters and options as `compose`, except it requires `--size 4|9` instead of `--count`. Use `--pose-id` / `--outfit-id` to lock one reference across every cell. If fewer distinct catalog matches exist than the requested grid size, assets may repeat. Every grid element preserves original image proportions and follows fixed pose → outfit → optional person order. The grid canvas is landscape-oriented to leave room for the wide paired reference boards.

## Common errors

- **No matching poses/outfits**: run `categories` or broaden `search`, then choose exact IDs. Search filters are AND conditions.
- **Output already exists**: choose another `--out` or `--out-dir`; use `--overwrite` only with the user's consent.
- **Chrome/Edge not found**: install a supported browser or set `CHROME_PATH`.
- **Image loading failed**: check that the referenced catalog original exists under `img/`, or supply a valid image via `--person` / `--outfit-image`. User uploads must be JPG, PNG or WebP, 50 MB or smaller.
- **Node/WebSocket unsupported**: run Node.js 22 or newer.
