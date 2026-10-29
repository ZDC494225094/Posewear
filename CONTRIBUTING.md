# Contributing to AI Reference Gallery

AI Reference Gallery is a dependency-free static web application intended to work directly from `index.html` where the required local asset files are available. It supports both pose and costume reference browsing.

## Guidelines

1. Use plain HTML, CSS, and JavaScript. Avoid introducing runtime build tools, databases, framework dependencies or network requirements for offline browsing.
2. Preserve all three interface languages: Simplified Chinese, English, and Japanese. Update `i18n.js` when adding interface text.
3. Use local script-based indexes (`catalog.js` and `costume-catalog.js`) rather than `fetch()`-loading JSON to preserve `file://` compatibility.
4. Do not submit secrets, private exports, or visual assets without the necessary public distribution authorization. Artwork is **not** MIT-licensed; see [ASSETS.md](ASSETS.md).
5. Keep asset paths relative and verify all referenced pose/garment images exist. Do not describe partially implemented features as complete.
6. Follow `.editorconfig`, update the README and tests after changing user-visible functionality, and keep the GitHub repository suitable for lightweight cloning where practical.

## Checks (optional; Node.js 18+)

```bash
node --test test_i18n.cjs
node --check app.js
node --check i18n.js
node --check catalog.js
node --check costume-catalog.js
```

Running these checks verifies JavaScript syntax, image catalog integrity, offline data loading and language-related regression tests. It does not replace browser-based end-to-end verification.

No server or package installation is needed to run the website: open `index.html` in a browser.
