/** Converts one user-visible title to a stable URL slug. */
export function slug(value) {
  return value.toLowerCase().replace(/\s+/g, '-')
}
