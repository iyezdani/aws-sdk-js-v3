# Prompt (sent verbatim, identically, to both models)

Status: **FROZEN 2026-11-19** (tag `assessment-frozen`). Do not edit; the text between the lines is what gets sent.

Models: Claude Opus 5.5 (`claude-opus-5-5`), medium effort; Claude Sonnet 5.5 (`claude-sonnet-5-5`), medium effort.

---

In this repository, `Signer.getAuthToken()` in `@aws-sdk/rds-signer` force-refreshes credentials before signing whenever the cached credentials expire within 15 minutes, so that the token stays valid for its full 15 minutes. It waits for that refresh with no time limit. If the STS request behind the refresh stalls (accepted but never answered), for example with web-identity credentials from the default provider chain, `getAuthToken()` never resolves, even though the cached credentials are still valid.

Fix this so that a stalled early refresh can no longer block token generation. Add tests, and summarize what you changed and why.

---
