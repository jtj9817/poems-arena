/**
 * Canonical topic set and theme-to-topic mappings for the ETL tag stage.
 *
 * CANONICAL_TOPICS is the authoritative list of topic IDs used throughout the
 * pipeline. Every topic stored in the database must be one of these values.
 *
 * THEME_TO_TOPIC maps raw source theme strings (case-insensitive) to one or
 * more canonical topic IDs. This covers themes emitted by all four scrapers
 * (poets.org, Poetry Foundation, LOC 180, Gutenberg).
 *
 * KEYWORD_TOPICS provides a fallback: for poems that carry no mappable themes,
 * the title and content are scanned for characteristic words to assign topics.
 */

// ---------------------------------------------------------------------------
// Canonical topic IDs — aligned with Plan 001, Section 5.2 Stage 3
// ---------------------------------------------------------------------------

export const CANONICAL_TOPICS = [
  'nature',
  'mortality',
  'love',
  'time',
  'loss',
  'identity',
  'war',
  'faith',
  'beauty',
  'solitude',
  'memory',
  'childhood',
  'the-sea',
  'night',
  'grief',
  'desire',
  'home',
  'myth',
  'dreams',
  'rebellion',
] as const;

export type CanonicalTopic = (typeof CANONICAL_TOPICS)[number];

/** Display labels used when upserting rows into the `topics` table. */
export const TOPIC_LABELS: Record<CanonicalTopic, string> = {
  nature: 'Nature',
  mortality: 'Mortality',
  love: 'Love',
  time: 'Time',
  loss: 'Loss',
  identity: 'Identity',
  war: 'War',
  faith: 'Faith',
  beauty: 'Beauty',
  solitude: 'Solitude',
  memory: 'Memory',
  childhood: 'Childhood',
  'the-sea': 'The Sea',
  night: 'Night',
  grief: 'Grief',
  desire: 'Desire',
  home: 'Home',
  myth: 'Myth',
  dreams: 'Dreams',
  rebellion: 'Rebellion',
};

/** Maximum number of canonical topics assigned to a single poem. */
export const MAX_TOPICS = 3;

// ---------------------------------------------------------------------------
// Raw theme → canonical topic mapping
//
// Keys are downcased so lookups are case-insensitive (see mapThemesToTopics).
// Values list all canonical topics that theme implies.
// ---------------------------------------------------------------------------

export const THEME_TO_TOPIC: Readonly<Record<string, CanonicalTopic[]>> = {
  // --- Nature ---
  nature: ['nature'],
  weather: ['nature'],
  seasons: ['nature', 'time'],
  animals: ['nature'],
  plants: ['nature'],
  flowers: ['nature'],
  birds: ['nature'],
  trees: ['nature'],
  earth: ['nature'],
  landscape: ['nature'],
  'natural world': ['nature'],
  environment: ['nature'],
  ecology: ['nature'],

  // --- Mortality ---
  death: ['mortality', 'grief'],
  mortality: ['mortality'],
  dying: ['mortality'],
  afterlife: ['mortality', 'faith'],
  'life & death': ['mortality'],

  // --- Love ---
  love: ['love'],
  romance: ['love'],
  'romantic love': ['love'],
  marriage: ['love'],
  relationships: ['love'],
  devotion: ['love'],
  passion: ['love', 'desire'],

  // --- Time ---
  time: ['time'],
  aging: ['time'],
  history: ['time', 'memory'],
  'time passing': ['time'],

  // --- Loss ---
  loss: ['loss'],
  absence: ['loss'],
  longing: ['loss', 'desire'],
  farewell: ['loss'],
  departure: ['loss'],
  separation: ['loss'],

  // --- Identity ---
  identity: ['identity'],
  self: ['identity'],
  'coming of age': ['identity', 'childhood'],
  race: ['identity'],
  gender: ['identity'],
  'cultural heritage': ['identity'],
  culture: ['identity'],
  'race & ethnicity': ['identity'],
  'gender & sexuality': ['identity'],
  immigrant: ['identity', 'home'],

  // --- War ---
  war: ['war'],
  battle: ['war'],
  military: ['war'],
  conflict: ['war'],
  veterans: ['war'],
  peace: ['war'],
  violence: ['war'],
  patriotism: ['war', 'identity'],

  // --- Faith ---
  faith: ['faith'],
  religion: ['faith'],
  god: ['faith'],
  spirituality: ['faith'],
  prayer: ['faith'],
  christianity: ['faith'],
  belief: ['faith'],
  'mythology & folklore': ['myth', 'faith'],
  mythology: ['myth'],
  'the spiritual': ['faith'],
  divine: ['faith'],
  sacred: ['faith'],

  // --- Beauty ---
  beauty: ['beauty'],
  aesthetic: ['beauty'],
  art: ['beauty'],
  music: ['beauty'],
  'arts & sciences': ['beauty'],
  painting: ['beauty'],
  dance: ['beauty'],
  poetry: ['beauty'],
  arts: ['beauty'],

  // --- Solitude ---
  solitude: ['solitude'],
  loneliness: ['solitude'],
  isolation: ['solitude'],
  silence: ['solitude'],
  stillness: ['solitude'],

  // --- Memory ---
  memory: ['memory'],
  nostalgia: ['memory'],
  remembrance: ['memory'],
  past: ['memory', 'time'],
  'the past': ['memory', 'time'],
  recollection: ['memory'],

  // --- Childhood ---
  childhood: ['childhood'],
  youth: ['childhood'],
  'growing up': ['childhood', 'identity'],
  innocence: ['childhood'],
  'childhood & coming of age': ['childhood', 'identity'],
  'coming-of-age': ['childhood', 'identity'],
  family: ['childhood', 'home'],
  'childhood & adolescence': ['childhood'],

  // --- The Sea ---
  oceans: ['the-sea'],
  sea: ['the-sea'],
  ocean: ['the-sea'],
  'the sea': ['the-sea'],
  water: ['the-sea', 'nature'],
  sailing: ['the-sea'],
  ships: ['the-sea'],
  waves: ['the-sea', 'nature'],
  coast: ['the-sea', 'nature'],
  beach: ['the-sea', 'nature'],
  'rivers & streams': ['the-sea', 'nature'],

  // --- Night ---
  night: ['night'],
  darkness: ['night'],
  moon: ['night', 'nature'],
  stars: ['night', 'nature'],
  evening: ['night'],
  dusk: ['night'],
  dawn: ['night'],
  sleep: ['night', 'dreams'],
  'night & dreams': ['night', 'dreams'],

  // --- Grief ---
  grief: ['grief'],
  mourning: ['grief', 'loss'],
  sorrow: ['grief', 'loss'],
  'mourning & grief': ['grief', 'loss'],
  lamentation: ['grief'],
  sadness: ['grief'],
  suffering: ['grief'],

  // --- Desire ---
  desire: ['desire'],
  lust: ['desire'],
  yearning: ['desire', 'loss'],
  want: ['desire'],

  // --- Home ---
  home: ['home'],
  domestic: ['home'],
  place: ['home'],
  belonging: ['home', 'identity'],
  homeland: ['home', 'identity'],
  travel: ['home'],
  journey: ['home', 'loss'],

  // --- Myth ---
  myth: ['myth'],
  legend: ['myth'],
  ancient: ['myth'],
  classical: ['myth'],
  folklore: ['myth'],
  epic: ['myth'],
  'greek mythology': ['myth'],
  'roman mythology': ['myth'],
  'native american': ['myth', 'identity'],

  // --- Dreams ---
  dreams: ['dreams'],
  dream: ['dreams'],
  imagination: ['dreams', 'beauty'],
  fantasy: ['dreams'],
  vision: ['dreams'],
  'the imaginary': ['dreams'],
  reverie: ['dreams'],

  // --- Rebellion ---
  rebellion: ['rebellion'],
  resistance: ['rebellion'],
  revolution: ['rebellion'],
  freedom: ['rebellion'],
  justice: ['rebellion'],
  'social commentaries': ['rebellion', 'identity'],
  social: ['rebellion'],
  politics: ['rebellion'],
  activism: ['rebellion'],
  protest: ['rebellion'],
  oppression: ['rebellion', 'identity'],
};

// ---------------------------------------------------------------------------
// Keyword fallback map
//
// Ordered by specificity (more specific topics first where there is ambiguity).
// Each entry maps a topic to the keywords that strongly suggest it.
// Keyword matching uses word-boundary regex so "art" won't match "heart".
// ---------------------------------------------------------------------------

const KEYWORD_TOPICS: ReadonlyArray<{
  readonly keywords: readonly string[];
  readonly topic: CanonicalTopic;
}> = [
  {
    topic: 'the-sea',
    keywords: [
      'sea',
      'ocean',
      'wave',
      'shore',
      'coast',
      'sail',
      'ship',
      'tide',
      'fisherman',
      'voyage',
      'harbor',
      'mariner',
      'nautical',
    ],
  },
  {
    topic: 'war',
    keywords: [
      'war',
      'battle',
      'soldier',
      'army',
      'cannon',
      'sword',
      'bayonet',
      'trench',
      'veteran',
      'sergeant',
      'regiment',
      'siege',
    ],
  },
  {
    topic: 'myth',
    keywords: [
      'myth',
      'legend',
      'odyssey',
      'zeus',
      'apollo',
      'athena',
      'hermes',
      'achilles',
      'trojan',
      'oracle',
      'sphinx',
      'hercules',
    ],
  },
  {
    topic: 'mortality',
    keywords: [
      'death',
      'dying',
      'grave',
      'tomb',
      'corpse',
      'coffin',
      'funeral',
      'mourn',
      'immortal',
      'perish',
      'ashes',
      'decay',
    ],
  },
  {
    topic: 'grief',
    keywords: [
      'grief',
      'grieve',
      'sorrow',
      'weep',
      'sob',
      'lament',
      'wail',
      'mourn',
      'mourning',
      'bereavement',
      'tears',
    ],
  },
  {
    topic: 'faith',
    keywords: [
      'god',
      'prayer',
      'pray',
      'church',
      'holy',
      'divine',
      'sacred',
      'angel',
      'psalm',
      'hymn',
      'cathedral',
      'worship',
      'blessed',
    ],
  },
  {
    topic: 'love',
    keywords: [
      'love',
      'lover',
      'beloved',
      'sweetheart',
      'darling',
      'adore',
      'cherish',
      'affection',
      'devotion',
      'romance',
      'tender',
    ],
  },
  {
    topic: 'desire',
    keywords: ['desire', 'crave', 'yearn', 'hunger', 'thirst', 'longing', 'lust', 'hunger'],
  },
  {
    topic: 'nature',
    keywords: [
      'nature',
      'tree',
      'flower',
      'forest',
      'rain',
      'wind',
      'sun',
      'leaf',
      'grass',
      'mountain',
      'river',
      'brook',
      'bloom',
      'garden',
      'meadow',
      'petal',
      'blossom',
    ],
  },
  {
    topic: 'night',
    keywords: [
      'night',
      'moon',
      'star',
      'midnight',
      'dusk',
      'twilight',
      'shadow',
      'darkness',
      'moonlight',
      'starlight',
      'nocturnal',
    ],
  },
  {
    topic: 'dreams',
    keywords: [
      'dream',
      'vision',
      'imagine',
      'fantasy',
      'reverie',
      'nightmare',
      'slumber',
      'imagination',
    ],
  },
  {
    topic: 'memory',
    keywords: [
      'memory',
      'remember',
      'recall',
      'forgot',
      'forgotten',
      'nostalgia',
      'reminisce',
      'recollect',
      'remembrance',
    ],
  },
  {
    topic: 'childhood',
    keywords: [
      'childhood',
      'child',
      'children',
      'innocence',
      'innocent',
      'youth',
      'schoolboy',
      'schoolgirl',
      'cradle',
      'nursery',
    ],
  },
  {
    topic: 'home',
    keywords: [
      'home',
      'hearth',
      'fireside',
      'household',
      'dwelling',
      'homeland',
      'cottage',
      'shelter',
      'threshold',
    ],
  },
  {
    topic: 'solitude',
    keywords: [
      'solitude',
      'solitary',
      'lonely',
      'loneliness',
      'alone',
      'isolation',
      'silence',
      'still',
      'withdrawn',
    ],
  },
  {
    topic: 'rebellion',
    keywords: [
      'rebel',
      'rebellion',
      'revolution',
      'protest',
      'freedom',
      'chain',
      'prison',
      'oppression',
      'tyrant',
      'tyranny',
    ],
  },
  {
    topic: 'identity',
    keywords: [
      'identity',
      'heritage',
      'ancestry',
      'ancestor',
      'immigrant',
      'belong',
      'exile',
      'diaspora',
    ],
  },
  {
    topic: 'beauty',
    keywords: [
      'beauty',
      'beautiful',
      'loveliness',
      'splendor',
      'radiant',
      'glorious',
      'sublime',
      'elegance',
    ],
  },
  {
    topic: 'time',
    keywords: [
      'time',
      'eternity',
      'eternal',
      'century',
      'millennium',
      'hourglass',
      'fleeting',
      'transient',
      'twilight',
    ],
  },
  {
    topic: 'loss',
    keywords: [
      'lost',
      'absence',
      'vanish',
      'departure',
      'farewell',
      'abandon',
      'forsaken',
      'missing',
    ],
  },
];

// ---------------------------------------------------------------------------
// Public mapping functions
// ---------------------------------------------------------------------------

/**
 * Maps an array of raw source theme strings to canonical topic IDs.
 *
 * Matching is case-insensitive and whitespace-normalized. Returns only topics
 * in CANONICAL_TOPICS; unknown themes are silently ignored. Output is
 * deduplicated but NOT capped — callers should apply MAX_TOPICS via
 * assignTopics().
 */
export function mapThemesToTopics(themes: string[]): CanonicalTopic[] {
  const seen = new Set<CanonicalTopic>();
  for (const theme of themes) {
    const key = theme.trim().toLowerCase();
    const mapped = THEME_TO_TOPIC[key];
    if (mapped) {
      for (const t of mapped) seen.add(t);
    }
  }
  return Array.from(seen);
}

/**
 * Returns true when `keyword` appears as a whole word in `text` (case-insensitive).
 */
function containsWholeWord(text: string, keyword: string): boolean {
  // Escape regex metacharacters in the keyword before building the pattern.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Extracts canonical topics from poem title and content using keyword analysis.
 *
 * Used as a fallback when mapThemesToTopics() produces no results. Output is
 * deduplicated but NOT capped.
 */
export function extractTopicsFromKeywords(title: string, content: string): CanonicalTopic[] {
  const text = `${title} ${content}`;
  const seen = new Set<CanonicalTopic>();
  for (const { keywords, topic } of KEYWORD_TOPICS) {
    for (const kw of keywords) {
      if (containsWholeWord(text, kw)) {
        seen.add(topic);
        break; // One keyword match per topic is sufficient
      }
    }
  }
  return Array.from(seen);
}

/**
 * Assigns canonical topics to a poem.
 *
 * Algorithm:
 *   1. Map raw `themes` to canonical topics.
 *   2. If the result is empty, fall back to keyword extraction from title + content.
 *   3. Deduplicate (already guaranteed by Set usage above).
 *   4. Cap at MAX_TOPICS (3) to avoid noise.
 *
 * Returns { topics, usedFallback } where `usedFallback` is true if and only if
 * keyword extraction was attempted AND produced at least one result.
 */
export function assignTopics(
  themes: string[],
  title: string,
  content: string,
): { topics: CanonicalTopic[]; usedFallback: boolean } {
  const themeTopics = mapThemesToTopics(themes);

  if (themeTopics.length > 0) {
    return { topics: themeTopics.slice(0, MAX_TOPICS), usedFallback: false };
  }

  const keywordTopics = extractTopicsFromKeywords(title, content);
  return {
    topics: keywordTopics.slice(0, MAX_TOPICS),
    usedFallback: keywordTopics.length > 0,
  };
}
