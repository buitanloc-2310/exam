# Sky First EXAM

EXAM is the **delivery plane** for official assessment execution: check-in/launch, load sealed package, answer, autosave, integrity signals, hard deadline, lock, submit and receipt.

After a launch token is redeemed, attempt read/write runs directly against the shared D1 binding. It does not require SLCS runtime for load/save/violation/upload/submit, so an already-started exam can continue if the SLCS control plane is temporarily unavailable.

## Runtime rules

- Server time/deadline is authoritative.
- One active write lease per attempt; device transfer is an audited SLCS action.
- Revision-safe autosave; no per-keystroke database write.
- After deadline, new edits/uploads are rejected and finalization uses only the last server-accepted answer.
- Submit is idempotent and returns a server receipt.
- Candidate payload excludes answer/rubric/scoring secrets.
- File/image/audio responses are stored in R2 with D1 metadata and signature/MIME checks.
- Integrity events are signals only; they do not automatically declare cheating.
- Camera/microphone/display capture are denied by default.

## Validation

- `npm run build` — syntax + browser/core unit checks.
- Local combined integration test (when `EXAM/` and `SLCS/` are siblings):
  `node scripts/validate-integration.mjs ../SLCS/src/index.js`

Deploy only after SLCS migration `0028_digital_education_operations_2026.sql` exists in D1. Then verify `/health` returns status `available`, `attempt_api: local-d1`, and `control_plane: independent-after-launch`.

## Local SLCS ↔ EXAM resilience test

When this project is packaged beside `SLCS/`, run:

```bash
npm run validate:integration
```

This test uses an ephemeral in-memory SQLite database; it does not access production D1/R2.
