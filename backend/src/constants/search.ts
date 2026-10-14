/**
 * Upper bound of the `limit` a log search request may ask for. The request
 * schema enforces it for every caller, and the `MAX_PAGE_SIZE` setting can lower
 * the effective maximum but never raise it above this value.
 */
export const SEARCH_LIMIT_CEILING = 500;
