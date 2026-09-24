# ROADMAP — YABLOKO INTELLIGENCE

> Поэтапный план реализации (18 этапов мастер-плана). Каждый этап завершается
> рабочим состоянием приложения: tests ✅ lint ✅ build ✅ UI проверен ✅.
> Контекст среды разработки и принятые решения — см. `docs/PROJECT_AUDIT.md`
> и `docs/ARCHITECTURE.md`.

---

## Вехи (milestones)

| Веха | Этапы | Смысл | Состояние |
|---|---|---|---|
| **M0 Foundation** | 1–3 | Аудит + ядро Party Context + Source Registry / ingestion | Этапы 1–3 ✅ |
| **M1 Data Spine** | 4–5 | География, показатели территорий | Этапы 4–5 ✅ |
| **M2 Analytics Core** | 6–8 | Настроения, Position Matrix, выборы | Этапы 6–7 ✅ |
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

## Этап 2 — Ядро YABLOKO Context ✅ (выполнен 2026-09-24)

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

**Результат:**
- Монорепозиторий (npm workspaces): `packages/{domain,api-contract,data-access,ingest,ui,app}`,
  `services/dev-api` (Fastify: API + статика SPA на одном порту), `apps/web-dev` (Vite-хот-хост);
  toolchain: TS 5.9 strict, Vitest, ESLint 9 + typescript-eslint, Prettier.
- Партийный контекст: сущности Party/PartyLeader/PartyBody/PartyDocument/PartyPosition/
  PartyEvent/PartyCandidate/ElectionParticipation; SQLite-миграция `001_core_party_context`;
  идемпотентный seed из `datasets/party/*` — все записи INITIAL CONTEXT со статусом
  **UNVERIFIED** и обязательным source_id.
- Party Position Registry (`@yabloko/domain`): чистые функции таймлайна —
  CURRENT/SUPERSEDED/EXPIRED/UNVERIFIED (+документированное расширение FUTURE),
  детерминированное разрешение конфликтов, конфликты фиксируются, история не удаляется.
- Каркас автообновления: JobRunner с журналом `job_runs` (восстановление после рестарта)
  и задача `party-context-refresh` — в среде без сети честно пишет
  `network_unavailable` (виден на экране «Алерты»).
- UI: shell с 18 разделами навигации, тёмная/светлая темы, палитра команд (Ctrl+K),
  OVERVIEW с RUSSIA OVERVIEW + YABLOKO TODAY, реестр позиций, организация/документы,
  Source Registry, Alert-каркас, настройки; пустые состояния с INSUFFICIENT DATA вместо
  фиктивных данных; бейджи OFFICIAL PARTY STATEMENT / UNVERIFIED / SEED DATA.
- Проверено: typecheck ✅, ESLint ✅, Vitest 33/33 ✅ (таймлайн, миграции/seed, планировщик,
  доступность источников, интеграция API↔контракт), vite build ✅, runtime-проверка API+SPA ✅.

## Этап 3 — Источники России ✅ (выполнен 2026-09-24)

**Цель:** Source Registry + ingestion architecture.
**Объём:** connector interface (fetch/parse/verify), реестр с метаданными (license,
update_frequency, checksum…), ingestion jobs + retry + логи + validation + dedup;
5–10 качественных источников. Исполнение коннекторов — CI (`ingest.yml`) и
локально; в песочнице — контрактные тесты на fixture-снимках.
**DoD:** pipeline DISCOVER→…→INDEX проходит на fixtures; retry/dedup покрыты тестами;
Alert SOURCE_FAILURE работает; ни одна запись без provenance.

**Результат:**
- Полный pipeline 9 стадий (DISCOVER → FETCH → VERIFY → PARSE → CLASSIFY →
  EXTRACT → VERSION → STORE → INDEX) с журналом `ingestion_runs`/`ingestion_events`.
- HTTP-слой: retry с экспоненциальной паузой ± jitter (сеть/таймаут/5xx/429),
  SSRF-защита — allowlist хоста источника проверяется на каждом редиректе
  (`redirect: manual`), лимит размера, таймаут, запрет учётных данных в URL.
- Хранилище: `source_snapshots` (неизменяемые, content-addressable) →
  `documents` с дедупликацией по (source_id, content_sha256) и версионированием
  по URL; FTS5-индекс (поиск `?q=`); обновление source.last_update/checksum.
- Классификация: weighted-скоринг по URL/заголовку/тексту (program, statement,
  decision, press_release, election, position, index).
- Alert Center: NEW_PARTY_DOCUMENT (при новых партийных документах),
  SOURCE_FAILURE (при полном провале источника, статус → failed); acknowledge API
  + экран алертов.
- Реестр: 10 источников по приоритетам (партийные 2, гос- 5: ЦИК/Росстат/
  data.gov.ru/pravo.gov.ru/СОЗД, опросы 2: ВЦИОМ/ФОМ, внутренний 1); коннектор
  `yabloko-ru` (Yabloko Source Layer) полностью работает: fixture-режим в песочнице,
  live — в CI/локально.
- CLI: `npm run ingest -- --mode live|fixture [--source id]`.
- CI: `.github/workflows/ci.yml` (typecheck/lint/test/build на каждый push) и
  `.github/workflows/ingest.yml` (ежедневный cron + ручной запуск, артефакты
  хранилища).
- Проверено: typecheck ✅, ESLint ✅, Vitest 41/41 ✅ (pipeline на fixtures,
  retry, SSRF-guard, редиректы, дедупликация, версии, FTS, алерты), build ✅,
  runtime: 4 fixture-документа в БД, поиск, алерты, acknowledge ✅.

## Этап 4 — Географическая база ✅ (выполнен 2026-09-24)

**Цель:** полная иерархия РФ + карта.
**Объём:** `geography` (6 уровней, stable `ru:{level}:{code}`, `geo_merges`), seed
справочника (ФО→субъекты, ОКТМО-коды); TopoJSON-границы (страна/ФО/субъекты) в
`datasets/geo`; MapLibre офлайн-карта, слои-каркас, drill-down кликом, хлебные крошки.
**DoD:** клик по субъекту открывает Territory Profile (каркас); границы отображаются
без сети; тесты idempotency geo-идов; бюджет размера бандла границ соблюдён.

**Результат:**
- Справочник `datasets/geo/rf.json`: 1 страна + 8 ФО + **89 субъектов** (по официальной
  классификации РФ; ISO 3166-2:RU где присвоен, rf_internal — иначе) + пилотный
  муниципальный слой (СПб, Псковская обл., coverage=pilot_partial).
- Stable IDs (ADR-0008): `ru:{level}:{код}`; идемпотентный seed; переименования
  сохраняют geo_id (покрыто тестом); слияния — `geo_merges` + деактивация старого ID.
- Миграция 003: `geography` (6 уровней, CHECK-валидность) + `geo_merges`.
- Карта: MapLibre (npm, офлайн) со **схематической tile-картограммой** субъектов —
  методология слоя помечает «НЕ географические границы»; замена на реальные границы —
  через ingestion (инструкция в datasets/geo/README.md). Фильтр по ФО, hover-tooltip,
  клик → Territory Profile, fitBounds, тёмная/светлая темы.
- Territory Profile: хлебные крошки (страна→ФО→субъект→МО), 19 разделов
  (DEMOGRAPHICS … YABLOKO ACTIVITY) с честным INSUFFICIENT DATA + этап подключения.
- API: /geo/tree, /geo/map?fd=, /geo/search?q=, /geo/territory/:geoId.
- Палитра команд: живой Search region/city (Ctrl+K).
- Проверено: Vitest 50/50 (картограмма: 89 уникальных ячеек; иерархия без сирот;
  idempotency; слияния; поиск; drill-down), lint/typecheck/build ✅, runtime ✅.

## Этап 5 — Population Intelligence ✅ (выполнен 2026-09-24)

**Цель:** каркас территориальных показателей.
**Объём:** единый формат `regional_metrics` (value/trend/period/source/quality/confidence);
домены: population, age, sex, migration, birth, death, density, education, employment,
income, housing; seed-данные SYNTHETIC + импортёр Росстата (исполняется в CI);
экраны POPULATION/ECONOMY/SOCIETY с тайм-сериями (ECharts) и таблицами (virtualized).
**DoD:** территориальный профиль (на примере СПб) показывает разделы DEMOGRAPHICS…HOUSING
с provenance-бейджами; «Why should I trust this?» открывает цепочку evidence.

**Результат:**
- Миграция 004: `metrics_catalog` (28 метрик / 11 доменов по мастер-списку:
  population, age, sex, migration, birth, death, density, education, employment,
  income, housing + экономика/бизнес/медицина) + `regional_metrics`
  (UNIQUE geo_id+metric+period+source) + `metrics_domains`.
- Единый формат: VALUE · TREND (разность соседних периодов, явно «не оценка и
  не причинность») · PERIOD · SOURCE (grade/note/license/last_update/checksum) ·
  QUALITY (coverage, data_mode) · METHODOLOGY.
- SYNTHETIC-генератор (ADR-0005): детерминированные ряды 2019–2025 для 89 субъектов;
  ФО и страна считаются согласованно (сумма / средневзвешенное по населению);
  источник `synthetic-demo` grade D зарегистрирован в Source Registry с честным
  описанием. Замена на Росстат при импорте снимает пометку SYNTHETIC автоматически.
- Territory Profile: разделы DEMOGRAPHICS / MIGRATION / EDUCATION / EMPLOYMENT /
  INCOME / HOUSING / ECONOMY / BUSINESS / HEALTHCARE заполнены (значение + тренд +
  спарклайн + SYN-бейдж + Trust); остальные 10 разделов — INSUFFICIENT DATA
  с этапом подключения.
- Экраны POPULATION / ECONOMY / SOCIETY: сравнение субъектов (выбор до 4 метрик,
  фильтр ФО, сортировка, переход в профиль, Trust).
- Карта: слои-хлороплет Population / Income / Employment / Housing (квантильная
  шкала, легенда, tooltip со значением, методология слоя обновляется).
- **Why should I trust this?**: цепочка VALUE → DATASET (row_key) → SOURCE
  (grade/license/checksum) → METHODOLOGY + coverage + оговорки (включая явное
  «значение СИНТЕТИЧЕСКОЕ» и «тренд — не причинность»).
- Проверено: Vitest 61/61 (детерминизм генератора, согласованность агрегатов,
  idempotency, provenance, trust-цепочка, контракт-интеграция), lint/typecheck/
  build ✅, runtime: каталог 28 метрик, СПб 9 доменов, слой карты 89 значений,
  trust-цепочка, compare по СЗФО ✅.

## Этап 6 — Civic Intelligence ✅ (выполнен 2026-09-24)

**Цель:** агрегированные настроения.
**Объём:** справочник тем; sentiment pipeline (aggregate-only) с PII scrubber;
хранение только агрегатов + k-анонимность; экран CIVIC TRENDS: распределение
Positive/Neutral/Negative/Mixed/Unclear, sample size, INSUFFICIENT DATA при малых n.
**DoD:** тест PII scrubber (фикстуры с PII не попадают в хранилище); агрегаты
корректны; запрет персональных записей закреплён тестом схемы.

**Результат:**
- Миграция 005: `topics` (справочник тем), `civic_aggregates` — ТОЛЬКО агрегаты:
  в схеме нет текстовых колонок; CHECK `n_messages = pos+neu+neg+mixed+unclear`;
  UNIQUE(geo, topic, period, source); `civic_batches` (статистика батчей, без текстов);
  `pii_log` (только kind/action/count). Персональные записи отсутствуют архитектурно.
- Справочник 14 тем (`datasets/civic/topics.json`): цены, ЖКХ, транспорт, экология,
  доходы, работа, медицина, образование, жильё, коррупция, МСУ, внешняя политика,
  мир, права человека; keywords + SYNTHETIC-конфиги (объём/тренд/сезонные волны/
  доли тональности); k_min = 30; meta.methodology — полный текст pipeline.
- Pipeline (`packages/ingest/civic.ts`, чистые функции): LANGUAGE DETECTION
  (кириллица ≥50% букв, short-фильтр) → CLEANING → DEDUPLICATION (нормализованный
  текст) → PII REDACTION (8 паттернов: телефон/email/паспорт/карта/СНИЛС/
  имя-отчество/адрес/URL → `[REDACTED:KIND]`; журнал — только вид и количество) →
  TOPIC EXTRACTION (multi-label) → SENTIMENT (лексикон ~90+/90− стемов, отрицание
  в окне 2 слова, Mixed 1:3…3:1, Unclear <3 слов) → QUESTION STANCE → AGGREGATION.
  Страж-тест: в результате pipeline нет ни одного текстового поля/исходного текста.
- Хранилище и derivations (`packages/data-access/civic.ts`): детерминированный
  SYNTHETIC-генератор (регион-фактор 0.25–2.2, джиттер ±3%, allocate наибольших
  остатков — суммы ровно n); `aggregateCivicUp` (ФО/страна = Σ субъектов, иерархия
  передаётся явно); upsert-хранение (idempotency); `getCivicOverview` — окно 3–36
  мес, месячные ряды, last3/prev3, классификация new/rising(≥+25%)/declining(≤−25%)/
  stable, INSUFFICIENT при last3 < k_min.
- API `GET /api/v1/civic/overview?geo=&months=`: только агрегаты; валидация geo
  (regex stable-id, инъекции → 404); meta-warning «тексты и персональные записи
  отсутствуют в схеме».
- Экран CIVIC TRENDS: гео-селектор (Россия/ФО/субъекты), окно 6/12/24/36 мес,
  KPI (last3, активные/растущие/новые темы), таблица тем — объём last3, тренд-
  констатация, бейдж класса, спарклайн 12 мес, стек тональности, «Детали» с
  месячными барами; INSUFFICIENT DATA приглушает строку; бейдж SYNTHETIC;
  панель METHODOLOGY (pipeline + этика: профили частных лиц не создаются).
- Territory Profile: раздел PUBLIC CONCERNS — топ-5 тем территории с классом
  тренда и переходом в CIVIC TRENDS (раньше срока — было INSUFFICIENT).
- Источник `synthetic-civic` (grade D) в Source Registry: «отключается при первом
  реальном импорте настроений».
- Проверено: Vitest 97/97 (pipeline: отрицание/PII по видам/дедуп/язык/multi-label/
  страж отсутствия текстов; репо: детерминизм, согласованность ФО=Σ субъектов,
  idempotency, CHECK-схема, классификации/insufficient; интеграция контракта),
  lint/typecheck/build ✅, runtime: страна 14 тем (rising +55% foreign_policy,
  declining −31% corruption), Сахалин 6 тем INSUFFICIENT, инъекция → 404 ✅.

## Этап 7 — YABLOKO Position Matrix ✅ (выполнен 2026-09-24)

**Цель:** позиция партии ↔ общественное мнение.
**Объём:** матрица: строки — вопросы, колонки — Yabloko Position / Public Opinion /
Regional Data / Trend / Evidence / Uncertainty; тайм-шкала позиций; явное отображение
OVERLAP/DIVERGENCE/UNCERTAINTY; формулировки «наблюдается/не наблюдается статистическое
совпадение…»; никаких политических рекомендаций.
**DoD:** экран YABLOKO POSITION на seed-данных с полным provenance; тесты на смешение
категорий (позиция ≠ мнение) отсутствуют в коде.

**Результат:**
- Связи тем с позициями и показателями: `datasets/civic/topic_links.json` (14 связей:
  мир/внешняя политика → «Мир и международные отношения», права человека, МСУ/коррупция →
  «Политические институты»; экономики/социальные темы → метрики Этапа 5 без позиций;
  для транспорта/экологии Regional Data честно пуст — показателей в каталоге нет).
  Зафиксированы правила сопоставления и глобальные category_rules.
- Репозиторий `packages/data-access/matrix.ts`: `loadTopicLinks` (zod) +
  `computePositionMatrix` — строки по всем 14 темам; блоки жёстко разведены по категориям:
  ПОЗИЦИЯ ПАРТИИ (реестр, OFFICIAL_PARTY_STATEMENT, дата/источник/документ/UNVERIFIED),
  ОБЩЕСТВЕННОЕ МНЕНИЕ (АНАЛИЗ: агрегаты настроений, доля негатива/позитива, тренд темы),
  РЕГИОНАЛЬНЫЕ ДАННЫЕ (ФАКТ: значения метрик + тренд), СОПОСТАВЛЕНИЕ (МОДЕЛЬ):
  agenda_overlap («Наблюдается совпадение повестки…»), agenda_divergence («Не наблюдается
  документированной позиции…»), uncertainty (INSUFFICIENT DATA, n < k_min). Совпадение
  позиций (согласие) никогда не вычисляется из тональности; позиции без связи с темами
  не теряются (unlinked_positions). Рекомендации не формируются.
- API `GET /api/v1/positions/matrix?geo=&months=` (валидация geo, инъекции → 404) +
  контракт `PositionMatrix` (api-contract/matrix.ts).
- UI: экран YABLOKO POSITION → табы РЕЕСТР / МАТРИЦА. Матрица: счётчики статусов,
  колонки-блоки с бейджами категорий (ЗАЯВЛЕНИЕ ПАРТИИ / АНАЛИЗ·SYN / ФАКТ·SYN /
  AGENDA OVERLAP / DIVERGENCE / UNCERTAINTY), формулировки-констатации, панель
  «ПРАВИЛА СОПОСТАВЛЕНИЯ» с category_rules (не смешивать ФАКТ/ЗАЯВЛЕНИЕ/АНАЛИЗ/МОДЕЛЬ).
- СТРАЖ-тесты несмешения категорий: opinion-блок не содержит текстов и id позиций;
  position-блок не содержит полей мнения; agenda_overlap только при наличии позиции;
  категория позиции всегда OFFICIAL_PARTY_STATEMENT.
- Проверено: Vitest 105/105 (матрица: правила, формулировки, стражи категорий,
  unlinked, детерминизм; интеграция контракта), lint/typecheck/build ✅, runtime:
  страна 14 строк (5 overlap / 9 divergence), «Свободы» в unlinked, региональные
  блоки (доходы/бедность у цен), инъекция → 404 ✅.

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
| 2. YABLOKO Context | ✅ завершён (2026-09-24) |
| 3. Источники России | ✅ завершён (2026-09-24) |
| 4. Географическая база | ✅ завершён (2026-09-24) |
| 5. Population Intelligence | ✅ завершён (2026-09-24) |
| 6. Civic Intelligence | ✅ выполнен (агрегат-only pipeline, k-анонимность, CIVIC TRENDS) |
| 7. YABLOKO Position Matrix | ✅ выполнен (матрица категорий, OVERLAP/DIVERGENCE/UNCERTAINTY, стражи несмешения) |
| 8–18 | — запланированы |
