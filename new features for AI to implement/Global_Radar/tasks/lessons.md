# Lessons

- When a user narrows a migration request to a first slice, implement the smallest working layer first and defer richer overlays or UI parity until asked.
- When reordering frontend startup to render the shell earlier, verify both race directions: data-before-map and map-before-data, and add an explicit post-fetch render so first-load hydration does not depend on manual refresh.
- When a frontend layer depends on lazily resolved assets, also wire an explicit render invalidation trigger; cache updates alone are not enough for Deck/Canvas layers to repaint reliably.
