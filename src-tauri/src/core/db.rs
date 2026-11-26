//! Local persistence: download history (rusqlite, bundled SQLite).
//! Lives in the app data dir; queue/session state stays in aria2 session
//! files. All queries run on blocking threads.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub kind: String,
    pub engine: String,
    pub url: String,
    pub title: String,
    pub folder: Option<String>,
    pub filename: Option<String>,
    pub status: String,
    pub total_bytes: Option<i64>,
    pub created_at: i64,
    pub finished_at: i64,
    // v2 columns (migration): rich history fields
    pub thumbnail: Option<String>,
    pub format: Option<String>,
    pub save_path: Option<String>,
    pub started_at: Option<i64>,
    /// One of: queued | downloading | merging | seeding | paused |
    /// completed | failed | canceled | interrupted
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingJob {
    pub id: String,
    pub kind: String,
    pub url: String,
    pub title: String,
    pub folder: Option<String>,
    pub spec_json: String,
    pub created_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("db error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &PathBuf) -> Result<Self, DbError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS history (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                engine      TEXT NOT NULL,
                url         TEXT NOT NULL,
                title       TEXT NOT NULL,
                folder      TEXT,
                filename    TEXT,
                status      TEXT NOT NULL,
                total_bytes INTEGER,
                created_at  INTEGER NOT NULL,
                finished_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
             CREATE TABLE IF NOT EXISTS pending_queue (
                id         TEXT PRIMARY KEY,
                kind       TEXT NOT NULL,
                url        TEXT NOT NULL,
                title      TEXT NOT NULL,
                folder     TEXT,
                spec_json  TEXT NOT NULL,
                created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Schema migrations keyed by PRAGMA user_version. Each step is applied
    /// in a transaction and never destroys existing data.
    fn migrate(conn: &Connection) -> Result<(), DbError> {
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 2 {
            // v2: rich history columns (thumbnail, format, save_path,
            // started_at, error). ALTER TABLE keeps all existing rows.
            for column in [
                "ALTER TABLE history ADD COLUMN thumbnail TEXT",
                "ALTER TABLE history ADD COLUMN format TEXT",
                "ALTER TABLE history ADD COLUMN save_path TEXT",
                "ALTER TABLE history ADD COLUMN started_at INTEGER",
                "ALTER TABLE history ADD COLUMN error TEXT",
            ] {
                // Ignore "duplicate column" — the ALTER already applied.
                let _ = conn.execute(column, []);
            }
            conn.execute_batch("PRAGMA user_version = 2")?;
        }
        if version < 3 {
            conn.execute_batch(
                "ALTER TABLE history ADD COLUMN search_text TEXT NOT NULL DEFAULT '';",
            )?;
            let mut stmt = conn.prepare("SELECT id, title, url FROM history")?;
            let rows: Vec<(String, String, String)> = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<_, _>>()?;
            drop(stmt);
            for (id, title, url) in rows {
                conn.execute(
                    "UPDATE history SET search_text = ?2 WHERE id = ?1",
                    rusqlite::params![id, format!("{} {}", title, url).to_lowercase()],
                )?;
            }
            conn.execute_batch("PRAGMA user_version = 3")?;
        }
        Ok(())
    }

    /// Persists an unfinished video job for restore-after-restart.
    pub fn save_pending(&self, rec: &PendingJob) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "INSERT OR REPLACE INTO pending_queue
             (id, kind, url, title, folder, spec_json, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                rec.id,
                rec.kind,
                rec.url,
                rec.title,
                rec.folder,
                rec.spec_json,
                rec.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_pending(&self) -> Result<Vec<PendingJob>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            "SELECT id, kind, url, title, folder, spec_json, created_at
             FROM pending_queue ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PendingJob {
                id: row.get(0)?,
                kind: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                folder: row.get(4)?,
                spec_json: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn delete_history_record(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_pending(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute("DELETE FROM pending_queue WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    /// Insert-or-replace a full history record (id-keyed, so status updates
    /// never duplicate rows).
    pub fn upsert_history(&self, rec: &HistoryRecord) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "INSERT OR REPLACE INTO history
             (id, kind, engine, url, title, folder, filename, status,
              total_bytes, created_at, finished_at, thumbnail, format,
              save_path, started_at, error, search_text)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            rusqlite::params![
                rec.id,
                rec.kind,
                rec.engine,
                rec.url,
                rec.title,
                rec.folder,
                rec.filename,
                rec.status,
                rec.total_bytes,
                rec.created_at,
                rec.finished_at,
                rec.thumbnail,
                rec.format,
                rec.save_path,
                rec.started_at,
                rec.error,
                format!("{} {}", rec.title, rec.url).to_lowercase()
            ],
        )?;
        Ok(())
    }

    /// Lightweight status patch (no full-row replace): used on every state
    /// transition. Sets started_at the first time a job starts downloading.
    pub fn patch_history_status(
        &self,
        id: &str,
        status: &str,
        started_at: Option<i64>,
        error: Option<&str>,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "UPDATE history
             SET status = ?2,
                 error = CASE WHEN ?6 IS NULL AND ?2 IN ('queued','downloading','merging','paused','completed') THEN NULL ELSE COALESCE(?6, error) END,
                 started_at = COALESCE(started_at, ?3),
                 finished_at = CASE WHEN ?4 IN ('completed','failed','canceled','interrupted')
                                    THEN COALESCE(NULLIF(finished_at, 0), ?5) ELSE finished_at END
             WHERE id = ?1",
            rusqlite::params![
                id,
                status,
                started_at,
                status,
                chrono::Utc::now().timestamp_millis(),
                error
            ],
        )?;
        Ok(())
    }

    pub fn finish_history(
        &self,
        id: &str,
        status: &str,
        total_bytes: i64,
        filename: Option<&str>,
        save_path: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "UPDATE history
             SET status = ?2,
                 total_bytes = ?3,
                 filename = COALESCE(?4, filename),
                 save_path = COALESCE(?5, save_path),
                 error = CASE WHEN ?6 IS NULL AND ?2 IN ('queued','downloading','merging','paused','completed') THEN NULL ELSE COALESCE(?6, error) END,
                 finished_at = ?7
             WHERE id = ?1",
            rusqlite::params![
                id,
                status,
                total_bytes,
                filename,
                save_path,
                error,
                chrono::Utc::now().timestamp_millis()
            ],
        )?;
        Ok(())
    }

    /// Marks unfinished (queued/downloading/merging) tasks as interrupted
    /// after an app restart — never as completed.
    pub fn mark_interrupted(&self) -> Result<usize, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let n = conn.execute(
            "UPDATE history
             SET status = 'interrupted',
                 error = 'application closed during download',
                 finished_at = COALESCE(NULLIF(finished_at, 0), ?1)
             WHERE status IN ('queued', 'downloading', 'merging')",
            rusqlite::params![chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(n)
    }

    pub fn list_history(
        &self,
        query: &str,
        kind: &str,   // all | video | file | torrent
        status: &str, // all | completed | failed | canceled | interrupted
        since_ms: Option<i64>,
        limit: u32,
    ) -> Result<Vec<HistoryRecord>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let escaped = query
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like = format!("%{escaped}%");
        let mut stmt = conn.prepare(
            "SELECT id, kind, engine, url, title, folder, filename, status, total_bytes, created_at, finished_at,
                    thumbnail, format, save_path, started_at, error
             FROM history
             WHERE search_text LIKE ?1 ESCAPE '\\'
               AND (?2 = 'all' OR kind = ?2)
               AND (?3 = 'all' OR status = ?3)
               AND (?4 IS NULL OR created_at >= ?4)
             ORDER BY finished_at DESC
             LIMIT ?5",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![like, kind, status, since_ms, limit],
            |row| {
                Ok(HistoryRecord {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    engine: row.get(2)?,
                    url: row.get(3)?,
                    title: row.get(4)?,
                    folder: row.get(5)?,
                    filename: row.get(6)?,
                    status: row.get(7)?,
                    total_bytes: row.get(8)?,
                    created_at: row.get(9)?,
                    finished_at: row.get(10)?,
                    thumbnail: row.get(11)?,
                    format: row.get(12)?,
                    save_path: row.get(13)?,
                    started_at: row.get(14)?,
                    error: row.get(15)?,
                })
            },
        )?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn clear_history(&self) -> Result<usize, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let n = conn.execute("DELETE FROM history", [])?;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Db {
        let dir =
            std::env::temp_dir().join(format!("gruzly-test-{}", uuid::Uuid::new_v4().simple()));
        Db::open(&dir.join("test.db")).unwrap()
    }

    fn rec(id: &str, title: &str, kind: &str) -> HistoryRecord {
        HistoryRecord {
            id: id.into(),
            kind: kind.into(),
            engine: "aria2".into(),
            url: format!("https://example.org/{title}"),
            title: title.into(),
            folder: None,
            filename: None,
            status: "completed".into(),
            total_bytes: Some(1234),
            created_at: 100,
            finished_at: 200,
            thumbnail: None,
            format: None,
            save_path: None,
            started_at: None,
            error: None,
        }
    }

    #[test]
    fn insert_and_list() {
        let db = temp_db();
        db.upsert_history(&rec("1", "alpha video", "video"))
            .unwrap();
        db.upsert_history(&rec("2", "beta file", "file")).unwrap();

        let all = db.list_history("", "all", "all", None, 100).unwrap();
        assert_eq!(all.len(), 2);

        let videos = db.list_history("", "video", "all", None, 100).unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].title, "alpha video");

        let matched = db.list_history("beta", "all", "all", None, 100).unwrap();
        assert_eq!(matched.len(), 1);
    }

    fn pending(id: &str) -> PendingJob {
        PendingJob {
            id: id.into(),
            kind: "video".into(),
            url: "https://youtu.be/x".into(),
            title: "Test video".into(),
            folder: Some("D:/DL".into()),
            spec_json: r#"{"url":"https://youtu.be/x","audioOnly":false,"subtitles":[]}"#.into(),
            created_at: 42,
        }
    }

    #[test]
    fn migrates_legacy_rows_with_unicode_search_text() {
        let dir = std::env::temp_dir().join(format!(
            "gruzly-legacy-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE history (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, engine TEXT NOT NULL,
                    url TEXT NOT NULL, title TEXT NOT NULL, folder TEXT, filename TEXT,
                    status TEXT NOT NULL, total_bytes INTEGER, created_at INTEGER NOT NULL,
                    finished_at INTEGER NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO history (id, kind, engine, url, title, status, created_at, finished_at)
                 VALUES ('legacy', 'video', 'yt-dlp', 'https://example.org', 'БОЛЬШОЕ ВИДЕО', 'completed', 1, 2)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(
            db.list_history("видео", "all", "all", None, 100)
                .unwrap()
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unicode_search_and_status_filter() {
        let db = temp_db();
        let mut item = rec("ru", "Большое ВИДЕО", "video");
        item.status = "failed".into();
        db.upsert_history(&item).unwrap();

        assert_eq!(
            db.list_history("видео", "all", "failed", None, 100)
                .unwrap()
                .len(),
            1
        );
        assert!(db
            .list_history("видео", "all", "completed", None, 100)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn pending_queue_roundtrip() {
        let db = temp_db();
        db.save_pending(&pending("1")).unwrap();
        db.save_pending(&pending("2")).unwrap();

        let all = db.list_pending().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "1");
        assert_eq!(all[1].folder.as_deref(), Some("D:/DL"));

        db.delete_pending("1").unwrap();
        let rest = db.list_pending().unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, "2");
    }

    #[test]
    fn clear_history() {
        let db = temp_db();
        db.upsert_history(&rec("1", "a", "file")).unwrap();
        assert_eq!(db.clear_history().unwrap(), 1);
        assert!(db
            .list_history("", "all", "all", None, 100)
            .unwrap()
            .is_empty());
    }
}
