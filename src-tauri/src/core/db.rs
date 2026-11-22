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
             );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
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

    pub fn delete_pending(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute("DELETE FROM pending_queue WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn insert_history(&self, rec: &HistoryRecord) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "INSERT OR REPLACE INTO history
             (id, kind, engine, url, title, folder, filename, status, total_bytes, created_at, finished_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
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
                rec.finished_at
            ],
        )?;
        Ok(())
    }

    pub fn list_history(
        &self,
        query: &str,
        kind: &str, // all | video | file | torrent
        since_ms: Option<i64>,
        limit: u32,
    ) -> Result<Vec<HistoryRecord>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let like = format!("%{}%", query.to_lowercase().replace('%', ""));
        let mut stmt = conn.prepare(
            "SELECT id, kind, engine, url, title, folder, filename, status, total_bytes, created_at, finished_at
             FROM history
             WHERE (title LIKE ?1 OR url LIKE ?1)
               AND (?2 = 'all' OR kind = ?2)
               AND (?3 IS NULL OR created_at >= ?3)
             ORDER BY finished_at DESC
             LIMIT ?4",
        )?;
        let rows = stmt.query_map(rusqlite::params![like, kind, since_ms, limit], |row| {
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
            })
        })?;
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
        }
    }

    #[test]
    fn insert_and_list() {
        let db = temp_db();
        db.insert_history(&rec("1", "alpha video", "video"))
            .unwrap();
        db.insert_history(&rec("2", "beta file", "file")).unwrap();

        let all = db.list_history("", "all", None, 100).unwrap();
        assert_eq!(all.len(), 2);

        let videos = db.list_history("", "video", None, 100).unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].title, "alpha video");

        let matched = db.list_history("beta", "all", None, 100).unwrap();
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
        db.insert_history(&rec("1", "a", "file")).unwrap();
        assert_eq!(db.clear_history().unwrap(), 1);
        assert!(db.list_history("", "all", None, 100).unwrap().is_empty());
    }
}
