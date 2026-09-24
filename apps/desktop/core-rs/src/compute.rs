//! Детерминированный Монте-Карло Decision Lab — точный порт
//! `packages/data-access/src/repositories/simulation.ts` (Этап 12).
//! Формулировки результата — только «при предположениях… модель оценивает
//! диапазон»; не прогноз, не причинность, не рекомендация.
//!
//! Golden-тесты (`#[cfg(test)]`) сверяются со значениями, рассчитанными
//! TypeScript-реализацией при сборке (см. scripts/build-desktop-resources.ts).

use rusqlite::Connection;
use serde_json::{json, Map, Value};

use crate::router::{meta_envelope, qp};

/// TS `charCodeAt` — UTF-16 code units (кириллица в seed-строках).
fn hash32(s: &str) -> u32 {
    let mut h: u32 = 5381;
    for u in s.encode_utf16() {
        h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(u32::from(u));
    }
    h
}

/// Точная копия TS-генератора mulberry32 из simulation.ts.
fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut a: u32 = seed;
    move || {
        a = a.wrapping_add(0x6d2b79f5);
        let mut t: u32 = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        f64::from(t ^ (t >> 14)) / 4294967296.0
    }
}

/// Число в JSON-текст так, как это делает JSON.stringify (целые без точки).
fn json_num(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        let s = format!("{v}");
        s
    }
}

/// Строка значений параметров в порядке шаблона — как JSON.stringify в TS
/// (вставка в порядке template.parameters).
fn parameter_json(params: &[Value], values: &Map<String, Value>) -> String {
    let mut s = String::from("{");
    let mut first = true;
    for p in params {
        if !first {
            s.push(',');
        }
        first = false;
        let key = p["key"].as_str().unwrap_or("x");
        let val = values.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
        s.push_str(&format!("\"{}\":{}", key, json_num(val)));
    }
    s.push('}');
    s
}

fn fmt_ru(v: Option<f64>) -> String {
    match v {
        None => "—".to_string(),
        Some(v) => {
            if v.abs() >= 1000.0 {
                // TS: Math.round(v).toLocaleString('ru-RU') → пробел-разделитель тысяч
                let rounded = v.round() as i64;
                let s = rounded.abs().to_string();
                let mut out = String::new();
                let bytes = s.as_bytes();
                for (i, ch) in s.chars().enumerate() {
                    if i > 0 && (bytes.len() - i) % 3 == 0 {
                        out.push('\u{00a0}');
                    }
                    out.push(ch);
                }
                if rounded < 0 {
                    format!("-{out}")
                } else {
                    out
                }
            } else {
                format!("{v:.2}")
            }
        }
    }
}

fn baseline_for(conn: &Connection, geo: &str, metric: &str) -> Option<f64> {
    conn.query_row(
        "SELECT value FROM regional_metrics rm
         JOIN metrics_catalog mc ON mc.metric_code = rm.metric_code
         WHERE rm.geo_id = ?1 AND rm.metric_code = ?2 ORDER BY rm.period DESC LIMIT 1",
        [geo, metric],
        |r| r.get::<_, f64>(0),
    )
    .ok()
}

/// GET /api/v1/decision/compute?template=&years=&geo=&p_<key>=
pub fn decision_compute(conn: &Connection, query: &str) -> Result<Value, String> {
    let tpl_id = qp(query, "template").unwrap_or_default();
    let valid_id = !tpl_id.is_empty()
        && tpl_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid_id {
        return Ok(crate::router::err_json("Неизвестный маршрут API"));
    }

    // Полные шаблоны (с elasticity/indirect) — ресурс сборки.
    let tpl_path = crate::resource_path("scenario_templates.json");
    let raw = std::fs::read_to_string(&tpl_path)
        .map_err(|e| format!("templates read failed ({}): {e}", tpl_path.display()))?;
    let all: Value =
        serde_json::from_str(&raw).map_err(|e| format!("templates parse failed: {e}"))?;
    let tpl = all["templates"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|t| t["template_id"].as_str() == Some(tpl_id.as_str()))
                .cloned()
        })
        .ok_or_else(|| "template not found".to_string())?;

    let years_raw = qp(query, "years")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(3.0);
    let years = if years_raw.is_finite() {
        (years_raw.round() as i64).clamp(1, 30)
    } else {
        3
    };

    let geo_default = "ru:country:ru".to_string();
    let geo = qp(query, "geo")
        .filter(|g| {
            let ok_prefix = g.starts_with("ru:") && g.len() <= 80;
            ok_prefix && g[3..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':' || c == '-')
        })
        .unwrap_or(geo_default);

    let seed_key = format!("{tpl_id}|{geo}");

    // Параметры: clamp в диапазон шаблона.
    let params = tpl["parameters"].as_array().cloned().unwrap_or_default();
    let mut values: Map<String, Value> = Map::new();
    for p in &params {
        let key = p["key"].as_str().unwrap_or("x");
        let min = p["min"].as_f64().unwrap_or(0.0);
        let max = p["max"].as_f64().unwrap_or(100.0);
        let def = p["default"].as_f64().unwrap_or(0.0);
        let raw = qp(query, &format!("p_{key}")).and_then(|s| s.parse::<f64>().ok());
        let v = match raw {
            // TS: Math.min(Math.max(raw, p.min), p.max)
            Some(r) if r.is_finite() => r.clamp(min, max),
            _ => def,
        };
        values.insert(key.to_string(), json!(v));
    }

    let seed = hash32(&format!("{seed_key}|{}|{years}", parameter_json(&params, &values)));
    let mut rnd = mulberry32(seed);
    let drift = 0.04f64;

    let main = params.first().cloned().unwrap_or(Value::Null);
    let main_key = main["key"].as_str().unwrap_or("x").to_string();
    let main_val = values
        .get(&main_key)
        .and_then(|v| v.as_f64())
        .or_else(|| main["default"].as_f64())
        .unwrap_or(0.0);
    let main_min = main["min"].as_f64().unwrap_or(0.0);
    let main_max = main["max"].as_f64().unwrap_or(100.0);
    let main_def = main["default"].as_f64().unwrap_or(0.0);
    let span = if main_max != main_min { main_max - main_min } else { 1.0 };
    let x_norm = (main_val - main_def) / span;

    let elasticity = tpl["elasticity"].as_f64().unwrap_or(0.0);
    let target_metric = tpl["target_metric"].as_str().unwrap_or("").to_string();
    let main_label = main["label"].as_str().unwrap_or("").to_string();
    let main_unit = main["unit"].as_str().unwrap_or("").to_string();
    let assumptions: Vec<String> = tpl["assumptions"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| x.as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default();

    let n = 2000usize;
    let cum = years as f64 * 0.66;
    let growth = (1.0 + drift).powi(years as i32);

    let mut sample_effect = |base: Option<f64>,
                             el: f64,
                             label: String,
                             order: &str,
                             metric: String,
                             unit: String|
     -> Value {
        match base {
            None => json!({
                "metric": metric, "order": order, "baseline_value": Value::Null,
                "p10": Value::Null, "p50": Value::Null, "p90": Value::Null,
                "unit": unit, "explanation": label
            }),
            Some(b) => {
                let mut samples: Vec<f64> = Vec::with_capacity(n);
                for _ in 0..n {
                    let noise = 1.0 + (rnd() - 0.5) * 0.6;
                    samples.push(b * growth * (1.0 + el * x_norm * cum * noise));
                }
                samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let pick = |q: f64| -> f64 {
                    let idx = ((q * n as f64).floor() as usize).clamp(0, n - 1);
                    samples[idx]
                };
                json!({
                    "metric": metric, "order": order, "baseline_value": b,
                    "p10": pick(0.1), "p50": pick(0.5), "p90": pick(0.9),
                    "unit": unit, "explanation": label
                })
            }
        }
    };

    let mut effects: Vec<Value> = Vec::new();

    // DIRECT
    let base_target = baseline_for(conn, &geo, &target_metric);
    effects.push(sample_effect(
        base_target,
        elasticity * 2.0,
        format!(
            "Модельная оценка целевого показателя при параметре «{main_label}» = {}{main_unit} (отклонение от базового {})",
            json_num(main_val),
            json_num(main_def)
        ),
        "direct",
        target_metric.clone(),
        String::new(),
    ));

    // INDIRECT
    let indirect = tpl["indirect"].as_array().cloned().unwrap_or_default();
    for ind in &indirect {
        let metric = ind["metric"].as_str().unwrap_or("").to_string();
        let coeff = ind["coefficient"].as_f64().unwrap_or(0.0);
        effects.push(sample_effect(
            baseline_for(conn, &geo, &metric),
            elasticity * 2.0 * coeff,
            format!("Косвенный эффект через связь с целевым показателем (коэффициент {coeff})"),
            "indirect",
            metric.clone(),
            String::new(),
        ));
    }

    // SECOND-ORDER: полу-сумма косвенных на последнюю метрику.
    if effects.len() >= 3 {
        if let Some(last) = indirect.last() {
            let metric = last["metric"].as_str().unwrap_or("").to_string();
            let coeff = last["coefficient"].as_f64().unwrap_or(0.0);
            effects.push(sample_effect(
                baseline_for(conn, &geo, &metric),
                elasticity * 2.0 * coeff * 0.25,
                "Эффект второго порядка: затухающее влияние через косвенный канал (коэффициент 0.25)".to_string(),
                "second_order",
                format!("{metric} (2-й порядок)"),
                String::new(),
            ));
        }
    }

    // SENSITIVITY: p50 при min/max каждого параметра (без шума).
    let base0 = effects[0]["baseline_value"].as_f64().unwrap_or(0.0);
    let sensitivity: Vec<Value> = params
        .iter()
        .map(|p| {
            let key = p["key"].as_str().unwrap_or("x");
            let min = p["min"].as_f64().unwrap_or(0.0);
            let max = p["max"].as_f64().unwrap_or(100.0);
            let def = p["default"].as_f64().unwrap_or(0.0);
            let span_p = if max != min { max - min } else { 1.0 };
            let at = |value: f64| -> f64 {
                let xn = (value - def) / span_p;
                base0 * growth * (1.0 + elasticity * 2.0 * xn * years as f64 * 0.66)
            };
            json!({
                "parameter": key,
                "label": p["label"].as_str().unwrap_or(""),
                "low": min,
                "high": max,
                "p50_at_min": at(min),
                "p50_at_max": at(max),
                "unit": p["unit"].as_str().unwrap_or("")
            })
        })
        .collect();

    let first = &effects[0];
    let wording = format!(
        "При предположениях ({}) модель оценивает диапазон изменения «{}» за {} г.: {} Это модельная оценка диапазонов по эластичностям, не прогноз, не причинность и не рекомендация.",
        assumptions.join("; "),
        target_metric,
        years,
        if first["p10"].is_null() || first["p90"].is_null() {
            "данных базовой линии нет — INSUFFICIENT DATA. ".to_string()
        } else {
            format!(
                "p10={} … p50={} … p90={}. ",
                fmt_ru(first["p10"].as_f64()),
                fmt_ru(first["p50"].as_f64()),
                fmt_ru(first["p90"].as_f64())
            )
        }
    );

    let methodology = format!(
        "Методология: исторический аналог — {} ({}); эластичность цели по параметру с доверительным интервалом (шум ±30%); детерминированный Монте-Карло (2000 прогонов, seed={seed}); горизонт {years} г. с насыщением (Σ√k); p10/p50/p90 — перцентили прогонов. SYNTHETIC-базовые линии (grade D). Формулировка: только «при предположениях A/B/C модель оценивает диапазон X–Y».",
        tpl["analogue"]["label"].as_str().unwrap_or(""),
        tpl["analogue"]["period"].as_str().unwrap_or("")
    );

    let data = json!({
        "kind": "counterfactual",
        "target_metric": target_metric,
        "horizon_years": years,
        "effects": effects,
        "sensitivity": sensitivity,
        "assumptions": assumptions,
        "methodology": methodology,
        "wording": wording,
        "model_note": "SYNTHETIC-базовые линии (grade D)."
    });
    let warnings = vec![
        "Модельная оценка диапазонов (SYNTHETIC-эластичности): не прогноз, не причинность, не рекомендация.",
        "Формулировка результата — только «при предположениях… модель оценивает диапазон…».",
    ];
    Ok(json!({ "data": data, "meta": meta_envelope(conn, warnings)? }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden: значения рассчитаны TypeScript-реализацией (Этап 12) при тех же
    /// seed-строках; любое расхождение = нарушение детерминизма порта.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("db");
        conn.execute_batch(
            "CREATE TABLE regional_metrics (geo_id TEXT, metric_code TEXT, period TEXT, value REAL);
             CREATE TABLE metrics_catalog (metric_code TEXT PRIMARY KEY);
             INSERT INTO metrics_catalog VALUES ('inc_poverty_share'), ('inc_per_capita_month'), ('med_life_expectancy');
             INSERT INTO regional_metrics VALUES
               ('ru:country:ru','inc_poverty_share','2025',13.337),
               ('ru:country:ru','inc_per_capita_month','2025',69847.716),
               ('ru:country:ru','med_life_expectancy','2025',72.829);",
        )
        .expect("schema");
        conn
    }

    fn templates_path() -> String {
        // CI/локально: репозиторий; в установленном приложении — ресурсы.
        std::env::var("YABLOKO_TEMPLATES").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../..", "/datasets/decision/scenario_templates.json").to_string()
        })
    }

    #[test]
    fn golden_case1_default_param_years3() {
        std::env::set_var("YABLOKO_TEMPLATES", templates_path());
        std::env::set_var("YABLOKO_DB_TEST", "1");
        let conn = test_db();
        let v = decision_compute(&conn, "template=tpl-poverty-support&years=3&geo=ru:country:ru").expect("compute");
        let eff = &v["data"]["effects"][0];
        // xNorm = 0 → шум не влияет: все прогоны равны.
        assert_eq!(eff["p10"].as_f64().unwrap(), 15.002311168);
        assert_eq!(eff["p50"].as_f64().unwrap(), 15.002311168);
        assert_eq!(eff["p90"].as_f64().unwrap(), 15.002311168);
        let sens = &v["data"]["sensitivity"][0];
        assert_eq!(sens["p50_at_min"].as_f64().unwrap(), 17.3786772570112);
        assert_eq!(sens["p50_at_max"].as_f64().unwrap(), 12.625945078988801);
        assert!(v["data"]["wording"].as_str().unwrap().contains("При предположениях"));
    }

    #[test]
    fn golden_case2_param80_years5() {
        std::env::set_var("YABLOKO_TEMPLATES", templates_path());
        let conn = test_db();
        let v = decision_compute(
            &conn,
            "template=tpl-poverty-support&years=5&geo=ru:country:ru&p_support_intensity=80",
        )
        .expect("compute");
        let eff = &v["data"]["effects"][0];
        let p10 = eff["p10"].as_f64().unwrap();
        let p50 = eff["p50"].as_f64().unwrap();
        let p90 = eff["p90"].as_f64().unwrap();
        assert_eq!(p10, 13.069642961999499);
        assert_eq!(p50, 13.66465918586519);
        assert_eq!(p90, 14.290826441872973);
        assert!(p10 <= p50 && p50 <= p90);
    }

    #[test]
    fn unknown_template_is_404_envelope() {
        std::env::set_var("YABLOKO_TEMPLATES", templates_path());
        let conn = test_db();
        let v = decision_compute(&conn, "template=nope").expect("compute");
        assert!(v.get("error").is_some());
    }

    #[test]
    fn hash32_matches_ts_djb2() {
        // TS: hash32('tpl-poverty-support|ru:country:ru|{"support_intensity":50}|3')
        let s = "tpl-poverty-support|ru:country:ru|{\"support_intensity\":50}|3";
        // Значение рассчитано в Node: 5381-джб по UTF-16 кодам.
        assert_eq!(hash32(s), 2223884864u32);
    }
}
