/**
 * Project ids, generated in the frontend.
 *
 * A project id becomes a bare filename stem on the backend (`<id>.json` under
 * the app data directory), so it has to satisfy the same rules the Rust side
 * enforces in `projects::is_safe_project_id`: non-empty, at most 128 characters,
 * no path separators, no reserved characters, and no leading or trailing dot or
 * space. `tests/projects-ui.test.mjs` exercises the ids this produces against
 * those rules, so the two sides cannot drift apart silently.
 */

/** The limit the Rust side enforces for the whole id. */
export const MAX_PROJECT_ID_LENGTH = 128;

/** Where a slug is cut, leaving room for the random suffix inside the limit. */
const MAX_SLUG_LENGTH = 48;

/** Used when a name leaves nothing usable behind, e.g. a name in Cyrillic or CJK. */
const FALLBACK_SLUG = "project";

/** Eight hex characters, enough to keep two projects apart without a round trip. */
export function projectIdSuffix(random: () => number = Math.random): string {
  return Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
}

/**
 * A stable, filesystem-safe slug for a project name. Names that strip down to
 * nothing (German umlauts and other accents mostly survive as ASCII letters,
 * but Cyrillic and CJK do not) fall back to a constant rather than producing an
 * empty id.
 */
export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/, "") || FALLBACK_SLUG
  );
}

/** The id a project saved under `name` gets: a slug plus a random suffix. */
export function projectIdFromName(name: string, suffix: string = projectIdSuffix()): string {
  return `${projectSlug(name)}-${suffix}`.slice(0, MAX_PROJECT_ID_LENGTH);
}
