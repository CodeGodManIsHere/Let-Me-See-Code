# Contributing to Let Me See Code

Thank you for helping improve Let Me See Code. Focused bug fixes, capture-quality improvements, tests, documentation corrections, and carefully scoped feature proposals are welcome.

## Before opening an issue

1. Use the newest release.
2. Confirm that the target is a normal `http://` or `https://` page.
3. Close DevTools and other automation attached to the target tab.
4. Reproduce the problem with the smallest suitable mode and page limit.
5. Review the Logs tab, `capture_completeness.json`, and `WARNINGS.json`.
6. Remove private data before sharing logs or archive files.

Please use the repository’s issue forms for bugs and feature requests.

## Development setup

Let Me See Code is a plain Manifest V3 extension with no normal build step.

1. Fork and clone the repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root.
5. After changing extension files, click **Reload** on the extension card.

Run the local checks before submitting a pull request:

```bash
node tools/validate.mjs
node tools/selftest.mjs
```

Then test Quick, Fast, and Max on a small static page and at least one dynamic page.

## Pull requests

- Keep each pull request focused on one problem.
- Explain the cause, the change, and how you verified it.
- Preserve local processing and explicit completeness reporting.
- Do not add broad host permissions or silent external uploads.
- Do not turn bounded collectors into unbounded per-element work.
- Max must not silently fall back to shallow evidence.
- Add or update tests when behavior changes.
- Do not commit capture ZIPs, browser profiles, generated outputs, or private website data.

By contributing, you agree that your contribution may be distributed under the repository’s MIT License.

