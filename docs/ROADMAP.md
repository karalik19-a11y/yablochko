# ROADMAP — YABLOKO INTELLIGENCE

> Поэтапный план реализации (18 этапов мастер-плана). Каждый этап завершается
> рабочим состоянием приложения: tests ✅ lint ✅ build ✅ UI проверен ✅.
> Контекст среды разработки и принятые решения — см. `docs/PROJECT_AUDIT.md`
> и `docs/ARCHITECTURE.md`.

---

## Вехи (milestones)

| Веха | Этапы | Смысл | Состояние |
|---|---|---|---|
| **M0 Foundation** | 1–2 | Аудит + ядро Party Context + скелет монорепо | Этап 1 ✅, Этап 2 — следующий |
| **M1 Data Spine** | 3–5 | Источники, география, показатели территорий | — |
| **M2 Analytics Core** | 6–8 | Настроения, Position Matrix, выборы | — |
| **M3 Deep Modules** | 9–13 | Postmortem-2026, OSINT, медиа, Decision Lab, AI | — |
| **M4 Product Polish** | 14 | Премиум UX, целостность платформы | — |
| **M5 Desktop Delivery** | 15–16 | Tauri Windows, Setup.exe, автообновления | — |
| **M6 Hardening & Release** | 17–18 | Security audit, production audit, релиз | — |

---

## Правила работы по этапам (из мастер-плана, обязательны)

1. Перед этапом: изучить репозиторий, найти существующую архитектуру, определить затрагиваемые файлы.
2. После этапа: tests → lint → build → исправить ошибки → проверить UI → только затем следующий этап.
3. Не ломать работающий функционал; каждый этап оставляет приложение в рабочем состоянии.
4. Непреложные ограничения (нейтральность аналитики, запрет профилирования частных лиц,
   provenance, разделение категорий знания) действуют с первого этапа и в каждом этапе.

---

## Этап 1 — Audit ✅ (выполнен 2026-09-24)

**Цель:** зафиксировать исходное состояние и архитектурные решения.
**Результат:** `docs/PROJECT_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`;
вывод — greenfield; среда песочницы описана (сетевые ограничения → ADR-0001…0005).
**DoD:** ✅ выполнено (чек-лист в PROJECT_AUDIT §7).

---

## Этап 2 — Ядро YABLOKO Context (СЛЕДУЮЩИЙ)

**Цель:** Party Context Engine + фундамент монорепозитория.

**Объём:**
- Скелет монорепо (npm workspaces): `apps/web-dev`, `packages/{app,ui,api-contract,domain,data-access}`,
  `services/dev-api`; `.gitignore`; toolchain (TS, Vite, Vitest, ESLint+Prettier, CI-lite на тесты).
- Схема и миграции: `users/roles` (локальный профиль), `sources`, `documents`,
  `party_documents`, `party_positions`, `party_bodies/leaders/events`,
  `party_candidates`, `election_participation`, `audit_log`.
- Party Context Engine: сущности Party, PartyLeader, PartyBody, PartyDocument,
  PartyPosition, PartyEvent, PartyCandidate, ElectionParticipation; Party Position
  Registry с `date_from/date_to/source/current_status/confidence`; таймлайн-разрешение конфликтов.
- Seed: официальный контекст из мастер-промпта — импорт со статусом **UNVERIFIED**,
  каждая запись с датой и (пока отсутствующим) source-указанием; пометка
  `OFFICIAL PARTY STATEMENT` на всех партийных утверждениях.
- Автообновление контекста: каркас job-планировщика + коннектор-заглушка yabloko.ru
  (исполнение — при наличии сети: CI/локально).
- Первый экран приложения: каркас shell (навигация из 18 разделов, тёмная тема,
  OVERVIEW с блоком YABLOKO TODAY на seed-данных с бейджем DEMO/SYNTHETIC).

**DoD:** `npm test`, `npm run lint`, `npm run build` зелёные; dev-сервер поднимается,
экран OVERVIEW отдаёт данные из SQLite; каждая партийная запись имеет source+date+статус;
unit-тесты Registry (таймлайн-конфликты).

## Этап 3 — Источники России

**Цель:** Source Registry + ingestion architecture.
**Объём:** connector interface (fetch/parse/verify), реестр с метаданными (license,
update_frequency, checksum…), ingestion jobs + retry + логи + validation + dedup;
5–10 качественных источников (Росстат, ЦИК, официальный сайт партии, региональные
официальные, научные открытые датасеты). Исполнение коннекторов — CI (`ingest.yml`) и
локально; в песочнице — контрактные тесты на fixture-снимках.
**DoD:** pipeline DISCOVER→…→INDEX проходит на fixtures; retry/dedup покрыты тестами;
Alert SOURCE_FAILURE работает; ни одна запись без provenance.

## Этап 4 — Географическая база

**Цель:** полная иерархия РФ + карта.
**Объём:** `geography` (6 уровней, stable `ru:{level}:{code}`, `geo_merges`), seed
справочника (ФО→субъекты, ОКТМО-коды); TopoJSON-границы (страна/ФО/субъекты) в
`datasets/geo`; MapLibre офлайн-карта, слои-каркас, drill-down кликом, хлебные крошки.
**DoD:** клик по субъекту открывает Territory Profile (каркас); границы отображаются
без сети; тесты idempotency geo-идов; бюджет размера бандла границ соблюдён.

## Этап 5 — Population Intelligence

**Цель:** каркас территориальных показателей.
**Объём:** единый формат `regional_metrics` (value/trend/period/source/quality/confidence);
домены: population, age, sex, migration, birth, death, density, education, employment,
income, housing; seed-данные SYNTHETIC + импортёр Росстата (исполняется в CI);
экраны POPULATION/ECONOMY/SOCIETY с тайм-сериями (ECharts) и таблицами (virtualized).
**DoD:** территориальный профиль (на примере СПб) показывает разделы DEMOGRAPHICS…HOUSING
с provenance-бейджами; «Why should I trust this?» открывает цепочку evidence.

## Этап 6 — Civic Intelligence

**Цель:** агрегированные настроения.
**Объём:** справочник тем; sentiment pipeline (aggregate-only) с PII scrubber;
хранение только агрегатов + k-анонимность; экран CIVIC TRENDS: распределение
Positive/Neutral/Negative/Mixed/Unclear, sample size, INSUFFICIENT DATA при малых n.
**DoD:** тест PII scrubber (фикстуры с PII не попадают в хранилище); агрегаты
корректны; запрет персональных записей закреплён тестом схемы.

## Этап 7 — YABLOKO Position Matrix

**Цель:** позиция партии ↔ общественное мнение.
**Объём:** матрица: строки — вопросы, колонки — Yabloko Position / Public Opinion /
Regional Data / Trend / Evidence / Uncertainty; тайм-шкала позиций; явное отображение
OVERLAP/DIVERGENCE/UNCERTAINTY; формулировки «наблюдается/не наблюдается статистическое
совпадение…»; никаких политических рекомендаций.
**DoD:** экран YABLOKO POSITION на seed-данных с полным provenance; тесты на смешение
категорий (позиция ≠ мнение) отсутствуют в коде.

## Этап 8 — Election Intelligence

**Цель:** база выборов.
**Объём:** elections/districts/candidates/results/turnout с official_source; импорт
исторических Госдума/региональные/муниципальные ( fixtures + CI-импортёр ЦИК); экраны
ELECTIONS, Yabloko Elections, Yabloko Candidates, Yabloko Historical Results, Regional
Election History.
**DoD:** корректность сумм/процентов покрыта тестами; каждый результат ссылается на
официальный источник; нет персональных предсказаний.

## Этап 9 — Post-Election 2026

**Цель:** Election Postmortem.
**Объём:** авто-сборка postmortem: результаты, динамика vs прошлые выборы, территория,
кандидаты, явка, заявления партии, СМИ, наблюдатели, суды, DATA QUALITY; четыре
несмешиваемых блока OFFICIAL RESULT / PARTY INTERPRETATION / INDEPENDENT ANALYSIS /
MODEL INFERENCE; авто-переключение режима после завершения выборов.
**DoD:** генерация postmortem на fixture-выборах; UI-тест разделения блоков.

## Этап 10 — OSINT

**Цель:** граф публичных сущностей.
**Объём:** public_entities (публичные фигуры, организации, компании, СМИ), events,
documents, statements; граф с evidence-edges (works_at/member_of/spoke_at/published/
mentioned/associated_with/participated_in); timeline; source graph; поиск.
**DoD:** рёбра без evidence невозможны (схема+тесты); приватные лица не вносятся
(тест-стражи); профиль фигуры по разделам IDENTITY…SOURCES.

## Этап 11 — Media Intelligence

**Цель:** мониторинг СМИ + Yabloko Media Monitor.
**Объём:** модель публикации (издание, дата, автор, тема, сущности, sentiment с
методологией, claims, упоминания «Яблока»); экраны MENTIONS/TOPICS/SHARE/TREND/
SOURCES/CONTEXT; «Show original sources»; запрет ярлыков без методологии.
**DoD:** дашборд на seed-публикациях; тест на наличие методологической сноски у sentiment.

## Этап 12 — Decision Lab / ALADDIN

**Цель:** scenario engine.
**Объём:** интерактивный интерфейс POLICY→ASSUMPTIONS→MODEL→DIRECT/INDIRECT/
SECOND-ORDER→UNCERTAINTY→EVIDENCE; baseline/counterfactual/sensitivity/historical
analogue; пересчёт графиков при смене параметра; объяснение каждого результата;
Yabloko Policy Lab на позициях из Registry; сравнение сценариев.
**DoD:** сценарий на fixture-данных: диапазоны p10/p50/p90, перечисление предположений;
каузальные формулировки без методологии отсутствуют (линтер текстов шаблонов + ревью).

## Этап 13 — AI Analyst

**Цель:** YABLOKO ANALYST AI.
**Объём:** provider abstraction (openai-compatible/anthropic/local), инструменты
только для чтения; ответы ANSWER/EVIDENCE/SOURCES/UNCERTAINTY; запросы «сравни
регионы/что изменилось/какие темы выросли/покажи источники/новые документы/исследования
по X/смоделируй»; кнопка VERIFY SOURCES; prompt-injection defense (изоляция внешнего
контента как данных).
**DoD:** тест-набор adversarial-промптов (инъекции из «документов» не выполняются);
ответ всегда с источниками; без ключа провайдера — graceful degraded mode.

## Этап 14 — Beautiful UX

**Цель:** премиум-UI без изменения backend-логики.
**Объём:** дизайн-система (токены, dark/light, стеклянные панели, акценты), анимации
и transitions, command palette Ctrl+K, keyboard navigation, responsive desktop layout,
loading/empty/error/INSUFFICIENT DATA состояния, цельность всех экранов.
**DoD:** визуальный чек-лист по каждому экрану; палитра команд выполняет все команды
мастер-промпта; переключение тем без перезагрузки; CI-скриншот-тесты ключевых экранов.

## Этап 15 — Windows Desktop (Tauri 2)

**Цель:** Setup.exe.
**Объём:** `apps/desktop` (Tauri 2, Rust-ядро `core-rs`: IPC-роутер, rusqlite, duckdb),
бандлинг фронтенда, NSIS/MSI, ярлыки Start Menu/Desktop, uninstaller; сборка в GitHub
Actions (полный тулчейн); смоук-тесты артефакта.
**DoD:** CI-сборка `YABLOKO_INTELLIGENCE_Setup.exe`; установка на чистую Windows без
Python/Node/Rust/Git/Docker; запуск, базовый сценарий анализа — работают.

## Этап 16 — GitHub Updates

**Цель:** автообновления.
**Объём:** release.yml (tag `vX.Y.Z` → test→lint→build→sign→installer→updater
artifacts→GitHub Release); latest.json + подпись; Settings→Updates (версии, changelog,
размер; CHECK/INSTALL); проверка подписи, отказ unsigned; rollback.
**DoD:** релиз по тегу собирается автоматически; обновление ставится и откатывается;
неподписанный артефакт отклоняется (тест).

## Этап 17 — Security

**Цель:** penetration-oriented audit.
**Объём:** проверка всех пунктов threat model (§9.2 ARCHITECTURE): SQLi, XSS, SSRF,
CSRF, path traversal, command injection, malicious documents, prompt injection,
dataset poisoning, deps, secrets, PII, unauthorized API, updates; исправление всех
critical/high.
**DoD:** отчёт docs/SECURITY_AUDIT.md; gitleaks+audit в CI; adversarial-набор тестов
зелёный; high/critical = 0.

## Этап 18 — Final Production Audit

**Цель:** приёмка.
**Объём:** чек-лист BUILD/DATABASE/API/UI/MAPS/ANALYTICS/OSINT/AI/DECISION LAB/
ELECTIONS/SOURCES/UPDATES/WINDOWS INSTALLER/SECURITY; чистая Windows VM: install →
launch → login → analysis → export → update → uninstall; финальная сборка
`YABLOKO_INTELLIGENCE_Setup.exe`.
**DoD:** docs/PRODUCTION_AUDIT.md с результатами; все проверки зелёные.

---

## Текущий статус

| Этап | Статус |
|---|---|
| 1. Audit | ✅ завершён (2026-09-24) |
| 2. YABLOKO Context | ⏭ следующий |
| 3–18 | — запланированы |
