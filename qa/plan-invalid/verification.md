# provider_plan_invalid follow-up — 2026-10-09

Reported error: provider_plan_invalid with a generic server connection message.
The hosted route omitted planning validation/refusal/rate-limit error mappings.
The editing envelope also told every image input to set imageIndex, conflicting
with the planner contract requiring null for each/sheet batch inputs.

Changes: clarify batch versus single binding; on provider_plan_invalid only,
reconstruct the plan once using the same visitor session, complete original
request/context, and explicit execution constraints. Both responses still pass
through the existing Bridge validator. Never retry image generation, refusal,
authentication errors or an already-cancelled request. Skip reconstruction if
the new prompt exceeds 8,000 characters or fewer than 15 seconds remain in the
120-second reconstruction budget. A failed second attempt returns JSON HTTP 424
with an actionable planning validation message and leaves the graph unchanged.

Before implementation, targeted regression checks failed: 424 instead of 200,
one request instead of two, and missing batch-null binding guidance.
After implementation: npm test passed 112/112; npm run build passed including
TypeScript. Tests cover original context/session retention, bounded attempts,
oversized prompts, cancellation, refusal, and no image retries.

Live QA through the existing Cloudflare URL and visitor account: requested
preserving the three-photo cutout stage, then adding white background and soft
lighting. The deployed version produced a validated review with five additions,
four changed labels/details, no deletions, and nine estimated image requests.
The original project stayed at eight nodes/six edges with all three source
photos, original previews, result folder and unrelated advertisement flow.
Saved verified-review.png, then discarded the test draft. No image generation
was executed. The existing Bridge PID 60810 and tunnel remained running;
only the Next web process restarted (session 36633). Public page returned 200.

Limit: the user's exact failing sentence and original provider response were
not available. This test scenario also succeeded before the changes, so these
results do not establish the exact cause of the reported request. Automatic
reconstruction was exercised with controlled Bridge failures in regression
tests; the live GPT request succeeded without exposing an invalid response.
