# AGENTS.md

## Project Notes

- Main Tampermonkey script: `mansion-autocomplete.user.js`
- Test page: `autocomplete-test.html`
- User-facing documentation: `README.md`

## Versioning

When a grouped fix, behavior change, or feature addition is completed, update the Tampermonkey metadata version in `mansion-autocomplete.user.js`.

Use this rough guideline:

- Patch fix: `1.7.1` -> `1.7.2`
- Feature addition: `1.7.1` -> `1.8.0`
- Large compatibility or data-format change: `1.7.1` -> `2.0.0`

This matters because Tampermonkey uses `@version` together with `@updateURL` / `@downloadURL` to detect updates from GitHub.

## Verification

After editing `mansion-autocomplete.user.js`, run:

```powershell
node --check .\mansion-autocomplete.user.js
```

For UI changes, also verify with `autocomplete-test.html` in a browser.
