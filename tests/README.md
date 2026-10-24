# Reader regression checks

Run from the repository root with Node.js 18 or newer:

```sh
node --check app.js
node --check progress.js
node --test tests/*.test.cjs
```

There are no npm dependencies, build step, network calls, or changes to saved user data. Tests execute the actual `index.html` scripts and `app.js` in isolated VM contexts with a small DOM model, fixture-backed `fetch`, and in-memory `localStorage`. Synthetic body content is used only in test contexts when an episode file is unavailable locally, or to verify text-only rendering and refusal of unpublished content. Published files are never rewritten.

Covered: work order and metadata; published table-of-contents order and gaps; previous/next/first/latest links; paragraph and text safety; network failure/retry and stale-response races; malformed routes; theme migration/sync; reader-setting validation, clamps, reset and reload; settings dismissal and repeated navigation.

**Limits:** the harness is not a browser. It cannot validate CSS/layout, computed contrast, real Back/Forward scroll restoration, real keyboard focus behavior, screen readers, mobile touch, or visual appearance. Those require a separate browser check on a runnable preview or the approved public deployment. Back/Forward tests model hash-change event order; reload tests create a fresh context with the same hash and storage.

The tests read current published metadata instead of hard-coding the episode count, so newly published episodes do not require changing an expected total. The gap-specific checks use the intentionally absent 44th `ash-blade` episode.

## Browser-local progress

`progress-store.test.cjs` executes the actual versioned storage module with isolated storage adapters, controlled timestamps and independently cached tabs. It checks strict schema and size limits, per-work boundaries, published gaps, corrupt/unknown records, session-owned recency, clear epochs, quota/security failures, and same-generation merge convergence. The module never uploads history.

`progress-app.test.cjs` exercises the real reader and event handlers with modeled paragraph rectangles, controlled animation frames/timers, visibility and storage events. These models can catch route/restoration races and incorrect write timing, but do not replace actual browser checks for text layout, native scroll/End behavior, focus, viewport widths, or background-tab lifecycle. No claim of cross-process atomic localStorage transactions is made: records are re-read before writes and storage events reconcile same-generation updates.
