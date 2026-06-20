/**
 * Deterministic, collision-safe slugs for EPUB chapter filenames.
 *
 * Logseq page names are case-insensitive and may contain spaces, unicode,
 * and punctuation that are illegal or fragile inside a zip/EPUB. We map every
 * chapter key to an ASCII slug and guarantee uniqueness with a numeric suffix.
 */

export class SlugRegistry {
  private used = new Set<string>()
  private cache = new Map<string, string>()

  /** Return a stable, unique `slug` (no extension) for `key`. Idempotent: the
   *  same key always yields the same slug within one registry instance. */
  slug(key: string, prefix = 'p'): string {
    const ck = key.toLowerCase()
    const cached = this.cache.get(ck)
    if (cached) return cached

    let base = key
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip combining diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
    if (!base) base = prefix

    let candidate = base
    let n = 2
    while (this.used.has(candidate)) candidate = `${base}-${n++}`
    this.used.add(candidate)
    this.cache.set(ck, candidate)
    return candidate
  }
}
