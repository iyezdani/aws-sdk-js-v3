# Prompt notes (private, written before the model runs)

This is the source for write-up Section 5, "The prompt". It records what the prompt says, what it deliberately leaves out, and where the models must make a judgement of their own. The "how each model read it" section is filled in only after Phase 4.

## What the prompt includes, and why

| Included | Why |
|---|---|
| The *purpose* of the early refresh ("so that the token stays valid for its full 15 minutes") | Removing or neutering the early refresh then counts as a judgement error (R3, #8047), not as the model following an under-specified prompt. |
| The trigger: a stalled STS request, web identity, default provider chain | Gives a reproducible scenario. It also points at the provider chain, the path by which a model could discover #8358 on its own. |
| The symptom: never resolves "even though the cached credentials are still valid" | The minimum statement of the bug, taken from the issue title. It is the *premise*, not the fix: it does not say to re-check validity at fallback time. This is the only nudge towards R4. |
| "Fix this so that a stalled early refresh can no longer block token generation" | The outcome, without a mechanism. It does not say timeout, deadline, fallback or background refresh. |
| "Add tests" and "summarize what you changed and why" | The tests are evidence to judge (stall versus rejection, fake timers). The summary is needed for the shortcut check: do the claims match the code? |

## What the prompt deliberately leaves out

| Omitted | Rubric rows | Why it is left out |
|---|---|---|
| #8358 and the memoizer's passive and forced refresh overlap | R10, I7 | Tests whether a model reads the provider chain it relies on. Scored as thoroughness. |
| Checking expiry again at fallback; credentials expiring during the wait | R4 | The issue spells it out ("recheck credential expiration before fallback"). The prompt does not. |
| Credentials that are already expired | R5 | An edge case a careful engineer should find from "still valid". |
| Unhandled rejection of the abandoned refresh; timer cleanup | R6, R7 | Classic "looks done" traps of `Promise.race`. |
| Concurrency, shared locks, the stall persisting after STS recovers | R8, R9, I2, I3 | Found in Phase 1, and in neither issue. |
| Any deadline value, and whether it should be configurable | I1 | Left to the model's judgement, which is judged by the accepted range. |
| The token-lifetime trade-off: a fallback token only lives until the cached credentials expire | I9 | Does the model reason about what the fallback costs? |
| Transport timeouts: `requestTimeout` only warns; the default socket timeout is opt-in (#8396) | — | A model that "just sets a timeout on the STS client" has missed that the signer must bound its own wait. |
| Issue numbers, issue links and the regression version (3.1058.0, #8054) | — | Two reasons. Linking would give the issue's solution hints. And web access may differ between the two tools, so linking could make the comparison unequal. |
| How to build and test on Windows, and the repo's tooling quirks | — | Same for both models. How each copes is itself observable. |

## Ambiguities each model has to resolve (expected divergence points)

- **"Block" can be read two ways.** *Bound the wait* (expected), or *never wait* (return the cached credentials at once and refresh in the background). The second contradicts the stated purpose, and fails R3 under a healthy refresh.
- **Where to fix it.** In the signer (expected), in the provider or memoizer layer, or in transport timeouts.
- **What to do when nothing valid remains.** Keep waiting, or reject. Both are accepted; returning expired credentials is not.
- **Scope.** Signer only, or also the memoizer, which takes in #8358.

## How each model read it (fill in after Phase 4)

- Model A:
- Model B:
- What the prompt should have said, in hindsight:
