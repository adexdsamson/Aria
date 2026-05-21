-- 132_research.sql — Phase 11 Research
-- Tables: research_job, research_report, research_report_section, research_feedback

CREATE TABLE research_job (
  id                TEXT    PRIMARY KEY,
  title             TEXT    NOT NULL,
  goals             TEXT    NOT NULL DEFAULT '',
  domains_json      TEXT    NOT NULL DEFAULT '[]',
  status            TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','done','failed')),
  schedule_interval TEXT    NOT NULL DEFAULT 'none' CHECK (schedule_interval IN ('none','daily','weekly')),
  next_run_at       TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX idx_research_job_status ON research_job(status);

CREATE TABLE research_report (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','done','failed')),
  trigger       TEXT    NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','schedule','feedback_rerun')),
  summary       TEXT,
  confidence_score INTEGER,
  error_message TEXT,
  generated_at  TEXT,
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (job_id) REFERENCES research_job(id) ON DELETE CASCADE
);

CREATE INDEX idx_research_report_job ON research_report(job_id, version DESC);

CREATE TABLE research_report_section (
  id            TEXT    PRIMARY KEY,
  report_id     TEXT    NOT NULL,
  section_type  TEXT    NOT NULL,
  ordinal       INTEGER NOT NULL DEFAULT 0,
  content_json  TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (report_id) REFERENCES research_report(id) ON DELETE CASCADE
);

CREATE INDEX idx_research_report_section_report ON research_report_section(report_id);

CREATE TABLE research_feedback (
  id         TEXT    PRIMARY KEY,
  report_id  TEXT    NOT NULL,
  section_id TEXT,
  thumb      INTEGER CHECK (thumb IN (-1, 1)),
  note       TEXT,
  created_at TEXT    NOT NULL,
  FOREIGN KEY (report_id) REFERENCES research_report(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES research_report_section(id) ON DELETE SET NULL
);

CREATE INDEX idx_research_feedback_report ON research_feedback(report_id);

PRAGMA user_version = 132;
