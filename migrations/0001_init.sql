-- Private notes. Every row belongs to exactly one Google account (its stable "sub" id).
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_by_owner ON notes (owner, category, title);

-- Per-user category colors.
CREATE TABLE IF NOT EXISTS categories (
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY (owner, name)
) WITHOUT ROWID;
