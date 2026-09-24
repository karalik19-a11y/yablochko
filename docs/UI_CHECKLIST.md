# UI Visual Checklist — Этап 14 (Beautiful UX)

Единый визуальный чек-лист по каждому экрану. Прогоняется:
(a) вручную при изменениях экрана, (b) автоматически в CI
(`.github/workflows/screenshots.yml` — скриншоты ключевых экранов в обеих темах,
запрет ошибок консоли, проверка переключения темы без перезагрузки и Ctrl+K).

Общие требования ко **всем** экранам:

- [x] Loading: `Skeleton` на время запроса (не мигает: производное состояние в `useApi`)
- [x] Error: `ErrorBox` с кнопкой «Повторить» на каждый независимый запрос
- [x] Empty: `EmptyState` с `title` (и `note`, где уместно)
- [x] INSUFFICIENT DATA: пустые/недостаточные данные помечаются текстом, не маскируются
- [x] Честные бейджи: SEED DATA · UNVERIFIED (topbar), SYNTHETIC, grade D, DATA MODE
- [x] Trust-цепочка VALUE→DATASET→SOURCE→METHODOLOGY: цифра → источник → методология/сноска
- [x] Категории FACT / OFFICIAL PARTY STATEMENT / ANALYSIS / MODEL не смешиваются
- [x] TrendArrow нейтрален (констатация изменения, не оценка)
- [x] Обе темы (тёмная/светлая) без потери контраста; переключение без перезагрузки
- [x] Клавиатура: nav-элементы и кнопки фокусируемы, видимый :focus-visible, Enter/Space
- [x] Responsive: ≤980px сайдбар в off-canvas (burger), сетки схлопываются

## Экраны

| Экран | Loading | Error | Empty/INSUF | Особые элементы |
|---|---|---|---|---|
| OVERVIEW | ✓ | ✓ | ✓ | YABLOKO TODAY, KPI, аномалии, data freshness |
| TERRITORIES | ✓ | ✓ | ✓ | карта (offline-картограмма), дриллдаун, geo-поиск |
| TERRITORY | ✓ | ✓ | ✓ | метрики, trust-панель «Why should I trust this?» |
| POPULATION / ECONOMY / SOCIETY | ✓ | ✓ | ✓ | MetricsExplorer: источник+методология у каждой метрики |
| CIVIC TRENDS | ✓ | ✓ | ✓ | k-анонимность (k_min=30), только агрегаты |
| YABLOKO POSITION | ✓ | ✓ | ✓ | реестр позиций, OFFICIAL PARTY STATEMENT, статусы верификации |
| POSITION MATRIX | ✓ | ✓ | ✓ | OVERLAP/DIVERGENCE/UNCERTAINTY, стражи несмешения |
| ELECTIONS | ✓ | ✓ | ✓ | official_source у каждого результата, нет предсказаний |
| POSTMORTEM 2026 | ✓ | ✓ | ✓ | 4 несмешиваемых блока, DATA QUALITY, нет «официальных результатов» |
| OSINT | ✓ | ✓ | ✓ | граф публичных сущностей, privacy_note, deep-link `osint/{id}` |
| MEDIA | ✓ | ✓ | ✓ | доли — только с методологией, издания SYNTHETIC-ИЗДАНИЕ … |
| DECISION LAB | ✓ | ✓ | ✓ | p10/p50/p90, «при предположениях…», sensitivity, evidence |
| RESEARCH | ✓ | ✓ | ✓ | цепочка CURRENT POSITION→…→ALTERNATIVES, без апологетики |
| ANALYST AI | ✓ | ✓ | ✓ | ANSWER/EVIDENCE/SOURCES/UNCERTAINTY, VERIFY SOURCES, DEGRADED MODE |
| ORGANIZATION | ✓ | ✓ | ✓ | документы (FTS), руководители, органы, кандидаты |
| SOURCES | ✓ | ✓ | ✓ | Source Registry: grade, checksum, ingest-инфо |
| ALERTS | ✓ | ✓ | ✓ | acknowledge, типы алертов, без персональных |
| SETTINGS | ✓ | ✓ | ✓ | тема, режим данных, системная информация |

## Command Palette (Ctrl+K)

- [x] Открытие/закрытие: Ctrl+K (повторное — toggle), Esc, клик по фону
- [x] Клавиатура: ↑/↓ (границы по объединённому списку), Enter, hover-sync
- [x] Команды мастер-промпта: регион/город (живой geo-поиск), документы (FTS),
      персона/организация (OSINT-поиск, deep-link в профиль), датасет,
      research, сценарий, сравнение регионов, выборы, позиция, OSINT,
      обновления/алерты, VERIFY SOURCES, тема, AI Analyst
- [x] Debounce 180мс; пустой результат — «Ничего не найдено», не тишина

## CI-скриншоты

- Workflow: `.github/workflows/screenshots.yml` (Playwright Chromium, GitHub Actions;
  в песочнице CDN Playwright закрыт — запуск только в CI, как Rust-сборка в ADR-0002)
- Скрипт: `scripts/screenshots.mjs` — 13 экранов в тёмной теме + light-overview +
  переключение темы без перезагрузки + палитра; ошибка консоли = красный job;
  артефакт `screenshots/*.png` (retention 14 дней)
