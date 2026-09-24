import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedGeography,
  loadRfGeoFile,
  getGeoTree,
  getGeoChildren,
  getGeoPath,
  searchGeo,
  buildSubjectMap,
  geoCountsByLevel,
  mergeGeo,
  getGeoNode
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');

function seededDb() {
  const db = openDb(':memory:');
  migrate(db);
  const rf = loadRfGeoFile(rfPath);
  seedGeography(db, rf);
  return { db, rf };
}

describe('geography seed', () => {
  it('полный справочник: 1 страна, 8 ФО, 89 субъектов', () => {
    const { db } = seededDb();
    const counts = geoCountsByLevel(db);
    expect(counts['country']).toBe(1);
    expect(counts['federal_district']).toBe(8);
    expect(counts['subject']).toBe(89);
  });

  it('idempotency: повторный seed не меняет geo_id и не дублирует строки', () => {
    const { db, rf } = seededDb();
    const before = db
      .prepare(`SELECT geo_id, name FROM geography WHERE level = 'subject' ORDER BY geo_id`)
      .all() as Array<{ geo_id: string; name: string }>;
    seedGeography(db, rf);
    const after = db
      .prepare(`SELECT geo_id, name FROM geography WHERE level = 'subject' ORDER BY geo_id`)
      .all() as Array<{ geo_id: string; name: string }>;
    expect(after).toEqual(before);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM geography`).get() as { n: number };
    expect(Number(total.n)).toBe(1 + 8 + 89 + 12); // страна + ФО + субъекты + пилотный муниципальный слой
  });

  it('переименование сохраняет stable geo_id (ADR-0008)', () => {
    const { db, rf } = seededDb();
    // Переименование региона в источнике: та же запись с новым именем
    const modified = JSON.parse(JSON.stringify(rf));
    modified.subjects.find((s: { geo_id: string }) => s.geo_id === 'ru:subject:psk').name =
      'Псковская область (новое наименование)';
    seedGeography(db, modified);
    const node = getGeoNode(db, 'ru:subject:psk');
    expect(node?.name).toContain('новое наименование');
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM geography WHERE geo_id = 'ru:subject:psk'`)
      .get() as { n: number };
    expect(Number(count.n)).toBe(1);
  });

  it('иерархия: у каждого субъекта родитель — существующий ФО', () => {
    const { db } = seededDb();
    const orphan = db
      .prepare(
        `SELECT s.geo_id FROM geography s
         LEFT JOIN geography f ON f.geo_id = s.parent_id
         WHERE s.level = 'subject' AND (f.geo_id IS NULL OR f.level != 'federal_district')`
      )
      .all() as unknown[];
    expect(orphan).toHaveLength(0);
    // Пилотные муниципалитеты ссылаются на существующие субъекты
    const orphanMun = db
      .prepare(
        `SELECT m.geo_id FROM geography m
         LEFT JOIN geography p ON p.geo_id = m.parent_id
         WHERE m.level IN ('municipality','city','district') AND p.geo_id IS NULL`
      )
      .all() as unknown[];
    expect(orphanMun).toHaveLength(0);
  });

  it('картограмма: 89 уникальных ячеек без пересечений', () => {
    const { db } = seededDb();
    const fc = buildSubjectMap(db);
    expect(fc.kind).toBe('cartogram');
    expect(fc.features).toHaveLength(89);
    const cells = new Set<string>();
    for (const f of fc.features) {
      const [first] = f.geometry.coordinates[0] as Array<[number, number]>;
      const x0 = first?.[0];
      const y1 = first?.[1];
      cells.add(`${x0}:${y1}`);
    }
    expect(cells.size).toBe(89);
    expect(fc.methodology).toContain('НЕ географические');
  });

  it('drill-down: ФО содержит своих субъектов; хлебные крошки корректны', () => {
    const { db } = seededDb();
    const szfo = getGeoChildren(db, 'ru:fd:szfo');
    expect(szfo.length).toBe(11);
    expect(szfo.some((s) => s.geo_id === 'ru:subject:psk')).toBe(true);

    const path = getGeoPath(db, 'ru:municipality:pskovsky');
    expect(path.map((p) => p.level)).toEqual(['country', 'federal_district', 'subject', 'municipality']);
  });

  it('поиск: «Псков» находит область и город', () => {
    const { db } = seededDb();
    const hits = searchGeo(db, 'Псков');
    expect(hits.some((h) => h.geo_id === 'ru:subject:psk')).toBe(true);
    expect(hits.some((h) => h.geo_id === 'ru:municipality:psk-city')).toBe(true);
  });

  it('getGeoTree: сумма субъектов по ФО = 89', () => {
    const { db } = seededDb();
    const tree = getGeoTree(db);
    const sum = tree.districts.reduce((acc, d) => acc + d.subjects, 0);
    expect(sum).toBe(89);
    expect(tree.totalSubjects).toBe(89);
  });

  it('слияние: старый ID деактивируется, запись geo_merges создаётся', () => {
    const { db } = seededDb();
    mergeGeo(db, {
      from_geo_id: 'ru:municipality:porhovsky',
      to_geo_id: 'ru:municipality:pskovsky',
      note: 'тест слияния'
    });
    expect(getGeoNode(db, 'ru:municipality:porhovsky')?.is_active).toBe(0);
    const merges = db.prepare(`SELECT COUNT(*) AS n FROM geo_merges`).get() as { n: number };
    expect(Number(merges.n)).toBe(1);
  });
});
