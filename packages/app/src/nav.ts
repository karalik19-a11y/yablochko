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
  { key: 'population', label: 'Население', group: 'Анализ', stage: 5, description: 'Population Intelligence: демография и показатели (Этап 5)' },
  { key: 'economy', label: 'Экономика', group: 'Анализ', stage: 5, description: 'Экономические показатели территорий (Этап 5)' },
  { key: 'society', label: 'Общество', group: 'Анализ', stage: 5, description: 'Здравоохранение, образование, жильё (Этап 5)' },
  { key: 'civic-trends', label: 'Общественные настроения', group: 'Темы и позиции', stage: 6, description: 'Civic Sentiment Engine — только агрегаты (Этап 6)' },
  { key: 'issues', label: 'Проблемы (Issues)', group: 'Темы и позиции', stage: 6, description: 'Issue Tracker: растущие и затухающие темы (Этап 6)' },
  { key: 'yabloko-position', label: 'Позиция «Яблока»', group: 'Темы и позиции', stage: null, description: 'Реестр позиций партии; матрица с общественным мнением — Этап 7' },
  { key: 'elections', label: 'Выборы', group: 'Электорат', stage: 8, description: 'Election Intelligence: база выборов и результатов (Этап 8)' },
  { key: 'media', label: 'Медиа', group: 'Информационная среда', stage: 11, description: 'Media Intelligence и мониторинг упоминаний (Этап 11)' },
  { key: 'osint', label: 'OSINT', group: 'Информационная среда', stage: 10, description: 'Публичные фигуры и организации, граф связей (Этап 10)' },
  { key: 'decision-lab', label: 'Decision Lab', group: 'Информационная среда', stage: 12, description: 'ALADDIN: сценарное моделирование (Этап 12)' },
  { key: 'research', label: 'Research', group: 'Информационная среда', stage: 12, description: 'Исследовательские рабочие пространства (Этап 12)' },
  { key: 'organization', label: 'Организация', group: 'Партия', stage: null, description: 'Руководство, органы, документы, кандидаты' },
  { key: 'legal-monitor', label: 'Правовой мониторинг', group: 'Партия', stage: 9, description: 'ЦИК, избиркомы, суды, статусы (Этап 9)' },
  { key: 'sources', label: 'Источники', group: 'Система', stage: null, description: 'Source Registry: реестр и статусы источников' },
  { key: 'alerts', label: 'Алерты', group: 'Система', stage: null, description: 'Alert Center: системные события (каркас)' },
  { key: 'settings', label: 'Настройки', group: 'Система', stage: null, description: 'Тема, данные, обновления (каркас)' }
];

export const NAV_GROUPS = [...new Set(NAV.map((n) => n.group))];
