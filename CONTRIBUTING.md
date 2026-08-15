# Contributing

Bug reports and focused pull requests are welcome. Before submitting a change:

1. Do not use real OAuth credentials, device codes, account IDs, emails, or
   proxy credentials in code, tests, screenshots, or logs.
2. Run `npm ci --ignore-scripts`, `npm run check`, and `npm test`.
3. Run `npm pack --dry-run` and confirm that only intended runtime files are
   included.
4. Describe the DSH, Node.js, and `@earendil-works/pi-ai` versions used for any
   real login or streaming verification.

Changes to authentication, refresh/logout races, credential persistence,
installer paths, or the private usage-summary integration should include a
regression test. Keep the usage endpoint best-effort: its failure must not block
login or model requests.
