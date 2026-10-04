# Journal drafts

One post per learning work package, "what I built, what I learned, what I would change" (ADR-034). An agent drafts `wp-N.md` from the explainer's Recap at `/wrap-wp`; the owner corrects it and it lands in the WP's PR. Sentences where the agent guessed the owner's opinion carry `<!-- owner: check -->` until the owner reviews them.

These files are drafts, not the published journal. When the content module has the `journal` post kind (WP-39), they are imported and published from the admin, like all content. Front matter: `wp`, `title`, `status` (`draft` or `approved`), `date`, `locale`.
