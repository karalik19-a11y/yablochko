import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  loadOsintGraph,
  seedOsintGraph,
  getOsintGraph,
  getOsintProfile,
  searchOsintEntities
} from './index.js';

const partyDir = resolve(process.cwd(), 'datasets/party');
const osintPath = resolve(process.cwd(), 'datasets/osint/osint_graph.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedOsintGraph(db, loadOsintGraph(osintPath));
  return db;
}

describe('seed OSINT-графа', () => {
  it('3 публичные сущности (2 персоны + организация), 6 evidence-рёбер', () => {
    const db = fullDb();
    const g = getOsintGraph(db, 'test');
    expect(g.entities).toHaveLength(3);
    expect(g.entities.filter((e) => e.kind === 'person')).toHaveLength(2);
    expect(g.edges).toHaveLength(6);
    // все персоны имеют публичную роль
    for (const p of g.entities.filter((e) => e.kind === 'person')) {
      expect(p.public_role).not.toBeNull();
      expect(p.public_role!.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('idempotency: повторный сид не дублирует', () => {
    const db = fullDb();
    seedOsintGraph(db, loadOsintGraph(osintPath));
    const g = getOsintGraph(db, 'test');
    expect(g.entities).toHaveLength(3);
    expect(g.edges).toHaveLength(6);
  });
});

describe('DoD: рёбра без evidence невозможны', () => {
  it('NOT NULL + CHECK: пустой/короткий evidence отклоняется схемой', () => {
    const db = fullDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad1', 'osint-pers-rybakov', 'associated_with', 'osint-org-yabloko', NULL, 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad2', 'osint-pers-rybakov', 'associated_with', 'osint-org-yabloko', 'abc', 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // evidence-source обязателен
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad3', 'osint-pers-rybakov', 'associated_with', 'osint-org-yabloko', 'достаточно длинное доказательство', NULL, 'x', 'x')`
        )
        .run()
    ).toThrow();
  });

  it('CHECK: ровно один dst; member_of требует entity-dst; published требует документ/заявление', () => {
    const db = fullDb();
    // два dst сразу
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, dst_document_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad4', 'osint-org-yabloko', 'associated_with', 'osint-pers-rybakov', 'osint-doc-program-2026', 'длинное доказательство связи', 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // member_of без entity
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_document_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad5', 'osint-pers-rybakov', 'member_of', 'osint-doc-program-2026', 'длинное доказательство связи', 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // published без документа/заявления
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, evidence, evidence_source_id, created_at, updated_at)
           VALUES ('bad6', 'osint-org-yabloko', 'published', 'osint-pers-rybakov', 'длинное доказательство связи', 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // все 6 реальных рёбер имеют evidence-источник из реестра
    const orphan = db
      .prepare(
        `SELECT COUNT(*) AS n FROM osint_edges e LEFT JOIN sources s ON s.source_id = e.evidence_source_id
         WHERE s.source_id IS NULL OR length(e.evidence) < 5`
      )
      .get() as { n: number };
    expect(orphan.n).toBe(0);
  });
});

describe('DoD: приватные лица не вносятся', () => {
  it('CHECK kind=person требует public_role ≥ 3 символов', () => {
    const db = fullDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_entities (entity_id, kind, name, public_role, source_id, created_at, updated_at)
           VALUES ('priv-1', 'person', 'Иван Частный', NULL, 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_entities (entity_id, kind, name, public_role, source_id, created_at, updated_at)
           VALUES ('priv-2', 'person', 'Иван Частный', 'ж', 'initial-context', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // организация без роли — можно
    expect(() =>
      db
        .prepare(
          `INSERT INTO osint_entities (entity_id, kind, name, public_role, source_id, created_at, updated_at)
           VALUES ('org-test', 'organization', 'Тестовая организация', NULL, 'initial-context', 'x', 'x')`
        )
        .run()
    ).not.toThrow();
  });

  it('страж набора данных: в сиде нет сторонников/противников и электоральных полей', () => {
    const raw = JSON.stringify(loadOsintGraph(osintPath)).toLowerCase();
    for (const banned of ['supporter', 'opponent', 'vote_probability', 'electoral_score', 'loyalist']) {
      expect(raw).not.toContain(banned);
    }
    const db = fullDb();
    const cols = (db.prepare(`PRAGMA table_info(osint_entities)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('stance');
    expect(cols).not.toContain('support_level');
  });
});

describe('профиль и поиск', () => {
  it('профиль Рыбакова: IDENTITY/AFFILIATIONS/STATEMENTS/TIMELINE/SOURCES заполнены', () => {
    const db = fullDb();
    const g = getOsintGraph(db, 'методология тест');
    const p = getOsintProfile(db, 'osint-pers-rybakov', g.privacy_note);
    expect(p).not.toBeNull();
    expect(p!.identity.kind).toBe('person');
    expect(p!.identity.public_role).toContain('Председатель');
    expect(p!.affiliations.length).toBeGreaterThanOrEqual(2); // member_of + mentioned
    expect(p!.affiliations.every((a) => a.evidence.length >= 5)).toBe(true);
    expect(p!.timeline.length).toBeGreaterThanOrEqual(1);
    // хронология отсортирована
    const dates = p!.timeline.map((t) => t.date ?? '9999');
    expect([...dates].sort()).toEqual(dates);
    // sources: initial-context используется
    expect(p!.sources.some((s) => s.source_id === 'initial-context')).toBe(true);
    expect(p!.privacy_note).toContain('Приватные лица');
  });

  it('профиль несуществующей сущности → null; поиск по имени и роли', () => {
    const db = fullDb();
    expect(getOsintProfile(db, 'nope', '')).toBeNull();
    const byName = searchOsintEntities(db, 'рыбаков');
    expect(byName).toHaveLength(1);
    expect(byName[0]?.entity_id).toBe('osint-pers-rybakov');
    const byRole = searchOsintEntities(db, 'политического комит');
    expect(byRole.map((e) => e.entity_id)).toContain('osint-pers-yavlinsky');
    expect(searchOsintEntities(db, '')).toHaveLength(0);
  });

  it('граф: рёбра published/participated_in/resolved корректно разведены по dst-типам', () => {
    const db = fullDb();
    const g = getOsintGraph(db, 'x');
    expect(g.edges.filter((e) => e.relation === 'published')).toHaveLength(2);
    expect(g.edges.filter((e) => e.relation === 'published').every((e) => e.dst_document_id !== null)).toBe(true);
    expect(g.edges.filter((e) => e.relation === 'participated_in').every((e) => e.dst_event_id !== null)).toBe(true);
    expect(g.edges.filter((e) => e.relation === 'member_of').every((e) => e.dst_entity_id === 'osint-org-yabloko')).toBe(true);
    expect(g.documents).toHaveLength(2);
    expect(g.events).toHaveLength(1);
  });
});
