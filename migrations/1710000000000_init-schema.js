/**
 * Initial schema: daily_content (served payload) + events (analytics sink).
 * node-pg-migrate records this in the `pgmigrations` table and only ever runs it once.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ---- daily_content ----
  pgm.createTable('daily_content', {
    id: { type: 'bigserial', primaryKey: true },
    date: { type: 'date', notNull: true },
    lang: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // One row per (date, lang); enables idempotent upserts.
  pgm.addConstraint('daily_content', 'daily_content_date_lang_key', { unique: ['date', 'lang'] });
  // Supports "latest on-or-before today for a language".
  pgm.createIndex('daily_content', ['lang', 'date'], { name: 'daily_content_lang_date_idx' });

  // ---- events ----
  pgm.createTable('events', {
    id: { type: 'bigserial', primaryKey: true },
    ts: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    event: { type: 'text', notNull: true },
    user_id: { type: 'text' },
    rashi: { type: 'text' },
    lang: { type: 'text' },
    props: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.createIndex('events', 'ts', { name: 'events_ts_idx' });
  pgm.createIndex('events', 'event', { name: 'events_event_idx' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('events');
  pgm.dropTable('daily_content');
};
