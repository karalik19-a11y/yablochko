/**
 * Главная навигация (18 разделов мастер-спецификации).
 * stage — этап, на котором раздел получит данные; до этого — честное
 * пустое состояние с пояснением, а не фиктивные данные.
 */

export interface NavItem {
  key: string;
  label: string;
  group: string;
  /** Этап появления данных (null — реализовано). */
  stage: number | null;
  description: string;
}

export const NAV: NavItem[] = [
  { key: 'overview', label: 'Обзор', group: 'Анализ', stage: null, description: 'Россия: состояние и YABLOKO TODAY' },
  { key: 'territories', label: 'Территории', group: 'Анализ', stage: 4, description: 'Дриллдаун: ФО → субъект → муниципалитет (карта, Этап 4)' },
  { key: 'population', label: 'Население', group: 'Анализ', stage: null, description: 'Population Intelligence: демография и показатели (SYNTHETIC до импорта Росстата)' },
  { key: 'economy', label: 'Экономика', group: 'Анализ', stage: null, description: 'Экономика, доходы, занятость, бизнес (SYNTHETIC до импорта)' },
  { key: 'society', label: 'Общество', group: 'Анализ', stage: null, description: 'Здравоохранение, образование, жильё, миграция (SYNTHETIC)' },
  { key: 'civic-trends', label: 'Общественные настроения', group: 'Темы и позиции', stage: null, description: 'Civic Sentiment Engine: только агрегаты, k-анонимность, SYNTHETIC (Этап 6)' },
  { key: 'issues', label: 'Проблемы (Issues)', group: 'Темы и позиции', stage: 6, description: 'Issue Tracker: растущие и затухающие темы (Этап 6)' },
  { key: 'yabloko-position', label: 'Позиция «Яблока»', group: 'Темы и позиции', stage: null, description: 'Реестр позиций партии; матрица с общественным мнением — Этап 7' },
  { key: 'elections', label: 'Выборы', group: 'Электорат', stage: null, description: 'Election Intelligence: результаты и явка с official_source; SYNTHETIC до импорта ЦИК (Этап 8)' },
  { key: 'media', label: 'Медиа', group: 'Информационная среда', stage: null, description: 'Media Monitor: упоминания, темы, доля с методологией; SYNTHETIC-корпус (Этап 11)' },
  { key: 'osint', label: 'OSINT', group: 'Информационная среда', stage: null, description: 'Граф публичных сущностей с evidence-рёбрами; приватные лица не вносятся (Этап 10)' },
  { key: 'analyst', label: 'AI Analyst', group: 'Анализ', stage: 13, description: 'YABLOKO ANALYST AI: ANSWER/EVIDENCE/SOURCES/UNCERTAINTY, VERIFY SOURCES (Этап 13)' },
  { key: 'decision-lab', label: 'Decision Lab', group: 'Информационная среда', stage: null, description: 'ALADDIN: сценарии p10/p50/p90, только «при предположениях…» (Этап 12)' },
  { key: 'research', label: 'Research', group: 'Информационная среда', stage: 12, description: 'Исследовательские рабочие пространства (Этап 12)' },
  { key: 'organization', label: 'Организация', group: 'Партия', stage: null, description: 'Руководство, органы, документы, кандидаты' },
  { key: 'postmortem', label: 'Постмортем 2026', group: 'Электорат', stage: null, description: 'Election Postmortem: 4 несмешиваемых блока + DATA QUALITY (Этап 9)' },
  { key: 'sources', label: 'Источники', group: 'Система', stage: null, description: 'Source Registry: реестр и статусы источников' },
  { key: 'alerts', label: 'Алерты', group: 'Система', stage: null, description: 'Alert Center: системные события (каркас)' },
  { key: 'settings', label: 'Настройки', group: 'Система', stage: null, description: 'Тема, данные, обновления (каркас)' }
];

export const NAV_GROUPS = [...new Set(NAV.map((n) => n.group))];
