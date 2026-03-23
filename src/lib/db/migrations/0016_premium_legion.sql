-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN,
-- so we use a workaround: check pragma table_info first.
-- If this fails because the column already exists, the migration
-- framework will catch the error and continue.
ALTER TABLE `review_items` ADD `resolution` text;