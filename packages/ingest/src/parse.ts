/**
 * PARSE / CLASSIFY / EXTRACT — чистые функции над сырым HTML.
 *
 * Безопасность (malicious documents): парсинг только через регэкспы над
 * текстом с ограничением размера; скрипты/стили вырезаются; наружу отдаётся
 * только текст — HTML никогда не рендерится в UI (React экранирует).
 */

export interface ParsedPage {
  title: string | null;
  publishedAt: string | null;
  datePrecision: 'day' | 'month' | 'year' | null;
  text: string;
  links: string[];
}

export function extractTitle(html: string): string | null {
  const t =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i.exec(html) ??
    /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html) ??
    /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(html);
  if (!t) return null;
  return cleanText(stripTags(t[1] ?? '')) || null;
}

export function extractPublished(html: string): {
  date: string | null;
  precision: 'day' | 'month' | 'year' | null;
} {
  const meta =
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["'](\d{4}-\d{2}-\d{2})/i.exec(
      html
    );
  if (meta) return { date: meta[1] ?? null, precision: 'day' };
  const timeAttr = /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i.exec(html);
  if (timeAttr) return { date: timeAttr[1] ?? null, precision: 'day' };
  const ruDate = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(html);
  if (ruDate) {
    const [, d, m, y] = ruDate;
    return {
      date: `${y}-${(m ?? '01').padStart(2, '0')}-${(d ?? '01').padStart(2, '0')}`,
      precision: 'day'
    };
  }
  const yearOnly = /\b(20[0-9]{2})\b/.exec(html);
  if (yearOnly) return { date: `${yearOnly[1]}-01-01`, precision: 'year' };
  return { date: null, precision: null };
}

export function stripTags(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractText(html: string, maxChars = 4000): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const text = cleanText(stripTags(body ? (body[1] ?? '') : html));
  return text.slice(0, maxChars);
}

/** Ссылки того же хоста (для DISCOVER/обхода); абсолютные, нормализованные. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  const re = /<a[^>]+href=["']([^"'#\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue;
      u.hash = '';
      // Отрезаем query-мусор пагинации, сохраняем путь.
      out.add(u.toString());
    } catch {
      // некорректный href пропускаем
    }
  }
  return [...out];
}

export interface ClassifyRule {
  kind: string;
  keywords: string[];
}

export const CLASSIFY_RULES: ClassifyRule[] = [
  { kind: 'program', keywords: ['программ', 'манифест', 'устав'] },
  { kind: 'decision', keywords: ['решение', 'постановлен', 'протокол', 'бюро', 'фпк'] },
  { kind: 'statement', keywords: ['заявлен', 'обращение', 'воззвание'] },
  { kind: 'press_release', keywords: ['пресс-релиз', 'новост', 'news', 'пресс-служб'] },
  { kind: 'election', keywords: ['выбор', 'кандидат', 'избир', 'кампан'] },
  { kind: 'position', keywords: ['позиция', 'подход', 'предлагаем'] }
];

/**
 * CLASSIFY: вид документа по URL, заголовку и тексту.
 * Веса: заголовок и URL ×2 (надёжнее текста, где встречаются навигационные
 * слова), текст ×1. Страница-индекс: много ссылок, мало текста.
 */
export function classifyDoc(
  url: string,
  title: string | null,
  text: string,
  linksFound = 0
): string {
  if (linksFound >= 3 && text.length < 300) return 'index';
  const urlL = url.toLowerCase();
  const titleL = (title ?? '').toLowerCase();
  const textL = text.slice(0, 1200).toLowerCase();
  let best: { kind: string; score: number } = { kind: 'page', score: 0 };
  for (const rule of CLASSIFY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      score += 2 * countOccurrences(titleL, kw);
      score += 2 * countOccurrences(urlL, kw);
      score += countOccurrences(textL, kw);
    }
    if (score > best.score) best = { kind: rule.kind, score };
  }
  return best.kind;
}

function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
