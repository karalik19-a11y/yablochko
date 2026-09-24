import { describe, expect, it } from 'vitest';
import {
  classifySentiment,
  redactPii,
  detectLanguage,
  cleanMessage,
  normalizeForDedup,
  dedupHash,
  extractTopics,
  runCivicPipeline,
  PII_PATTERNS
} from './civic.js';
import type { TopicDef } from './civic.js';

const TOPICS: TopicDef[] = [
  { topic_id: 'prices', name: 'Цены', category: 'economy', keywords: ['цен', 'подорожал', 'тариф'] },
  { topic_id: 'utilities', name: 'ЖКХ', category: 'housing', keywords: ['жкх', 'отоплен', 'тариф'] },
  { topic_id: 'healthcare', name: 'Здравоохранение', category: 'social', keywords: ['поликлин', 'врач', 'лечен'] }
];

describe('classifySentiment', () => {
  it('позитив без сигналов отрицания', () => {
    const r = classifySentiment('Врач очень помог, спасибо большое!');
    expect(r.sentiment).toBe('positive');
    expect(r.posSignals).toBeGreaterThanOrEqual(1);
  });

  it('отрицание в окне 2 слов меняет знак сигнала', () => {
    const r = classifySentiment('Врач совсем не помог, к сожалению.');
    expect(r.sentiment).toBe('negative');
    expect(r.negSignals).toBeGreaterThanOrEqual(1);
  });

  it('смешанные сигналы 1:1 → mixed', () => {
    const r = classifySentiment('Ремонт сделали хороший, но очень дорогой.');
    expect(r.sentiment).toBe('mixed');
    expect(r.posSignals).toBe(1);
    expect(r.negSignals).toBe(1);
  });

  it('преобладание негатива 1:3+ → negative', () => {
    const r = classifySentiment('Хорошо лишь то, что плохо, ужасно, кошмарно и повсеместно всё плохо.');
    expect(r.sentiment).toBe('negative');
  });

  it('менее 3 слов → unclear', () => {
    expect(classifySentiment('Плохо всё').sentiment).toBe('unclear');
  });

  it('вопросительная стойка: знак вопроса и вопросное слово', () => {
    expect(classifySentiment('Когда откроют поликлинику?').isQuestion).toBe(true);
    expect(classifySentiment('Что с отоплением в доме').isQuestion).toBe(true);
    expect(classifySentiment('Отопление включили наконец').isQuestion).toBe(false);
  });
});

describe('redactPii', () => {
  it('телефон, email, паспорт, карта, снилс', () => {
    const r = redactPii(
      'Звоните +7 912 345-67-89 или ivan@mail.ru, паспорт 1234 567890, карта 4111 1111 1111 1111, снилс 123-456-789 00.'
    );
    expect(r.text).toContain('[REDACTED:PHONE]');
    expect(r.text).toContain('[REDACTED:EMAIL]');
    expect(r.text).toContain('[REDACTED:PASSPORT]');
    expect(r.text).toContain('[REDACTED:CARD]');
    expect(r.text).toContain('[REDACTED:SNILS]');
    expect(r.counts['phone']).toBe(1);
    expect(r.counts['email']).toBe(1);
    expect(r.counts['passport']).toBe(1);
    expect(r.counts['card']).toBe(1);
    expect(r.counts['snils']).toBe(1);
    expect(r.total).toBe(5);
    expect(r.text).not.toContain('912');
    expect(r.text).not.toContain('ivan@mail.ru');
  });

  it('имя-отчество и адрес редактируются', () => {
    const r = redactPii('Иван Иванович жаловался на яму на ул. Ленина, д. 5.');
    expect(r.counts['name_patronymic']).toBe(1);
    expect(r.counts['address']).toBe(1);
    expect(r.text).toContain('[REDACTED:NAME]');
    expect(r.text).toContain('[REDACTED:ADDRESS]');
    expect(r.text).not.toContain('Иван Иванович');
  });

  it('url редактируется', () => {
    const r = redactPii('Смотрите фото https://example.com/pit.jpg пожалуйста.');
    expect(r.counts['url']).toBe(1);
    expect(r.text).toContain('[REDACTED:URL]');
    expect(r.text).not.toContain('example.com');
  });

  it('8 паттернов в реестре, все замены — метки без исходных данных', () => {
    expect(PII_PATTERNS).toHaveLength(8);
    for (const p of PII_PATTERNS) expect(p.replacement).toMatch(/^\[REDACTED:[A-Z_]+\]$/);
  });
});

describe('language / cleaning / dedup', () => {
  it('detectLanguage: ru / other / short', () => {
    expect(detectLanguage('Дороги в плохом состоянии повсеместно')).toBe('ru');
    expect(detectLanguage('The roads are terrible everywhere')).toBe('other');
    expect(detectLanguage('Да')).toBe('short');
  });

  it('cleanMessage: html-сущности и пробелы', () => {
    expect(cleanMessage('Цены&nbsp;растут&nbsp;&nbsp;быстро')).toBe('Цены растут быстро');
    expect(cleanMessage('a&amp;b &lt;x&gt;')).toBe('a&b <x>');
  });

  it('normalizeForDedup + dedupHash детерминированы и устойчивы к пунктуации/регистру', () => {
    const a = normalizeForDedup('Цены растут!');
    const b = normalizeForDedup('цены... РАСТУТ');
    expect(a).toBe(b);
    expect(dedupHash(a)).toBe(dedupHash(b));
    expect(dedupHash(a)).toMatch(/^d[0-9a-f]+$/);
  });
});

describe('extractTopics', () => {
  it('multi-label: одно сообщение может попасть в несколько тем', () => {
    const m = extractTopics('подорожали тарифы жкх', TOPICS);
    expect(m).toContain('prices');
    expect(m).toContain('utilities');
    expect(m).toHaveLength(2);
  });

  it('без совпадений — пусто', () => {
    expect(extractTopics('погода хорошая', TOPICS)).toEqual([]);
  });
});

describe('runCivicPipeline', () => {
  const opts = { topics: TOPICS, defaultGeoId: 'RU-SPB' };

  it('СТРАЖ: в результате нет текстовых полей и исходных текстов', () => {
    const result = runCivicPipeline(
      [
        { text: 'Цены на продукты zzqqmarker подорожали сильно', date: '2026-08-01' },
        { text: 'В поликлинике врач помог, спасибо', date: '2026-08-02' }
      ],
      opts
    );
    const dump = JSON.stringify(result).toLowerCase();
    expect(dump).not.toContain('zzqqmarker');
    expect(dump).not.toContain('подорожали');
    expect(dump).not.toContain('поликлинике');
    // ключи агрегатов — только числовые/идентификаторные поля
    for (const row of result.aggregates) {
      expect(Object.keys(row).sort()).toEqual([
        'geo_id',
        'n_messages',
        'n_mixed',
        'n_negative',
        'n_neutral',
        'n_positive',
        'n_questions',
        'n_unclear',
        'period',
        'topic_id'
      ]);
    }
  });

  it('дедупликация: одинаковые тексты учитываются один раз', () => {
    const msg = { text: 'Цены на лекарства выросли очень заметно', date: '2026-08-11' };
    const result = runCivicPipeline([msg, { ...msg }, { ...msg, date: '2026-09-11' }], opts);
    expect(result.stats.n_in).toBe(3);
    expect(result.stats.n_duplicates).toBe(2);
    expect(result.stats.n_after_dedup).toBe(1);
    expect(result.aggregates).toHaveLength(1);
    expect(result.aggregates[0]?.n_messages).toBe(1);
  });

  it('языковой фильтр: короткие и не-русские исключаются со счётчиками', () => {
    const result = runCivicPipeline(
      [
        { text: 'Да', date: '2026-08-01' },
        { text: 'The service is absolutely terrible here', date: '2026-08-01' },
        { text: 'Цены на жильё недоступны молодым семьям', date: '2026-08-01' }
      ],
      opts
    );
    expect(result.stats.n_short_excluded).toBe(1);
    expect(result.stats.n_other_language).toBe(1);
    expect(result.stats.n_after_language).toBe(1);
  });

  it('сообщения без темы или гео учитываются в stats, но не в агрегатах', () => {
    const result = runCivicPipeline(
      [
        { text: 'Погода сегодня просто чудесная совсем', date: '2026-08-01' },
        { text: 'Цены на бензин подорожали снова', date: '2026-08-01', geo_id: undefined }
      ],
      { topics: TOPICS }
    );
    expect(result.stats.n_no_topic).toBe(1);
    expect(result.stats.n_no_geo).toBe(1);
    expect(result.aggregates).toHaveLength(0);
  });

  it('PII: счётчики по видам попадают в stats, текст не сохраняется', () => {
    const result = runCivicPipeline(
      [{ text: 'Позвоните мне +7 912 345-67-89 насчёт тарифа ЖКХ пожалуйста', date: '2026-08-01' }],
      opts
    );
    expect(result.stats.pii_counts['phone']).toBe(1);
    expect(result.stats.pii_total).toBe(1);
    expect(result.pii_counts['phone']).toBe(1);
  });

  it('агрегаты согласованы: n_messages = сумма mix, вопросы считаются', () => {
    const result = runCivicPipeline(
      [
        { text: 'Когда поликлинику наконец откроют?', date: '2026-08-05' },
        { text: 'В поликлинике врач очень помог, спасибо!', date: '2026-08-06' },
        { text: 'Поликлиника в ужасном состоянии, очереди огромные', date: '2026-08-07' }
      ],
      opts
    );
    expect(result.aggregates.length).toBeGreaterThan(0);
    for (const a of result.aggregates) {
      expect(a.n_messages).toBe(a.n_positive + a.n_neutral + a.n_negative + a.n_mixed + a.n_unclear);
    }
    const withQuestions = result.aggregates.reduce((s, a) => s + a.n_questions, 0);
    expect(withQuestions).toBeGreaterThanOrEqual(1); // «Когда поликлинику откроют?» — вопрос
  });

  it('multi-label в агрегатах: сообщение попадает в обе темы', () => {
    const result = runCivicPipeline([{ text: 'Подорожали тарифы жкх опять заметно', date: '2026-08-01' }], opts);
    const ids = result.aggregates.map((a) => a.topic_id).sort();
    expect(ids).toEqual(['prices', 'utilities']);
  });

  it('периоды: stats.period_from/period_to по месяцам сообщений', () => {
    const result = runCivicPipeline(
      [
        { text: 'Цены на проезд подняли резко', date: '2026-05-02' },
        { text: 'Цены на проезд подняли снова', date: '2026-08-30' }
      ],
      opts
    );
    expect(result.stats.period_from).toBe('2026-05');
    expect(result.stats.period_to).toBe('2026-08');
  });
});
