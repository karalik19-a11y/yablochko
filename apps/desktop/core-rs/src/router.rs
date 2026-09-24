//! IPC-роутер desktop-профиля (Этап 15, ARCHITECTURE §7.4: Tauri IPC → Rust-ядро).
//!
//! Приоритет обработки GET:
//!  1) точное попадание в api_cache (пре-рендер настоящего Node-приложения
//!     на этапе сборки — scripts/build-desktop-resources.ts);
//!  2) живые обработчики: поиски, metrics/compare, metrics/trust,
//!     decision/compute;
//!  3) кэш по чистому пути (territory/:geoId и т.п.);
//!  4) 404-конверт.
//! POST: analyst/ask (FAQ-кэш + честный fallback), analyst/verify, alerts
//! (acknowledge). Форматы конвертов идентичны Fastify-профилю.

use rusqlite::Connection;
use serde_json::{json, Map, Value};

pub mod compute;
pub mod search;

pub fn err_json(message: &str) -> Value {
    json!({ "error": message })
}

/// meta-конверт; generatedAt = время сборки ресурсов (build_info).
pub fn meta_envelope(conn: &Connection, warnings: Vec<&str>) -> Result<Value, String> {
    let built_at: String = conn
        .query_row(
            "SELECT value FROM build_info WHERE key = 'built_at'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_string());
    Ok(json!({
        "generatedAt": built_at,
        "dataMode": "SEED",
        "warnings": warnings
    }))
}

/// Путь ресурса: env YABLOKO_RESOURCE_DIR → <exe_dir>/resources/<name>.
pub fn resource_path(name: &str) -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("YABLOKO_RESOURCE_DIR") {
        return std::path::PathBuf::from(dir).join(name);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = exe.parent().unwrap_or(std::path::Path::new("."));
    dir.join("resources").join(name)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i: usize = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hi = (b[i + 1] as char).to_digit(16);
            let lo = (b[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h * 16) + l) as u8);
                i += 3;
                continue;
            }
        }
        if b[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(b[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Значение параметра query-строки.
pub fn qp(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        if k == key {
            return Some(percent_decode(it.next().unwrap_or("")));
        }
    }
    None
}

fn cache_get(conn: &Connection, path: &str) -> Result<Option<Value>, String> {
    let res: Result<String, _> = conn.query_row(
        "SELECT payload_json FROM api_cache WHERE path = ?1",
        [path],
        |r| r.get(0),
    );
    match res {
        Ok(json_str) => serde_json::from_str(&json_str)
            .map(Some)
            .map_err(|e| format!("cache parse failed: {e}")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Единая точка входа IPC-команды `api`.
pub fn handle(
    conn: &Connection,
    path: &str,
    query: Option<&str>,
    method: Option<&str>,
    body: Option<&str>,
) -> Result<Value, String> {
    let m = method.unwrap_or("GET").to_uppercase();
    let q = query.unwrap_or("");
    let full = if q.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{q}")
    };

    if m == "POST" {
        if path == "/api/v1/analyst/ask" {
            return analyst_ask(conn, body);
        }
        if path == "/api/v1/analyst/verify" {
            return analyst_verify(conn, body);
        }
        if path == "/api/v1/alerts" {
            return alert_acknowledge(conn, body);
        }
        return Ok(err_json("Неизвестный маршрут API"));
    }

    // 1) точное попадание в кэш (включая параметризованную сетку сборки)
    if let Some(v) = cache_get(conn, &full)? {
        return Ok(v);
    }

    // 2) живые обработчики
    match path {
        "/api/v1/geo/search" => return search::geo_search(conn, qp(q, "q").as_deref()),
        "/api/v1/documents/search" => return search::doc_search(conn, qp(q, "q").as_deref()),
        "/api/v1/osint/search" => return search::osint_search(conn, qp(q, "q").as_deref()),
        "/api/v1/metrics/compare" => return metrics_compare(conn, q),
        "/api/v1/metrics/trust" => return metrics_trust(conn, q),
        "/api/v1/decision/compute" => return compute::decision_compute(conn, q),
        _ => {}
    }

    // 3) кэш по чистому пути (territory/:geoId и пр.)
    if let Some(v) = cache_get(conn, path)? {
        return Ok(v);
    }

    Ok(err_json("Неизвестный маршрут API"))
}

fn current_source_id(conn: &Connection) -> Result<String, String> {
    let live: Option<String> = conn
        .query_row(
            "SELECT source_id FROM regional_metrics WHERE data_mode = 'LIVE' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(s) = live {
        return Ok(s);
    }
    let any: Option<String> = conn
        .query_row(
            "SELECT DISTINCT source_id FROM regional_metrics LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(any.unwrap_or_else(|| "synthetic-demo".to_string()))
}

/// GET /api/v1/metrics/compare?codes=&fd= — порт compareSubjects.
fn metrics_compare(conn: &Connection, query: &str) -> Result<Value, String> {
    let codes: Vec<String> = match qp(query, "codes") {
        Some(c) => c
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_'))
            .take(6)
            .collect(),
        None => Vec::new(),
    };
    let codes = if codes.is_empty() {
        vec![
            "pop_total".to_string(),
            "inc_avg_wage_month".to_string(),
            "labor_unemployment_rate".to_string(),
        ]
    } else {
        codes
    };
    let fd = qp(query, "fd").filter(|f| f.starts_with("ru:fd:"));

    let period: String = conn
        .query_row("SELECT MAX(period) FROM regional_metrics", [], |r| {
            r.get::<_, Option<String>>(0)
        })
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "2025".to_string());
    let src = current_source_id(conn)?;

    // units
    let mut units = Map::new();
    {
        let ph: Vec<String> = (1..=codes.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT metric_code, unit FROM metrics_catalog WHERE metric_code IN ({})",
            ph.join(",")
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&str> = codes.iter().map(|s| s.as_str()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (code, unit) = row.map_err(|e| e.to_string())?;
            units.insert(code, Value::String(unit));
        }
    }

    // rows
    let n = codes.len();
    let mut ph: Vec<String> = (1..=n).map(|i| format!("?{i}")).collect();
    ph.push(format!("?{}", n + 1));
    ph.push(format!("?{}", n + 2));
    let fd_clause = if fd.is_some() {
        ph.push(format!("?{}", n + 3));
        " AND g.parent_id = ?".to_string()
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT rm.geo_id, rm.metric_code, rm.value, g.name, g.parent_id,
                (SELECT f.name FROM geography f WHERE f.geo_id = g.parent_id) AS fd_name
         FROM regional_metrics rm
         JOIN geography g ON g.geo_id = rm.geo_id
         WHERE rm.metric_code IN ({}) AND rm.period = ?{} AND rm.source_id = ?{}
           AND g.level = 'subject'{}
         ORDER BY g.name",
        ph[..n].join(","),
        n + 1,
        n + 2,
        fd_clause
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<String> = codes.clone();
    params.push(period.clone());
    params.push(src.clone());
    if let Some(f) = &fd {
        params.push(f.clone());
    }
    let refs: Vec<&str> = params.iter().map(|s| s.as_str()).collect();
    let rows = stmt
        .query_map(refs.as_slice(), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut by_geo: Map<String, Value> = Map::new();
    for row in rows {
        let (geo_id, metric_code, value, name, parent_id, fd_name) = row.map_err(|e| e.to_string())?;
        let entry = by_geo.entry(geo_id.clone()).or_insert_with(|| {
            json!({
                "geo_id": geo_id, "name": name, "parent_id": parent_id,
                "fd_name": fd_name, "values": {}, "units": units
            })
        });
        entry["values"][&metric_code] = json!(value);
    }

    let data = json!({
        "period": period,
        "rows": by_geo.values().collect::<Vec<_>>()
    });
    Ok(json!({
        "data": data,
        "meta": meta_envelope(conn, vec!["Сравнение территорий — констатация значений, не оценка и не причинность."])?
    }))
}

/// GET /api/v1/metrics/trust?geo=&code= — порт getTrustChain.
fn metrics_trust(conn: &Connection, query: &str) -> Result<Value, String> {
    let geo = qp(query, "geo").unwrap_or_default();
    let code = qp(query, "code").unwrap_or_default();
    let src = current_source_id(conn)?;

    let row = conn
        .query_row(
            "SELECT rm.period, rm.value, rm.data_mode, rm.updated_at,
                    g.name, c.name, c.unit, c.methodology
             FROM regional_metrics rm
             JOIN geography g ON g.geo_id = rm.geo_id
             JOIN metrics_catalog c ON c.metric_code = rm.metric_code
             WHERE rm.geo_id = ?1 AND rm.metric_code = ?2 AND rm.source_id = ?3
             ORDER BY rm.period DESC LIMIT 1",
            [&geo, &code, &src],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<f64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .ok();

    let data = match row {
        None => Value::Null,
        Some((period, value, data_mode, updated_at, geo_name, metric_name, unit, methodology)) => {
            let (grade, note) = source_grade(conn, &src)?;
            let (periods, first, last): (i64, Option<String>, Option<String>) = conn
                .query_row(
                    "SELECT COUNT(*), MIN(period), MAX(period) FROM regional_metrics
                     WHERE geo_id = ?1 AND metric_code = ?2 AND source_id = ?3",
                    [&geo, &code, &src],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(|e| e.to_string())?;
            let dm = data_mode.unwrap_or_else(|| "SYNTHETIC".to_string());
            let mut caveats: Vec<String> = Vec::new();
            if dm == "SYNTHETIC" {
                caveats.push(
                    "Значение СИНТЕТИЧЕСКОЕ (генератор тест-данных): не использовать для выводов о реальности."
                        .to_string(),
                );
            }
            caveats.push("Тренд — разность соседних лет, не причинно-следственная связь.".to_string());
            json!({
                "geo_id": geo,
                "geo_name": geo_name.unwrap_or_default(),
                "metric_code": code,
                "metric_name": metric_name.unwrap_or_default(),
                "unit": unit.unwrap_or_default(),
                "period": period.unwrap_or_default(),
                "value": value.unwrap_or(0.0),
                "data_mode": dm,
                "dataset": {
                    "table": "regional_metrics",
                    "row_key": format!("{geo}|{code}|{}|{src}", period.unwrap_or_default()),
                    "updated_at": updated_at
                },
                "source": source_json(conn, &src, grade, note)?,
                "methodology": methodology,
                "coverage": { "periods": periods, "first": first, "last": last },
                "caveats": caveats
            })
        }
    };
    Ok(json!({ "data": data, "meta": meta_envelope(conn, vec![])? }))
}

fn source_grade(conn: &Connection, src: &str) -> Result<(String, String), String> {
    let meta_raw: Option<String> = conn
        .query_row(
            "SELECT reliability_metadata FROM sources WHERE source_id = ?1",
            [src],
            |r| r.get(0),
        )
        .ok();
    match meta_raw {
        Some(raw) => {
            let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Ok((
                v["grade"].as_str().unwrap_or("—").to_string(),
                v["note"].as_str().unwrap_or("").to_string(),
            ))
        }
        None => Ok(("—".to_string(), String::new())),
    }
}

fn source_json(
    conn: &Connection,
    src: &str,
    grade: String,
    note: String,
) -> Result<Value, String> {
    let row = conn
        .query_row(
            "SELECT name, owner, url, license, collection_method, last_update, checksum
             FROM sources WHERE source_id = ?1",
            [src],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .ok();
    match row {
        Some((name, owner, url, license, collection_method, last_update, checksum)) => Ok(json!({
            "source_id": src,
            "name": name.unwrap_or_default(),
            "owner": owner,
            "url": url,
            "license": license,
            "collection_method": collection_method,
            "grade": grade,
            "note": note,
            "last_update": last_update,
            "checksum": checksum
        })),
        None => Ok(json!({
            "source_id": src, "name": "", "owner": null, "url": null, "license": null,
            "collection_method": null, "grade": grade, "note": note,
            "last_update": null, "checksum": null
        })),
    }
}

/// POST /api/v1/analyst/ask — desktop-профиль: FAQ по каноническим запросам
/// (полноценный askAnalyst выполнен при сборке), точное совпадение вопроса;
/// вне FAQ — честный fallback с инъекционным детектором.
fn analyst_ask(conn: &Connection, body: Option<&str>) -> Result<Value, String> {
    let question = body
        .and_then(|b| serde_json::from_str::<Value>(b).ok())
        .and_then(|v| v["question"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    // sanitize как sanitizeUserQuestion: управляющие, схлопывание, trim, ≤500.
    let mut sanitized = String::new();
    let mut last_space = true;
    for ch in question.chars() {
        if ch.is_control() {
            ch = ' ';
        }
        if ch.is_whitespace() {
            if !last_space {
                sanitized.push(' ');
                last_space = true;
            }
        } else {
            sanitized.push(ch);
            last_space = false;
        }
    }
    let sanitized = sanitized.trim().to_string();
    let truncated: String = sanitized.chars().take(500).collect();

    if let Some(v) = cache_get(conn, &format!("POST /api/v1/analyst/ask#{truncated}"))? {
        return Ok(v);
    }

    // Fallback: честный ответ вне канонического набора.
    let lower = truncated.to_lowercase();
    let mut injections: Vec<Value> = Vec::new();
    let patterns: [(&str, &str); 4] = [
        ("ignore_instructions_ru", "игнорир"),
        ("system_prompt_ru", "системн"),
        ("reveal_ru", "промпт"),
        ("forget_ru", "забудь"),
    ];
    for (id, marker) in patterns {
        if lower.contains(marker) {
            injections.push(json!({ "pattern_id": id, "excerpt": truncated }));
        }
    }
    let data = json!({
        "question": truncated,
        "intent": "overview",
        "provider_id": "local-deterministic",
        "provider_mode": "local-degraded",
        "blocks": [
            { "category": "ANALYSIS",
              "text": "Desktop-профиль (Этап 15): AI-аналитик отвечает по каноническим запросам — используйте чипы на экране («Сравни регионы», «Что изменилось?», «Какие темы выросли в медиа?», «Покажи источники», «Новые документы партии», «Исследование по…», «Смоделируй сценарий»). Произвольные вопросы обрабатываются серверным профилем (Fastify) или полным LLM-провайдером." }
        ],
        "evidence": [],
        "sources": [],
        "uncertainty": [
            "Ответ вне канонического набора desktop-профиля: точный расчёт требует серверного контура.",
            "Данные платформы — SYNTHETIC (grade D); не прогноз и не рекомендация."
        ],
        "tools_used": [],
        "injections_detected": injections
    });
    let warnings = vec![
        "Ответ аналитика: категории FACT / PARTY STATEMENT / ANALYSIS / MODEL разведены.",
        "Desktop-профиль: канонические запросы кэшированы при сборке; произвольные — fallback.",
    ];
    Ok(json!({ "data": data, "meta": meta_envelope(conn, warnings)? }))
}

/// POST /api/v1/analyst/verify — порт verifySources (REGISTRY/URL/CHECKSUM/LAST_UPDATE).
fn analyst_verify(conn: &Connection, body: Option<&str>) -> Result<Value, String> {
    let ids: Vec<String> = body
        .and_then(|b| serde_json::from_str::<Value>(b).ok())
        .and_then(|v| v["source_ids"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.chars().take(120).collect()))
                .filter(|s| !s.is_empty())
                .take(50)
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return Ok(err_json("source_ids обязателен (массив строк)"));
    }
    let mut items: Vec<Value> = Vec::new();
    let mut found = 0i64;
    let mut with_url = 0i64;
    let mut with_checksum = 0i64;
    for id in &ids {
        let row = conn
            .query_row(
                "SELECT name, url, checksum, status, last_update, reliability_metadata
                 FROM sources WHERE source_id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .ok();
        match row {
            None => items.push(json!({
                "source_id": id, "found": false, "name": Value::Null,
                "checks": [{ "check": "REGISTRY", "result": "NOT_FOUND",
                             "detail": "Источника нет в Source Registry." }]
            })),
            Some((name, url, checksum, status, last_update, rel)) => {
                let mut grade: Option<String> = None;
                if let Some(raw) = rel {
                    if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                        grade = v["grade"].as_str().map(|s| s.to_string());
                    }
                }
                let mut checks: Vec<Value> = Vec::new();
                checks.push(json!({
                    "check": "REGISTRY", "result": "FOUND",
                    "detail": format!("статус {}{}", status.clone().unwrap_or_default(),
                        grade.clone().map(|g| format!(", grade {g}")).unwrap_or_default())
                }));
                match &url {
                    Some(u) => {
                        with_url += 1;
                        checks.push(json!({ "check": "URL", "result": "PRESENT", "detail": u }));
                    }
                    None => checks.push(json!({ "check": "URL", "result": "ABSENT",
                        "detail": "SYNTHETIC-источник без URL — пере-проверка невозможна." })),
                }
                match &checksum {
                    Some(c) => {
                        with_checksum += 1;
                        let short: String = c.chars().take(16).collect();
                        checks.push(json!({ "check": "CHECKSUM", "result": "PRESENT",
                            "detail": format!("checksum {short}…") }));
                    }
                    None => checks.push(json!({ "check": "CHECKSUM", "result": "ABSENT",
                        "detail": "Контрольная сумма не зафиксирована (fixture-режим)." })),
                }
                match &last_update {
                    Some(lu) => checks.push(json!({ "check": "LAST_UPDATE", "result": "PRESENT", "detail": lu })),
                    None => checks.push(json!({ "check": "LAST_UPDATE", "result": "INSUFFICIENT_DATA",
                        "detail": "Дата последнего обновления неизвестна." })),
                }
                found += 1;
                items.push(json!({ "source_id": id, "found": true, "name": name, "checks": checks }));
            }
        }
    }
    let data = json!({
        "items": items,
        "summary": {
            "total": ids.len(), "found": found,
            "with_url": with_url, "with_checksum": with_checksum
        },
        "note": "VERIFY SOURCES сверяет источники с Source Registry (наличие, URL, checksum, статус). В fixture/SYNTHETIC-режиме URL и checksum в основном отсутствуют — это честно отражается в отчёте, а не маскируется."
    });
    Ok(json!({
        "data": data,
        "meta": meta_envelope(conn, vec!["VERIFY SOURCES: сверка с Source Registry (URL, checksum, статус)."])?
    }))
}

/// POST /api/v1/alerts — acknowledge (порт acknowledgeAlert).
fn alert_acknowledge(conn: &Connection, body: Option<&str>) -> Result<Value, String> {
    let alert_id = body
        .and_then(|b| serde_json::from_str::<Value>(b).ok())
        .and_then(|v| v["alert_id"].as_str().map(|s| s.to_string()));
    let Some(alert_id) = alert_id else {
        return Ok(json!({ "ok": false, "error": "alert_id обязателен" }));
    };
    let built_at: String = conn
        .query_row(
            "SELECT value FROM build_info WHERE key = 'built_at'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_string());
    let n = conn
        .execute(
            "UPDATE alerts SET acknowledged_at = ?1 WHERE alert_id = ?2 AND acknowledged_at IS NULL",
            [&built_at, &alert_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "alert_id": alert_id, "acknowledged": n > 0 }))
}

/// Смоук-тест установленного приложения / собранных ресурсов:
/// `YABLOKO INTELLIGENCE.exe --smoke` → проверки БД и модели, код возврата 0/1.
pub fn smoke() -> i32 {
    let db_path = std::env::var("YABLOKO_DB").unwrap_or_else(|_| {
        let exe = std::env::current_exe().expect("exe");
        let dir = exe.parent().expect("exe dir");
        dir.join("resources").join("yabloko.db")
            .to_string_lossy()
            .into_owned()
    });
    let conn = match Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("SMOKE FAIL: db open ({db_path}): {e}");
            return 1;
        }
    };
    let checks: Vec<(&str, i64, bool)> = vec![
        (
            "api_cache",
            conn.query_row("SELECT COUNT(*) FROM api_cache", [], |r| r.get(0))
                .unwrap_or(0),
            true,
        ),
        (
            "geography",
            conn.query_row("SELECT COUNT(*) FROM geography", [], |r| r.get(0))
                .unwrap_or(0),
            true,
        ),
        (
            "sources",
            conn.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))
                .unwrap_or(0),
            true,
        ),
        (
            "regional_metrics",
            conn.query_row("SELECT COUNT(*) FROM regional_metrics", [], |r| r.get(0))
                .unwrap_or(0),
            true,
        ),
    ];
    let mut failed = false;
    for (name, count, min_required) in checks {
        let ok = !min_required || count > 0;
        println!("SMOKE {name}: {count} {}", if ok { "OK" } else { "FAIL" });
        failed |= !ok;
    }
    let cached: i64 = conn
        .query_row("SELECT COUNT(*) FROM api_cache", [], |r| r.get(0))
        .unwrap_or(0);
    if cached < 100 {
        println!("SMOKE api_cache too small: {cached} < 100 FAIL");
        failed = true;
    }
    // Живой расчёт модели на ресурсах установки.
    std::env::set_var("YABLOKO_RESOURCE_DIR", {
        let exe = std::env::current_exe().expect("exe");
        let dir = exe.parent().expect("exe dir");
        dir.join("resources")
            .to_string_lossy()
            .into_owned()
    });
    match compute::decision_compute(&conn, "template=tpl-poverty-support&years=3&geo=ru:country:ru") {
        Ok(v) => {
            let w = v["data"]["wording"].as_str().unwrap_or("");
            if w.contains("При предположениях") {
                println!("SMOKE decision_compute: OK");
            } else {
                println!("SMOKE decision_compute: wording FAIL");
                failed = true;
            }
        }
        Err(e) => {
            println!("SMOKE decision_compute: FAIL ({e})");
            failed = true;
        }
    }
    if failed {
        eprintln!("SMOKE FAIL");
        1
    } else {
        println!("SMOKE OK");
        0
    }
}
