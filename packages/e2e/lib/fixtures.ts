/**
 * Scraper source URLs used by CDP structural validation tests.
 */
export const GUTENBERG_EMERSON_URL = 'https://www.gutenberg.org/files/12843/12843-h/12843-h.htm';

export const LOC_180_ALL_POEMS_URL =
  'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/';

export const POETS_ORG_POEMS_URL = 'https://poets.org/poems';

/**
 * Known content body class selectors used by the Poets.org scraper.
 * At least one should be present on a valid poem detail page.
 */
export const POETS_ORG_CONTENT_CLASSES = [
  'field--name-body',
  'field--body',
  'field--name-field-poem-body',
  'poem-body',
  'field--name-field-poem',
];
