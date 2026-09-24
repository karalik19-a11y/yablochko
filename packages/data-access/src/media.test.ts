import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  seedGeography,
  loadRfGeoFile,
  loadCivicTopics,
  seedCivicTopics,
  loadMediaFile,
  seedMedia,
  getMediaMentions,
  getMediaTopics,
  getMediaTrend,
  getMediaOutlets,
  getMediaClaims,
  MEDIA_SENTIMENT_METHODOLOGY_FALLBACK
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const topicsPath = resolve(process.cwd(), 'datasets/civic/topics.json');
const mediaPath = resolve(process.cwd(), 'datasets/media/media.json');
const SOURCE = 'synthetic-media';

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  seedCivicTopics(db, loadCivicTopics(topicsPath));
  seedMedia(db, loadMediaFile(mediaPath), { sourceId: SOURCE });
  return db;
}

describe('seed медиа-корпуса', () => {
  it('8 фиктивных изданий, 185 публикаций, все SYNTHETIC/UNVERIFIED', () => {
    const db = fullDb();
    const outlets = getMediaOutlets(db);
    expect(outlets).toHaveLength(8);
    expect(outlets.every((o) => o.name.startsWith('SYNTHETIC-ИЗДАНИЕ'))).toBe(true);
    expect(outlets.reduce((a, o) => a + o.articles, 0)).toBe(185);
    const flags = db
      .prepare(`SELECT COUNT(*) AS n FROM media_articles WHERE data_mode != 'SYNTHETIC' OR verification_status != 'UNVERIFIED'`)
      .get() as { n: number };
    expect(flags.n).toBe(0);
  });

  it('idempotency: повторный сид не дублирует', () => {
    const db = fullDb();
    seedMedia(db, loadMediaFile(mediaPath), { sourceId: SOURCE });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM media_articles').get() as { n: number }).n;
    expect(n).toBe(185);
  });
});

describe('DoD: ярлык без методологической сноски невозможен', () => {
  it('CHECK: mention_context без sentiment_methodology отклоняется схемой', () => {
    const db = fullDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO media_articles (article_id, outlet_id, title, published_at, mentions_yabloko,
           mention_context, sentiment_methodology, source_id, created_at, updated_at)
           VALUES ('bad-ctx', 'syn-outlet-01', 'Тестовая публикация без методологии', '2026-08-01', 1,
           'negative', NULL, 'synthetic-media', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // короткая методология (<20) тоже отклоняется
    expect(() =>
      db
        .prepare(
          `INSERT INTO media_articles (article_id, outlet_id, title, published_at, mentions_yabloko,
           mention_context, sentiment_methodology, source_id, created_at, updated_at)
           VALUES ('bad-ctx2', 'syn-outlet-01', 'Тест с короткой сноской', '2026-08-01', 1,
           'negative', 'коротко', 'synthetic-media', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // статья БЕЗ ярлыка — сноска не обязательна
    expect(() =>
      db
        .prepare(
          `INSERT INTO media_articles (article_id, outlet_id, title, published_at, mentions_yabloko,
           mention_context, sentiment_methodology, source_id, created_at, updated_at)
           VALUES ('ok-1', 'syn-outlet-01', 'Публикация без ярлыка', '2026-08-01', 0,
           NULL, NULL, 'synthetic-media', 'x', 'x')`
        )
        .run()
    ).not.toThrow();
  });

  it('в сиде каждая статья с mention_context несёт методологию (≥20 символов)', () => {
    const db = fullDb();
    const bad = db
      .prepare(
        `SELECT COUNT(*) AS n FROM media_articles
         WHERE mention_context IS NOT NULL AND (sentiment_methodology IS NULL OR length(sentiment_methodology) < 20)`
      )
      .get() as { n: number };
    expect(bad.n).toBe(0);
    const withCtx = db
      .prepare(`SELECT COUNT(*) AS n FROM media_articles WHERE mention_context IS NOT NULL`)
      .get() as { n: number };
    expect(withCtx.n).toBeGreaterThan(0);
    // методология — это lexicon-v1 (не произвольный текст)
    const sample = db
      .prepare(`SELECT sentiment_methodology FROM media_articles WHERE mention_context IS NOT NULL LIMIT 1`)
      .get() as { sentiment_methodology: string };
    expect(sample.sentiment_methodology).toContain('media-sentiment/lexicon-v1');
  });
});

describe('чтение: mentions / topics / trend / sources', () => {
  it('mentions: окно 12 мес, фильтр по теме и onlyMentions, split согласован с mentions', () => {
    const db = fullDb();
    const m = getMediaMentions(db, { months: 12 }, 'test');
    expect(m.total).toBeGreaterThan(0);
    expect(m.mentions).toBe(m.items.filter((i) => i.mentions_yabloko).length);
    const splitSum = m.context_split.positive + m.context_split.neutral + m.context_split.negative + m.context_split.unclear;
    expect(splitSum).toBe(m.mentions);
    const peace = getMediaMentions(db, { months: 12, topicId: 'peace' }, 'test');
    expect(peace.items.every((i) => i.topic_id === 'peace')).toBe(true);
    const only = getMediaMentions(db, { months: 12, onlyMentions: true }, 'test');
    expect(only.items.every((i) => i.mentions_yabloko)).toBe(true);
  });

  it('topics: согласованность сумм со списком статей; доля негатива 0..100', () => {
    const db = fullDb();
    const t = getMediaTopics(db, { months: 12 }, 'test');
    expect(t.items.length).toBeGreaterThan(5);
    expect(t.items.reduce((a, r) => a + r.articles, 0)).toBe(t.total_articles);
    expect(t.items.reduce((a, r) => a + r.mentions, 0)).toBe(t.total_mentions);
    for (const r of t.items) {
      if (r.neg_share_pct !== null) {
        expect(r.neg_share_pct).toBeGreaterThanOrEqual(0);
        expect(r.neg_share_pct).toBeLessThanOrEqual(100);
      }
    }
    // сортировка по убыванию статей
    const arts = t.items.map((r) => r.articles);
    expect([...arts].sort((a, b) => b - a)).toEqual(arts);
  });

  it('trend: помесячные точки, share_pct = mentions/articles', () => {
    const db = fullDb();
    const tr = getMediaTrend(db, { months: 21, endPeriod: '2026-09' }, 'test');
    expect(tr.points.length).toBeGreaterThanOrEqual(18);
    for (const p of tr.points) {
      expect(p.share_pct).toBeCloseTo((p.mentions / p.articles) * 100, 5);
      expect(p.share_pct).toBeLessThanOrEqual(100);
    }
    // хронология возрастает
    const periods = tr.points.map((p) => p.period);
    expect([...periods].sort()).toEqual(periods);
  });

  it('outlets: статьи и упоминания сходятся; claims категоризированы', () => {
    const db = fullDb();
    const outlets = getMediaOutlets(db);
    const totalArticles = outlets.reduce((a, o) => a + o.articles, 0);
    expect(totalArticles).toBe(185);
    expect(outlets.every((o) => o.mentions <= o.articles)).toBe(true);
    const claims = getMediaClaims(db);
    expect(claims).toHaveLength(3);
    for (const c of claims) {
      expect(['party_statement', 'external_claim', 'unverified_claim']).toContain(c.claim_category);
    }
  });

  it('фильтр по заголовку (кириллица, JS-фильтр) работает', () => {
    const db = fullDb();
    const m = getMediaMentions(db, { months: 21, endPeriod: '2026-09', q: 'ЖКХ' }, 'test');
    expect(m.items.length).toBeGreaterThan(0);
    expect(m.items.every((i) => i.title.toLowerCase().includes('жкх'))).toBe(true);
  });

  it('FALLBACK-методология содержит lexicon-v1', () => {
    expect(MEDIA_SENTIMENT_METHODOLOGY_FALLBACK).toContain('media-sentiment/lexicon-v1');
  });
});
