# AI Comment Helper (DeepSeek)

Browser extension (Brave / Chrome, Manifest V3) that adds a small button to comment boxes on social media.

- **Γράψε απάντηση / Write reply**: reads the post (and the comment you're replying to) and drafts a reply.
- **Βελτίωσε / Improve**: fixes grammar, spelling, accents and flow, keeping the language.
- **Σε Ελληνικά / In English**: rewrites your draft in Greek or English.
- Tone selector, optional instructions, preview before inserting. Nothing is posted automatically.

Works on Facebook, LinkedIn, X, Instagram, Reddit, YouTube and Threads. Uses your own [DeepSeek API key](https://platform.deepseek.com/api_keys).

## Install (development)
1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Paste your DeepSeek API key in the settings page that opens, then reload your social media tabs.

## Build for the Chrome Web Store
```sh
./build.sh
```
Creates `dist/ai-reply-extension-<version>.zip`. Bump `version` in `manifest.json` before every upload.

## Privacy
See [PRIVACY.md](PRIVACY.md).
