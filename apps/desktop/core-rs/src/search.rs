//! Живые поиски desktop-профиля — точные порты TS-репозиториев:
//! searchGeo (geo.ts), searchDocuments (ingestion.ts, FTS5),
//! searchOsintEntities (osint.ts). Приватные лица не ищутся: таблица
//! osint_entities содержит только публичные сущности (CHECK на этапе 10).

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::router::meta_envelope;

/// GET /api/v1/geo/search?q= — порт searchGeo (LIKE, порядок уровней).
pub fn geo_search(conn: &Connection, q: Option<&str>) -> Result<Value, String> {
    let query = q.unwrap_or("").trim().to_string();
    let mut items: Vec<Value> = Vec::new();
    if !query.is_empty() {
        let like = format!("%{query}%");
        let mut stmt = conn
            .prepare(
                "SELECT geo_id, level, name, short_name, parent_id, official_code, code_system,
                        grid_col, grid_row, sort_order, is_active,
                        (SELECT COUNT(*) FROM geography c WHERE c.parent_id = g.geo_id)
                 FROM geography g
                 WHERE is_active = 1 AND (name LIKE ?1 OR IFNULL(short_name,'') LIKE ?1 OR geo_id LIKE ?1)
                 ORDER BY CASE level
                   WHEN 'country' THEN 0 WHEN 'federal_district' THEN 1 WHEN 'subject' THEN 2
                   WHEN 'city' THEN 3 WHEN 'municipality' THEN 4 ELSE 5 END,
                   name
                 LIMIT 15",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&like], |r| {
                Ok(json!({
                    "geo_id": r.get::<_, String>(0)?,
                    "level": r.get::<_, String>(1)?,
                    "name": r.get::<_, String>(2)?,
                    "short_name": r.get::<_, Option<String>>(3)?,
                    "parent_id": r.get::<_, Option<String>>(4)?,
                    "official_code": r.get::<_, Option<String>>(5)?,
                    "code_system": r.get::<_, Option<String>>(6)?,
                    "grid_col": r.get::<_, Option<i64>>(7)?,
                    "grid_row": r.get::<_, Option<i64>>(8)?,
                    "sort_order": r.get::<_, i64>(9)?,
                    "is_active": r.get::<_, i64>(10)?,
                    "children_count": r.get::<_, i64>(11)?
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            items.push(row.map_err(|e| e.to_string())?);
        }
    }
    let data = json!({ "query": query, "items": items });
    Ok(json!({ "data": data, "meta": meta_envelope(conn, vec![])? }))
}

/// GET /api/v1/documents/search?q= — порт searchDocuments (FTS5, безопасный MATCH).
pub fn doc_search(conn: &Connection, q: Option<&str>) -> Result<Value, String> {
    let raw = q.unwrap_or("");
    let safe: String = raw
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    let safe = safe.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut hits: Vec<Value> = Vec::new();
    if !safe.is_empty() {
        let term = safe
            .split(' ')
            .map(|w| format!("{w}*"))
            .collect::<Vec<_>>()
            .join(" ");
        let mut stmt = conn
            .prepare(
                "SELECT d.doc_id AS doc_id, d.title AS title,
                        snippet(documents_fts, 2, '…', '…', '…', 12) AS snippet
                 FROM documents_fts f
                 JOIN documents d ON d.doc_id = f.doc_id
                 WHERE documents_fts MATCH ?1
                 ORDER BY rank LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&term], |r| {
                Ok(json!({
                    "doc_id": r.get::<_, String>(0)?,
                    "title": r.get::<_, Option<String>>(1)?,
                    "snippet": r.get::<_, Option<String>>(2)?
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            hits.push(row.map_err(|e| e.to_string())?);
        }
    }
    let data = json!({ "query": safe, "hits": hits });
    Ok(json!({ "data": data, "meta": meta_envelope(conn, vec![])? }))
}

/// GET /api/v1/osint/search?q= — фильтр по публичным сущностям
/// (в TS — JS-фильтр из-за lower() SQLite; в Rust — to_lowercase, корректный для кириллицы).
pub fn osint_search(conn: &Connection, q: Option<&str>) -> Result<Value, String> {
    let query = q.unwrap_or("").trim().to_string();
    let needle = query.to_lowercase();
    let mut items: Vec<Value> = Vec::new();
    if !needle.is_empty() {
        let mut stmt = conn
            .prepare(
                "SELECT entity_id, kind, name, public_role, description, source_id,
                        verification_status, data_mode
                 FROM osint_entities ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "entity_id": r.get::<_, String>(0)?,
                    "kind": r.get::<_, String>(1)?,
                    "name": r.get::<_, String>(2)?,
                    "public_role": r.get::<_, Option<String>>(3)?,
                    "description": r.get::<_, Option<String>>(4)?,
                    "source_id": r.get::<_, String>(5)?,
                    "verification_status": r.get::<_, String>(6)?,
                    "data_mode": r.get::<_, String>(7)?
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let v = row.map_err(|e| e.to_string())?;
            let name = v["name"].as_str().unwrap_or("").to_lowercase();
            let role = v["public_role"].as_str().unwrap_or("").to_lowercase();
            if name.contains(&needle) || role.contains(&needle) {
                items.push(v);
            }
        }
    }
    let data = json!({ "query": query, "items": items });
    Ok(json!({ "data": data, "meta": meta_envelope(conn, vec![])? }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geo_search_empty_query_is_empty() {
        let conn = Connection::open_in_memory().expect("db");
        conn.execute_batch("CREATE TABLE geography (geo_id TEXT, level TEXT, name TEXT, short_name TEXT, parent_id TEXT, official_code TEXT, code_system TEXT, grid_col INTEGER, grid_row INTEGER, sort_order INTEGER, is_active INTEGER); CREATE TABLE build_info (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO build_info VALUES ('built_at','2026-01-01T00:00:00.000Z');").expect("schema");
        let v = geo_search(&conn, Some("")).expect("ok");
        assert_eq!(v["data"]["items"].as_array().unwrap().len(), 0);
        assert_eq!(v["meta"]["dataMode"], "SEED");
    }
}
