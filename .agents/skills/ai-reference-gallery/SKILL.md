---
name: ai-reference-gallery
description: Find local poses and outfits; compose actual two/three-image PNG reference boards and 2x2 four-panel (四宫格) or 3x3 nine-panel (九宫格) comparison grids with Chinese, English or Japanese prompts. Use for pose/outfit matching, random fashion references, four-grid or nine-grid sheets, and batch export.
---

# AI Reference Gallery

This skill **runs locally inside the ai-reference-gallery repository**. It searches the existing catalogs and uses the website's real Canvas compositor to create PNGs. Do not claim to generate finished AI artwork, to change faces, or to call an image model.

## Workflow

1. Locate this project's root (the folder containing `catalog.js`, `costume-catalog.js`, `composition.js`, and `img/`). Run commands from the project root. The entry point is `.agents/skills/ai-reference-gallery/scripts/gallery.cjs`.
2. Translate the user's natural-language request to catalog terms. Use `categories` and `search` to inspect real matches **before making a specific recommendation**. Never invent catalog IDs or image paths; use the returned IDs. Pose angles have separate IDs; multiple angles may be members of one `poseKey`.
3. Run `compose` with exact IDs when specific matches matter, or filters plus `--seed` and `--count` for reproducible random compositions. For a **四宫格 / four-grid** or **九宫格 / nine-grid**, run `grid --size 4` or `grid --size 9`: the output is ONE PNG with 4/9 different reference combinations, not 4/9 separate PNG files.
4. Read the returned JSON. The PNG is the actual reference image; the neighboring `.txt` is its AI prompt; the `.json` records selected references and dimensions. Grid JSON additionally contains each cell's position and catalog IDs. Report file paths and any failures accurately.

## Commands

```bash
# Explore available categories or catalog records (JSON output).
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs categories --type pose
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs search --type pose --query "站姿" --limit 8
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs search --type outfit --category spring --query "white"

# Reproducible random combinations; no need to start a browser for searching.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs compose --pose-category 站姿 --outfit-category spring --count 5 --seed street-01 --out-dir output/street

# Explicit pose and clothing image; optional third, user-owned person photo.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs compose --pose-id full_sexy_P001_front --outfit-id SPR-0001 --person "C:/Photos/person.png" --out output/my-reference.png

# Custom outfit photo in slot two, without a catalog outfit.
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs compose --pose-id full_sexy_P001_front --outfit-image "C:/Photos/outfit.webp" --background soft --labels false --out output/custom.png

# Four-panel comparison grid: one PNG, four different looks (2 columns × 2 rows).
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 4 --pose-category 站姿 --outfit-category spring --seed four-demo --out output/four-grid.png

# Nine-panel comparison grid: nine poses against the SAME outfit (3 × 3).
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 9 --outfit-id SPR-0001 --seed nine-demo --out output/nine-grid.png

# Four/nine variations of the SAME character with a user-provided third reference:
node .agents/skills/ai-reference-gallery/scripts/gallery.cjs grid --size 4 --person "C:/Photos/person.png" --out output/my-character-grid.png
```

Every individual reference board uses **fixed left-to-right** order: pose → outfit → optional person. The `grid` command arranges complete boards in a numbered 2×2 or 3×3 matrix, ordered left to right, top to bottom. Use `--pose-id` to hold a pose constant, or `--outfit-id` to hold an outfit constant across cells; otherwise it samples distinct matches where possible. The grid's `.txt` contains individual prompts for every cell. Only catalog images show catalog IDs. Images are contained without cropping. `--person` and `--outfit-image` accept local JPG, PNG or WebP up to 50 MB. User photos stay on the local machine. Default outputs are `output/skill-compositions` for `compose` and `output/skill-grids/grid-4.png` or `grid-9.png` for `grid`; both directories are Git-ignored.

`--lang zh-CN|en|ja` controls labels and generated prompts. Random selection defaults to single-person poses; use `--include-duo` for two-person poses. `compose --count` ranges from 1 to 20 and avoids repeating pose groups or outfits until their pools are exhausted. `grid` uses `--size 4|9` instead of `--count`; if selection filters yield fewer unique options, repetitions may occur. Existing output files are not overwritten unless `--overwrite` is explicitly given.

PNG generation requires **Node.js 22+ and installed Chrome or Edge**. Set `CHROME_PATH` to the browser executable when auto-detection fails. No npm packages or remote API keys are required. Only search/categories work without Chrome or Edge.

See [usage and troubleshooting](references/usage.md) for search semantics and error recovery.

## Guardrails

- This is **reference-board composition**, not final image synthesis or automatic face replacement.
- Do not upload local photos to external services or copy source images into the skill folder.
- Catalog assets retain their original restrictions: read `ASSETS.md` before redistributing or commercializing materials. The code's MIT license does not grant blanket rights to the images.
- If a category/keyword has no matches, report that and use search to find supported alternatives rather than silently changing the request.
