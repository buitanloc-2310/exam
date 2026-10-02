# SLCS Exam Player
Dedicated candidate-facing exam surface for `exam.skyfirst.io.vn`.

- Separate GitHub repository / Cloudflare Worker deployment.
- Does **not** own D1 migrations. The main SLCS repository is the only schema owner.
- Candidate arrives with a one-time 5-minute launch token issued by SLCS.
- Token is redeemed for a 12-hour attempt-scoped bearer token.
- All authoritative exam APIs remain in the main SLCS Worker; this repository contains no question answers or admin routes.
- Return destination after submit: `https://slc.skyfirst.io.vn/#exam-center`.

Deploy after the updated SLCS backend (migration `0027_exam_domain_split`) is deployed.
