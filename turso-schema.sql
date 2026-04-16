-- Turso (SQLite) schema for Stroke Fast Track Timer
-- Run once in Turso SQL shell / migration.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  case_id   TEXT PRIMARY KEY,      -- use startTs as stable ID across devices
  start_ts  INTEGER NOT NULL,       -- epoch ms
  start_loc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id  TEXT NOT NULL,
  action   TEXT NOT NULL,
  ts_ms    INTEGER NOT NULL,
  delta_ms INTEGER,
  loc      TEXT,
  sender   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_case_ts ON events(case_id, ts_ms);

CREATE TABLE IF NOT EXISTS delays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id   TEXT NOT NULL,
  metric    TEXT NOT NULL,          -- door_to_ct / door_to_decision / door_to_refer
  value_ms  INTEGER NOT NULL,
  target_ms INTEGER,
  reasons_json TEXT NOT NULL,       -- JSON array of codes/strings
  note      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delays_case_metric ON delays(case_id, metric);

