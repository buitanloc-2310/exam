# SLCS Exam — Cloudflare Pages

Deployment target: Cloudflare Pages.

Cloudflare build configuration:
- Root directory: `EXAM`
- Build command: leave empty
- Build output directory: `public`

The `functions/health.js` Pages Function provides `/health`.
The Exam Player calls the authoritative SLCS API at `https://slc.skyfirst.io.vn`.
Do not add D1 migrations to this repository; SLCS remains the schema owner.

After deployment verify:
1. `/` returns the Exam landing page.
2. `/health` returns JSON with `ok: true`.
3. `/styles.css`, `/api.js`, `/storage.js`, `/exam.js` return 200.
4. Launch from SLCS using `?launch=...` and verify redeem, load, autosave, submit and recovery.
