# ARCHITECTURE — YABLOKO INTELLIGENCE

> Целевая архитектура системы. Создана на Этапе 1; развивается через ADR.
> Принцип изменений: любое архитектурное изменение оформляется новым ADR,
> предыдущие ADR не переписываются задним числом.

---

## 1. Назначение системы

YABLOKO INTELLIGENCE — профессиональная аналитическая desktop-платформа класса
Party Intelligence / Public Data Intelligence. Объект анализа — **территории
и публичные агрегаты** (демография, экономика, выборы, настроения, медиа, публичные
персоны и организации), а не частные лица.

Три столпа архитектуры:

1. **Evidence-first.** Любая цифра в UI прослеживается до исходного документа:
   `CLAIM → MODEL/TRANSFORMATION → DATASET → SOURCE → ORIGINAL DOCUMENT`.
2. **Гигиена знания.** Каждое утверждение помечено категорией: `FACT / DATA /
   ANALYSIS / INFERENCE / MODEL / OFFICIAL PARTY STATEMENT / UNCERTAINTY`.
   Смешение категорий в UI запрещено.
3. **Приватность по построению.** Система не хранит и не создаёт профилей частных
   лиц по политическим признакам (см. §9). Это архитектурное ограничение, а не
   рекомендация.

---

## 2. Профили развёртывания

### ADR-0001. Два профиля хранения

| Слой | **Desktop / Dev-профиль** (встраиваемые движки) | **Server-профиль** (дата-центр партии) |
|---|---|---|
| Транзакционные данные (users, roles, sources, documents, party_positions, elections, research…) | SQLite (`node:sqlite` в dev, `rusqlite` в Rust-ядре) | PostgreSQL |
| Аналитические данные (региональные метрики, тайм-серии, sentiment, media, observations) | DuckDB (columnar, npm-биндинг в dev, `duckdb` crate в desktop) | ClickHouse |
| Полнотекстовый поиск | SQLite FTS5 + MiniSearch | OpenSearch |
| Кэш/очереди | in-process cache + очередь задач в SQLite | Valkey / Redis / NATS |
| Объектное хранилище (raw snapshots, документы, артефакты моделей, экспорт) | локальная папка app-data (_layout: как S3-префиксы) | S3-совместимое хранилище |
| API-слой | Tauri IPC → Rust-ядро (desktop) / Fastify Node-адаптер (dev) | Axum (Rust), тот же контракт |

Логическая схема данных **едина** для обоих профилей (§5). Репликация/синхронизация
desktop ↔ server — через пакеты датасетов (snapshots) с контрольными суммами.

### ADR-0002. API-contract-first

Единственный источник истины по API — типизированный контракт (`packages/api-contract`,
zod-схемы + генерируемые TS-типы + OpenAPI). Три транспорта реализуют один контракт:

- **dev:** HTTP (Fastify, Node 22) — для браузерной разработки и live preview;
- **desktop:** Tauri 2 IPC → Rust-команды;
- **server:** HTTP (Axum) — многопользовательский режим.

Интеграционные тесты контракта запускаются против dev-адаптера в песочнице и против
Rust/Axum в CI. Это позволяет разрабатывать всю бизнес-логику на TypeScript сейчас,
не теряя целевой Rust-стек.

### ADR-0004. Порядок разработки

TypeScript-first в песочнице (npm — единственный канал поставки). Rust-ядро
(`core-rs/`) появляется инкрементально, компилируется и тестируется **только в
GitHub Actions** до появления среды с cargo. UI не зависит от транспорта.

---

## 3. Высокоуровневая схема

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                        DESKTOP (Tauri 2, Windows)                        │
│  ┌────────────────────────────┐      ┌────────────────────────────────┐  │
│  │  React UI (packages/app)   │ IPC  │        Rust core (core-rs)     │  │
│  │  ECharts · MapLibre ·      │◄────►│  command router · authz ·      │  │
│  │  virtualized tables ·      │      │  sqlite(rusqlite) · duckdb ·   │  │
│  │  command palette           │      │  fts5 · job queue · updater    │  │
│  └────────────────────────────┘      └───────────────┬────────────────┘  │
│                                                      │                   │
│                                     local app-data: sqlite.duckdb,   │
│                                     objects/ (raw snapshots, docs),  │
│                                     geo/ (bundled boundaries)        │
└──────────────────────────────────────────────────────────────────────────┘
                 ▲ install/update                     ▲ ingestion (по расписанию/вручную)
                 │ подписанные релизы                 │ коннекторы Source Registry
        GitHub Releases                       официальный интернет (CI / локально у партии)

┌──────────────────────────────────────────────────────────────────────────┐
│                     SERVER-ПРОФИЛЬ (опция, дата-центр)                   │
│  Axum API ── PostgreSQL · ClickHouse · OpenSearch · Valkey · S3          │
│  multi-user RBAC · scheduled ingestion · Daily Intelligence pipeline     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    DEV-ПРОФИЛЬ (песочница, live preview)                 │
│  Vite + React (браузер) ──HTTP── Fastify (Node 22)                       │
│  node:sqlite · duckdb(npm) · minisearch · in-mem cache · fs objects/     │
└──────────────────────────────────────────────────────────────────────────┘
```

Сквозные подсистемы (во всех профилях):

```text
Source Registry ──► INGESTION (DISCOVER→FETCH→VERIFY→PARSE→CLASSIFY→
                    EXTRACT→VERSION→STORE→INDEX) ──► ХРАНИЛИЩА ──► ANALYTICS
                                                                    │
AI Copilot ◄── Evidence Graph ◄── DATA QUALITY ◄── ALERT CENTER ◄───┘
```

---

## 4. Структура монорепозитория

```text
yablochko/
├─ apps/
│  ├─ desktop/            # Tauri 2: конфиг, иконки, updater, подпись (этап 15)
│  └─ web-dev/            # Vite-хост для браузерной разработки и preview
├─ packages/
│  ├─ app/                # React-приложение: экраны, навигация, палитра команд
│  ├─ ui/                 # дизайн-система: токены, темы dark/light, компоненты
│  ├─ api-contract/       # zod-схемы + TS-типы + OpenAPI; единый контракт
│  ├─ domain/             # сущности и правила (Party, Territory, Election, Claim…)
│  ├─ data-access/        # адаптеры хранилищ: sqlite, duckdb, fts, objects
│  ├─ ingest/             # коннекторы, pipeline, retry, checksum, dedup
│  ├─ analytics/          # метрики, тайм-серии, sentiment, election stats, модели
│  └─ copilot/            # AI-абстракция провайдеров, guardrails, VERIFY SOURCES
├─ services/
│  └─ dev-api/            # Fastify-адаптер контракта (dev/песочница)
├─ core-rs/               # Rust workspace: tauri-команды, rusqlite, duckdb, axum (CI)
├─ datasets/              # версионированные seed-датасеты и geo-границы (в комплекте)
├─ docs/                  # PROJECT_AUDIT, ARCHITECTURE, ROADMAP, ADR
├─ .github/workflows/     # ci.yml, release.yml, ingest.yml (этапы 3, 15, 16)
├─ package.json           # npm workspaces
└─ README.md
```

Правило: `packages/*` не знают о транспорте; `apps/*` и `services/*` только собирают
адаптеры; `datasets/` — данные с манифестами provenance, никогда не код.

---

## 5. Модель данных

Нейминг сущностей единый; ниже — логические группы и ключевые поля (полный DDL —
миграции `packages/data-access/migrations/`, создаётся с этапа 2).

### 5.1 Транзакционное ядро (SQLite / PostgreSQL)

| Таблица | Ключевые поля |
|---|---|
| `users, roles, permissions, user_roles` | id, login, password_hash(argon2), role, scope (desktop: локальный профиль) |
| `sources` | source_id, name, owner, url, source_type, license, collection_method, coverage, period, update_frequency, reliability_metadata, last_update, checksum |
| `documents` | doc_id, source_id, url, fetched_at, content_hash, mime, raw_object_ref, status(NEW/VERIFIED/REJECTED) |
| `party_documents` | doc_id, doc_type(программа/заявление/решение ФПК/Бюро/пресс-релиз…), title, date, issuer, source_id, object_ref |
| `party_positions` | position_id, topic, exact_position, date_from, date_to, source_id, party_document_id, confidence, current_status(CURRENT/SUPERSEDED/EXPIRED/UNVERIFIED) |
| `party_bodies, party_leaders, party_events` | персона/орган/событие + периоды полномочий + source_id |
| `party_candidates, election_participation` | кандидат, округ, статус регистрации, связь с выборами |
| `geography` | geo_id (stable, §6), level, parent_id, name, official_codes(ОКТМО/ОКАТО/ИСО), population_ref |
| `public_entities` | person/organization/company/media: идентичность, публичные роли |
| `organizations, events` | тип, описание, связи (только публичные факты) |
| `elections, districts, candidates, results, turnout` | election_id, date, level, region, district, candidate_id, party_id, votes, percent, official_source_id |
| `claims` | claim_id, text, entity, date, source_id, category(FACT/STATEMENT/ANALYSIS/MODEL), confidence |
| `research, research_items, scenarios` | рабочие пространства, объекты (графики/карты/заметки), сценарии Decision Lab |
| `alerts` | type, severity, payload, created_at, acknowledged |
| `audit_log, access_log` | кто/что/когда, без PII субъектов данных |

### 5.2 Аналитическое хранилище (DuckDB / ClickHouse)

| Таблица | Назначение |
|---|---|
| `regional_metrics` | geo_id, metric_code, period, value, unit, source_id, quality, methodology_ref — единый формат всех территориальных показателей |
| `time_series` | (metric_code, geo_id, period) → value; materialized aggregates |
| `demographics, economics` | детализация regional_metrics по доменам |
| `polling` | опросы: pollster, date, question, sample, methodology, result (только агрегаты) |
| `sentiment, topics` | агрегаты: geo_id, topic, period, n_messages, pos/neu/neg/mixed/unclear, method_ref — **без сообщений с PII** |
| `media_mentions` | publication, date, title_ref, topic, entities, sentiment_method, yabloko_related |
| `election_observations` | наблюдательские сводки (публичные), связка с выбором |
| `model_outputs` | scenario_id, run_id, assumptions_hash, indicator, quantiles(p10/p50/p90), method_ref |
| `data_quality` | покрытие/свежесть/аномалии по geo_id × metric_code |

Правило производительности: UI никогда не получает сырые таблицы — только агрегаты
из `time_series`/materialized views, server-side filtering, keyset pagination,
virtualization на клиенте (бюджеты §10).

### 5.3 Поиск и объекты

- **FTS:** документы, партии-документы, OSINT-профили, публикации СМИ. Server: OpenSearch
  индексы с теми же полями; dev/desktop: SQLite FTS5 + MiniSearch поверх ранжирования.
- **Object store:** `objects/{sha256[:2]}/{sha256}` — content-addressable: raw snapshots,
  оригиналы документов, артефакты моделей, экспорты. Неизменяемость + дедупликация бесплатно.

---

## 6. Геомодель

- **Иерархия:** Россия → федеральный округ → субъект РФ → муниципальное образование →
  город/поселение → район. Каждый уровень — отдельный `level` с parent_id.
- **Stable IDs (ADR-geo):** внутренний `geo_id = ru:{level}:{code}`, где `code` —
  официальный код (ОКТМО/ОКАТО/ИСО 3166-2:RU) при наличии, иначе детерминированный
  slug. Переименования территорий не меняют geo_id; слияния создают новый id и
  запись маппинга (`geo_merges`).
- **Границы:** офлайн TopoJSON по уровням (страна/ФО/субъекты — в комплекте;
  муниципальный уровень — загружаемые пакеты по мере ingestion). Упрощение по
  topojson-simplify; целевой бюджет: субъекты ≤ 2 МБ суммарно.
- **Карта:** MapLibre GL, локальные GeoJSON-источники; слои-переключатели:
  Population, Income, Employment, Education, Healthcare, Ecology, Election Results,
  Yabloko Election History, Public Issues, Issue Trends, Media Attention, Survey Data,
  Data Quality, Yabloko Organizational Activity. **Каждый слой имеет собственную
  методологию** (панель «Методология слоя»), никакого универсального
  «popularity score».
- Drill-down: клик по региону открывает Territory Profile; хлебные крошки уровней.

---

## 7. Ключевые движки

### 7.1 Source Registry + Ingestion

- Реестр источников с полным метаданным (см. §5.1 `sources`); приоритизация типов:
  госисточники → ЦИК → Росстат → региональные/муниципальные → официальные документы →
  научные датасеты → проверяемые опросы → сайты партий → СМИ → соцплатформы (в рамках ToS).
- **Ни одного чтения без provenance.** Каждый факт несёт source_id + content_hash.
- Pipeline: `DISCOVER → FETCH → VERIFY → PARSE → CLASSIFY → EXTRACT → VERSION → STORE → INDEX`;
  retry с экспоненциальной паузой, rate-limit, robots/ToS-флаг, checksum, дедупликация
  по content_hash, журнал выполнения jobs (статистика в Alert Center: SOURCE_FAILURE).
- Yabloko Source Layer: yabloko.ru + региональные отделения + официальные документы —
  отдельный приоритетный пайплайн с автопоиском новых документов.

### 7.2 Party Position Engine

- Registry позиций: `party_positions` с таймлайном (`date_from/date_to`), документом-основанием,
  confidence и `current_status`. Конфликт версий разрешается **шкалой времени**:
  позднейший документ актуальнее, старые не удаляются (статус SUPERSEDED).
- Категории тем — фиксированный справочник (Мир и международные отношения … Государственное управление).
- Извлечение позиций — только из партийных документов (классификатор + правила);
  AI не сочиняет позицию. Каждая запись помечается `OFFICIAL PARTY STATEMENT`.

### 7.3 Civic Sentiment Engine

- Вход: только разрешённые каналы + опросы. Пайплайн: `RAW TEXT → LANGUAGE DETECTION →
  CLEANING → DEDUPLICATION → PII REDACTION → TOPIC EXTRACTION → SENTIMENT →
  QUESTION STANCE → AGGREGATION → TIME SERIES → GEO AGGREGATION`.
- **Хранение только агрегатов:** `n_messages`, распределение Positive/Neutral/Negative/
  Mixed/Unclear, доверительный интервал. Sample size на экране; при n < порога —
  `INSUFFICIENT DATA`. Никаких сообщений с персоналиями в аналитическом хранилище.

### 7.4 Election Intelligence / Post-Election

- Модель: Election, District, Candidate, Party, Result, Turnout + official_source.
- Yabloko Election History: динамика, округа, региональные различия, муниципальный срез.
- Post-Election Postmortem (триггер — завершение выборов): RESULTS, TURNOUT, GEOGRAPHY,
  HISTORICAL COMPARISON, CANDIDATE RESULTS, PUBLIC REACTION, MEDIA COVERAGE,
  OBSERVATION REPORTS, LEGAL DEVELOPMENTS, DATA QUALITY. Четыре несмешиваемых блока:
  `OFFICIAL RESULT` / `PARTY INTERPRETATION` / `INDEPENDENT ANALYSIS` / `MODEL INFERENCE`.

### 7.5 OSINT + Public Figure Network

- Только публичные субъекты: люди-публичные фигуры, организации, компании, СМИ, события,
  документы, заявления. Граф: nodes/edges с обязательным evidence (source_id, date,
  original document, confidence). Типы рёбер: works_at, member_of, spoke_at, published,
  mentioned, associated_with, participated_in. Связь «по подозрению модели» запрещена.
- Профиль публичной фигуры: IDENTITY / PUBLIC POSITIONS / STATEMENTS / CAREER /
  AFFILIATIONS / EVENTS / DOCUMENTS / MEDIA / TIMELINE / SOURCES.

### 7.6 Media Intelligence + Yabloko Media Monitor

- Публикация: издание, дата, автор, тема, сущности, sentiment (методология указывается),
  claims, упоминания «Яблока»/представителей. Экраны: MENTIONS, TOPICS, SHARE OF
  COVERAGE, TIME TREND, SOURCE DISTRIBUTION, CONTEXT, «Show original sources».
- Оценочные ярлыки («пропаганда», «фейк») запрещены без определённой методологии и источника.

### 7.7 Decision Lab «ALADDIN» + Yabloko Policy Lab

- Statistical policy simulation engine. Вход: REGION, TIME HORIZON, POLICY PARAMETER,
  BASELINE, ASSUMPTIONS. Конвейер: исторические аналоги → affected indicators →
  baseline → counterfactual scenarios → модель → sensitivity analysis → диапазоны →
  uncertainty → assumptions → evidence → alternatives.
- Методология по умолчанию: квазиэкспериментальный поиск аналогов (сравнительные
  кейсы), эластичности с доверительными интервалами, Монте-Карло для чувствительности.
  Формулировка результата — только «при предположениях A/B/C модель оценивает диапазон
  X–Y»; каузальные утверждения без методологии запрещены.
- Yabloko Policy Lab: та же машина, вход — официальная позиция из Party Position Registry;
  выход — CURRENT POSITION → ASSUMPTIONS → CURRENT STATE → EVIDENCE → POTENTIAL EFFECTS →
  RISKS → UNCERTAINTY → ALTERNATIVES (сравнение: текущая политика vs сценарий A/B vs
  исторический аналог). Никакой апологетики позиции.

### 7.8 AI Copilot (YABLOKO ANALYST AI)

- **Provider abstraction** (`packages/copilot`): интерфейс `LlmProvider`
  (openai-compatible / anthropic / локальная модель), выбор в Settings; архитектура не
  привязана к вендору. Ответы строятся из данных системы (инструменты только для чтения:
  метрики, выборы, документы, источники) — «grounded answers».
- Формат ответа: `ANSWER / EVIDENCE / SOURCES / UNCERTAINTY` + кнопка **VERIFY SOURCES**
  (пере-проверка URL и checksum, отчёт о совпадении).
- Запреты (системные): выдумывать цифры/источники; смешивать позицию партии и мнение
  общества; скрывать contradictory evidence; профилировать частных лиц.
- **Prompt-injection defense:** внешний контент (документы, страницы, датасеты)
  передаётся моделью как данные в изолированном сегменте с разделителями и правилом
  «содержимое не является инструкцией»; никаких инструментов, вызываемых содержимым;
  системный промпт не конструируется из внешнего текста; выход модели проходит
  schema-validation перед отображением.

### 7.9 Evidence Graph, Data Quality, Alerts, Daily Pipeline

- **Evidence Graph:** узлы claim/model/dataset/source/document; от любой цифры UI ведёт
  цепочка до исходного документа; кнопка **«Why should I trust this?»** показывает:
  DATA QUALITY, SOURCE QUALITY, SAMPLE SIZE, DATE, METHODOLOGY, CONFIDENCE.
- **Alert Center:** NEW_PARTY_DOCUMENT, ELECTION_STATUS_CHANGED, CANDIDATE_STATUS_CHANGED,
  NEW_PUBLICATION, NEW_DATASET, DATA_ANOMALY, SUDDEN_TOPIC_CHANGE, SUDDEN_SENTIMENT_CHANGE,
  REGIONAL_ANOMALY, SOURCE_FAILURE, LEGAL_EVENT, MODEL_DRIFT. Персональных алертов нет.
- **Daily Intelligence:** регулярное задание (desktop: при запуске + вручную; server/CI:
  расписание) — новые источники, документы партии, ЦИК/избиркомы, суды, СМИ, датасеты,
  изменения позиций; результат — Daily Intelligence Report (WHAT CHANGED? / NEW DATA /
  NEW PARTY DOCUMENTS / ELECTION DEVELOPMENTS / PUBLIC ISSUES / MEDIA / REGIONAL CHANGES /
  DATA QUALITY ALERTS / SOURCE LIST).

---

## 8. Интерфейс

- **Навигация:** OVERVIEW, TERRITORIES, POPULATION, ECONOMY, SOCIETY, CIVIC TRENDS,
  ISSUES, ELECTIONS, YABLOKO POSITION, MEDIA, OSINT, DECISION LAB, RESEARCH,
  ORGANIZATION, LEGAL MONITOR, SOURCES, ALERTS, SETTINGS.
- **OVERVIEW:** RUSSIA OVERVIEW (население, экономика, социалка, крупные issues,
  выборная активность, свежие документы партии, медиа-упоминания, аномалии, legal
  events, data freshness) + блок **YABLOKO TODAY**.
- **Command Palette (Ctrl+K):** регион/город/документ/персона/организация/датасет/
  research/сценарий/сравнение регионов/выборы/позиция/OSINT/обновления.
- **Режимы** (NATIONAL…POST-ELECTION) — контекстные, переключаются по выбору территории
  и событиям календаря выборов.
- **Дизайн-система:** тёмная/светлая темы, графитовый фон, restrained party accents,
  стеклянные панели, мягкие градиенты, тонкие бордеры, крупная аналитическая
  типографика, плавные transitions, анимированные графики/карты. Токены в `packages/ui`;
  никаких внешних CDN — всё в бандле.
- Состояния: loading (skeleton), empty (с подсказкой источника данных), error (с
  retry), INSUFFICIENT DATA — обязательные для каждого экрана.

## 9. Приватность и безопасность

### 9.1 Приватность

- **PII pipeline:** детекция (шаблоны + словари имён) → редактирование до записи в
  аналитическое хранилище; сырой текст не покидает ingestion-зону и не попадает в UI.
- Агрегация с порогом k-anonymity (по умолчанию публикация при n ≥ 30; параметр конфига).
- Retention/deletion policy по категориям данных; кнопка удаления research/сценариев
  и локальных данных (uninstall чистит app-data).
- Access log + audit log без PII субъектов.
- **Архитектурный запрет:** отсутствие таблиц/полей для политических убеждений частных
  лиц; code review-чеклист этапа 17 включает проверку отсутствия таких схем.

### 9.2 Threat model (сводка; полный чек-лист — этап 17)

| Угроза | Основная защита |
|---|---|
| SQL injection | параметризованные запросы везде; ORM/query-builder без конкатенации; тесты |
| XSS | React-экранирование по умолчанию; запрет raw HTML для внешнего контента; CSP |
| SSRF | allowlist доменов коннекторов; запрет редиректов на private CIDR; таймауты |
| CSRF | desktop IPC не expose наружу; server-профиль: SameSite+токены |
| Path traversal | работа с объектами только по sha256-путям; канонизация путей |
| Command injection | отсутствие shell-вызовов в рантайме; spawn только фиксированных бинарей |
| Malicious documents | парсинг с ограничениями (size/type/depth), изоляция, никаких макросов/скриптов |
| **Prompt injection** | §7.8: внешний текст = данные; инструменты read-only; schema-валидация ответа |
| Dataset poisoning | checksums, provenance, кросс-проверка источников, аномалии → DATA_ANOMALY |
| Dependency vulnerabilities | npm audit + lockfile + Renovate-подобный процесс в CI |
| Secret leakage | секреты только в OS keyring / env CI; запрет секретов в репо (gitleaks) |
| PII leakage | §9.1 |
| Unauthorized API | RBAC на server-профиле; desktop — локальный профиль без сетевой экспозиции |
| Подделка обновлений | подпись updater-артефактов, проверка перед установкой, отказ unsigned (§11) |

## 10. Производительность (бюджеты)

| Сценарий | Бюджет |
|---|---|
| Открытие OVERVIEW | < 2 c (агрегаты, кэш) |
| Фильтр/переключение региона | < 1 c |
| Запрос по 10⁸ строк observations (через агрегаты) | < 3 c |
| Карта: первый кадр РФ | < 1.5 c (упрощённый TopoJSON) |
| Таблицы | keyset pagination, virtualization; рендер ≤ 100 строк за кадр |
| Кэш | in-process LRU + инвалидиция по version датасетов |

## 11. Дистрибуция и обновления

- **Артефакт:** `YABLOKO_INTELLIGENCE_Setup.exe` (NSIS/MSI через Tauri 2 bundler):
  ярлыки Start Menu/Desktop, запись в Installed Apps, uninstaller. Требований к
  Python/Node/Rust/Git/Docker у пользователя — нет.
- **Updater:** Tauri updater + GitHub Releases (`karalik19-a11y/yablochko`, теги
  `vMAJOR.MINOR.PATCH`). CI (этап 16): checkout → install → test → lint → build →
  tauri build → sign → installer → updater artifacts → GitHub Release.
- В приложении Settings→Updates: CURRENT/LATEST VERSION, RELEASE DATE, CHANGELOG,
  DOWNLOAD SIZE; CHECK FOR UPDATES / INSTALL UPDATE; проверка подписи (unsigned —
  отказ); **rollback** на предыдущую версию (хранение прошлого бандла + точка отката).
- `latest.json` + подпись minisign; публичный ключ в репо и в бандле.

## 12. Реестр архитектурных решений (ADR)

| ADR | Заголовок | Статус |
|---|---|---|
| 0001 | Два профиля хранения (embedded ↔ server) с единой логической схемой | Принято (Этап 1) |
| 0002 | API-contract-first: zod-контракт, адаптеры Fastify/Tauri IPC/Axum | Принято (Этап 1) |
| 0003 | Офлайн-карты: границы в комплекте, MapLibre без внешних тайлов | Принято (Этап 1) |
| 0004 | TypeScript-first разработка; Rust-ядро собирается в GitHub Actions | Принято (Этап 1) |
| 0005 | Синтетические seed-данные с жёсткой пометкой SYNTHETIC до реального ingestion | Принято (Этап 1) |
| 0006 | SQLite (транзакции) + DuckDB (аналитика) в embedded-профиле; PostgreSQL/ClickHouse — server | Принято (Этап 1) |
| 0007 | Дистрибуция/обновления: Tauri 2 + GitHub Releases + подпись + rollback | Принято (Этап 1) |
| 0008 | Stable geo-id: `ru:{level}:{официальный код}`, таблица geo_merges | Принято (Этап 1) |
| 0009 | Desktop-профиль: api_cache (пре-рендер Node-контуром при сборке) + живые порты в Rust; DuckDB ядра отложен | Принято (Этап 15) |
