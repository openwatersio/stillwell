-- D1 database `stillwell-live`: the poller's live window, read by the levels API (docs/plans/cloudflare.md).

-- One row per station per UTC day for the last 8 days. `rows` is a JSON array of
-- [epoch, time_ms, level, flag, source_flag, received_ms] sorted by time, source_flag and received_ms null when absent.
CREATE TABLE IF NOT EXISTS live (
  station TEXT NOT NULL,
  day TEXT NOT NULL,
  rows TEXT NOT NULL,
  PRIMARY KEY (station, day)
) WITHOUT ROWID;

-- One row per poller pass. `intervals` is a JSON array of the `min_interval_s` groups it asked for, empty for every
-- station; `failed` a JSON array of messages. Times are epoch ms.
CREATE TABLE IF NOT EXISTS polls (
  source TEXT NOT NULL,
  started INTEGER NOT NULL,
  finished INTEGER NOT NULL,
  intervals TEXT NOT NULL,
  ok INTEGER NOT NULL,
  stations INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  "values" INTEGER NOT NULL,
  stale INTEGER NOT NULL,
  failed TEXT NOT NULL,
  blocked INTEGER NOT NULL,
  datum_changed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS polls_source_finished ON polls (source, finished);
