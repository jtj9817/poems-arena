import { sql } from 'drizzle-orm';
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';

export const poems = sqliteTable('poems', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  author: text('author').notNull(),
  type: text('type', { enum: ['HUMAN', 'AI'] }).notNull(),
  year: text('year'),
});

export const duels = sqliteTable('duels', {
  id: text('id').primaryKey(),
  topic: text('topic').notNull(),
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

export type Poem = typeof poems.$inferSelect;
export type Duel = typeof duels.$inferSelect;
export type Vote = typeof votes.$inferSelect;
