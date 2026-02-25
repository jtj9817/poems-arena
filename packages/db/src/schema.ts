import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const poems = sqliteTable('poems', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  author: text('author').notNull(),
  type: text('type', { enum: ['HUMAN', 'AI'] }).notNull(),
  year: text('year'),
  source: text('source'),
  sourceUrl: text('source_url'),
  form: text('form'),
  prompt: text('prompt'),
  parentPoemId: text('parent_poem_id').references((): AnySQLiteColumn => poems.id),
});

export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const poemTopics = sqliteTable(
  'poem_topics',
  {
    poemId: text('poem_id')
      .notNull()
      .references(() => poems.id),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.poemId, t.topicId] }),
  }),
);

export const scrapeSources = sqliteTable('scrape_sources', {
  id: text('id').primaryKey(),
  poemId: text('poem_id')
    .notNull()
    .references(() => poems.id),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  scrapedAt: text('scraped_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  rawHtml: text('raw_html'),
  isPublicDomain: integer('is_public_domain', { mode: 'boolean' }).notNull().default(false),
});

export const duels = sqliteTable('duels', {
  id: text('id').primaryKey(),
  topic: text('topic').notNull(),
  topicId: text('topic_id').references(() => topics.id),
  poemAId: text('poem_a_id')
    .notNull()
    .references(() => poems.id),
  poemBId: text('poem_b_id')
    .notNull()
    .references(() => poems.id),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const votes = sqliteTable('votes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  duelId: text('duel_id')
    .notNull()
    .references(() => duels.id),
  selectedPoemId: text('selected_poem_id')
    .notNull()
    .references(() => poems.id),
  isHuman: integer('is_human', { mode: 'boolean' }).notNull(),
  votedAt: text('voted_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const featuredDuels = sqliteTable(
  'featured_duels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    duelId: text('duel_id')
      .notNull()
      .references(() => duels.id),
    featuredOn: text('featured_on').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    featuredOnIdx: index('featured_duels_featured_on_idx').on(t.featuredOn),
    duelIdIdx: index('featured_duels_duel_id_idx').on(t.duelId),
  }),
);

export type Poem = typeof poems.$inferSelect;
export type Duel = typeof duels.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type ScrapeSource = typeof scrapeSources.$inferSelect;
export type FeaturedDuel = typeof featuredDuels.$inferSelect;
