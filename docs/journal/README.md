# Journal drafts

One post per learning work package, "what I built, what I learned, what I would change" (ADR-034). An agent drafts `wp-N.md` from the explainer's Recap at `/wrap-wp`; the owner corrects it and it lands in the WP's PR. Sentences where the agent guessed the owner's opinion carry `<!-- owner: check -->` until the owner reviews them.

These files are drafts, not the published journal. Front matter: `wp`, `title`, `status` (`draft` or `approved`), `date`, `locale` (`es`, `en` or `de`). A translation is a second file, `wp-N.<locale>.md`, with the same `wp` and its own `locale`; the front matter, not the file name, decides the locale.

Until the admin exists (WP-17), two commands move them into the content module as `journal` posts (build first; they read `apps/api/.env`):

- `pnpm --filter @jadero/api journal:import` reads every draft here except this README and saves it as a draft revision of its work package's journal post, creating the post the first time. A second run of an unchanged file reports `unchanged` and saves nothing. Both statuses import; a file that still holds `<!-- owner: check -->` is refused, so the owner reviews those sentences first. The import never publishes.
- `pnpm --filter @jadero/api journal:publish <wp> [locales...]` publishes the post, by default every locale with a pending draft. Like all content, it needs es and en live afterwards; a missing German version is only a warning.

The page shows the title from the front matter, so the first `# Title` heading is dropped on import; the localized slug comes from the title and the excerpt from the first paragraph.
