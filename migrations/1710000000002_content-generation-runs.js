/**
 * Audit table for the nightly Gemini content generator.
 * Lets ops answer "did last night's job run and succeed?" from SQL, e.g.:
 *   SELECT * FROM content_generation_runs ORDER BY created_at DESC LIMIT 20;
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('content_generation_runs', {
    id: { type: 'bigserial', primaryKey: true },
    target_date: { type: 'date', notNull: true },
    lang: { type: 'text', notNull: true },
    model: { type: 'text' },
    // 'success' | 'failed' | 'skipped_locked'
    status: { type: 'text', notNull: true },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('content_generation_runs', ['target_date', 'lang'], {
    name: 'content_generation_runs_date_lang_idx',
  });
  pgm.createIndex('content_generation_runs', 'created_at', {
    name: 'content_generation_runs_created_at_idx',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('content_generation_runs');
};
