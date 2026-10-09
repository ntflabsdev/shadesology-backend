/**
 * Generates a URL-safe slug from a string.
 * e.g. "Retractable Awning" → "retractable-awning"
 */
const slugify = (str) => {
  if (!str) {
    return '';
  }
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')   // remove non-word chars
    .replace(/[\s_]+/g, '-')    // spaces/underscores → hyphens
    .replace(/--+/g, '-')       // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');   // trim leading/trailing hyphens
};

module.exports = slugify;
