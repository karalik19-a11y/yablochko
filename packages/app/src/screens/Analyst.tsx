import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, AnalystStatus, AnalystAnswer, VerifySourcesReport } from '@yabloko/api-contract';
import type { AnalystSourceRefT, VerifySourcesReportT } from '@yabloko/api-contract';
import { z } from 'zod';
import { postEnvelope } from '../api/client.js';
import { useApi } from '../api/hooks.js';

/**
 * YABLOKO ANALYST AI (Этап 13): ANSWER / EVIDENCE / SOURCES / UNCERTAINTY,
 * кнопка VERIFY SOURCES, prompt-injection defense. Категории FACT /
 * PARTY STATEMENT / ANALYSIS / MODEL не смешиваются. Без ключа LLM —
 * честный локальный degraded mode. AI не изобретает позиции партии.
 */

const BLOCK_BADGE: Record<string, { tone: 'accent' | 'violet' | 'info' | 'warn'; label: string }> = {
  FACT: { tone: 'accent', label: 'FACT' },
  PARTY_STATEMENT: { tone: 'violet', label: 'OFFICIAL PARTY STATEMENT' },
  ANALYSIS: { tone: 'info', label: 'ANALYSIS' },
  MODEL: { tone: 'warn', label: 'MODEL' }
};

const EXAMPLES = [
  'Сравни регионы',
  'Что изменилось?',
  'Какие темы выросли в медиа?',
  'Покажи источники',
  'Новые документы партии',
  'Исследование по поддержке инициатив',
  'Смоделируй сценарий'
];

function SourcesList({
  sources,
  onVerify,
  verifying,
  report
}: {
  sources: AnalystSourceRefT[];
  onVerify: () => void;
  verifying: boolean;
  report: VerifySourcesReportT | null;
}) {
  const ids = sources.map((s) => s.source_id);
  return (
    <div>
      {sources.map((s) => {
        const v = report?.items.find((i) => i.source_id === s.source_id);
        return (
          <div
            key={s.source_id}
            style={{ display: 'grid', gridTemplateColumns: '1.4fr auto', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'baseline' }}
          >
            <div className="small">
              <span style={{ fontWeight: 600 }}>{s.name ?? s.source_id}</span>
              <span className="faint mono"> · {s.source_id}</span>
              <div className="faint" style={{ marginTop: 2 }}>
                {v
                  ? v.found
                    ? v.checks.map((c) => `${c.check}:${c.result}`).join(' · ')
                    : 'NOT_FOUND в реестре'
                  : `статус ${s.status ?? '—'} · grade ${s.grade ?? '—'} · url ${s.url_present ? 'есть' : 'нет'} · checksum ${s.checksum_present ? 'есть' : 'нет'}`}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {s.grade && <Badge tone={s.grade === 'D' ? 'warn' : 'info'}>{s.grade}</Badge>}
              {s.status && <Badge tone={s.status === 'active' ? 'accent' : 'muted'}>{s.status}</Badge>}
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
        <button className="btn small" onClick={onVerify} disabled={verifying || ids.length === 0}>
          {verifying ? 'Проверка…' : 'VERIFY SOURCES'}
        </button>
        {report && (
          <span className="small faint">
            {report.summary.found}/{report.summary.total} найдено · с URL {report.summary.with_url} · с checksum{' '}
            {report.summary.with_checksum}
          </span>
        )}
      </div>
      {report && <div className="small faint" style={{ marginTop: 6 }}>{report.note}</div>}
    </div>
  );
}

export function AnalystScreen() {
  const status = useApi(API.analystStatus, AnalystStatus);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<z.infer<typeof AnalystAnswer> | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<z.infer<typeof VerifySourcesReport> | null>(null);

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3) {
      setAskError('Вопрос: минимум 3 символа');
      return;
    }
    setAsking(true);
    setAskError(null);
    setReport(null);
    try {
      const AskRequest = z.object({ question: z.string().min(3).max(500) });
      const parsed = AskRequest.safeParse({ question: text });
      if (!parsed.success) {
        setAskError('Вопрос: 3–500 символов');
        setAsking(false);
        return;
      }
      const data = await postEnvelope(API.analystAsk, parsed.data, AnalystAnswer);
      setAnswer(data);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Неизвестная ошибка запроса');
    } finally {
      setAsking(false);
    }
  };

  const verify = async () => {
    if (!answer) return;
    setVerifying(true);
    try {
      const data = await postEnvelope(
        API.analystVerify,
        { source_ids: answer.sources.map((s) => s.source_id) },
        VerifySourcesReport
      );
      setReport(data);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Ошибка проверки источников');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <div>
        <h2 className="section-title">YABLOKO ANALYST AI</h2>
        <div className="section-sub">
          Формат ответа: ANSWER / EVIDENCE / SOURCES / UNCERTAINTY. Ответ строится из данных системы через
          инструменты только для чтения; источники — только из Source Registry. Категории FACT / OFFICIAL PARTY
          STATEMENT / ANALYSIS / MODEL разведены. Запросы: «сравни регионы», «что изменилось», «какие темы выросли»,
          «покажи источники», «новые документы», «исследование по X», «смоделируй». Инъекции инструкций во внешнем
          контенте не исполняются. Позиции партии AI не изобретает.
        </div>
      </div>

      {status.status === 'loading' && <Skeleton h={70} />}
      {status.status === 'error' && (
        <ErrorBox message={`Статус аналитика недоступен: ${status.error}`} onRetry={status.reload} />
      )}
      {status.status === 'ready' && status.data && (
        <Panel title="ПРОВАЙДЕР МОДЕЛИ">
          <div className="row wrap" style={{ alignItems: 'center' }}>
            {status.data.degraded_mode ? (
              <Badge tone="warn">DEGRADED MODE</Badge>
            ) : (
              <Badge tone="accent">LLM АКТИВЕН</Badge>
            )}
            <span className="small">{status.data.providers.find((p) => p.id === status.data?.active_provider)?.label}</span>
          </div>
          <div className="small faint" style={{ marginTop: 6 }}>
            {status.data.degraded_reason}
          </div>
        </Panel>
      )}

      <Panel title="ВОПРОС АНАЛИТИКУ">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Например: сравни регионы по бедности…"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !asking) void ask(question);
            }}
            style={{ flex: 1 }}
          />
          <button className="btn small primary" onClick={() => void ask(question)} disabled={asking}>
            {asking ? 'Анализ…' : 'Спросить'}
          </button>
        </div>
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="btn small"
              onClick={() => {
                setQuestion(ex);
                void ask(ex);
              }}
              disabled={asking}
            >
              {ex}
            </button>
          ))}
        </div>
        {askError && (
          <div className="small" style={{ color: 'var(--danger, #c0392b)', marginTop: 8 }}>
            {askError}
          </div>
        )}
      </Panel>

      {asking && <Skeleton h={160} />}

      {answer && !asking && (
        <>
          <Panel title={`ANSWER — ${answer.intent}`}>
            <div className="small faint" style={{ marginBottom: 8 }}>
              Провайдер: {answer.provider_id} ({answer.provider_mode === 'llm' ? 'LLM, валидирован схемой' : 'локальный детерминированный'}) ·
              инструменты: {answer.tools_used.join(', ')}
            </div>
            {answer.blocks.map((b, i) => {
              const badge = BLOCK_BADGE[b.category] ?? BLOCK_BADGE['ANALYSIS']!;
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <div className="small" style={{ marginTop: 4 }}>{b.text}</div>
                </div>
              );
            })}
            {answer.injections_detected.length > 0 && (
              <div
                className="small"
                style={{ border: '1px solid var(--danger, #c0392b)', padding: 8, marginTop: 6 }}
              >
                <strong>Обнаружены попытки инъекции инструкций — они не исполняются:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {answer.injections_detected.map((h, i) => (
                    <li key={i}>
                      <span className="mono">{h.pattern_id}</span> — «…{h.excerpt}…»
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title={`EVIDENCE (${answer.evidence.length})`}>
            {answer.evidence.length === 0 ? (
              <EmptyState title="Недостаточно данных для подтверждения (INSUFFICIENT DATA)" />
            ) : (
              answer.evidence.map((e, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'baseline' }}>
                  <Badge tone={e.category === 'PARTY_STATEMENT' ? 'violet' : e.category === 'MODEL' ? 'warn' : 'accent'}>
                    {BLOCK_BADGE[e.category]?.label ?? e.category}
                  </Badge>
                  <div className="small">
                    {e.label}
                    <div className="faint">{e.value_text}</div>
                  </div>
                  <span className="mono small faint">{e.source_id}</span>
                </div>
              ))
            )}
          </Panel>

          <Panel title={`SOURCES (${answer.sources.length})`}>
            <SourcesList sources={answer.sources} onVerify={() => void verify()} verifying={verifying} report={report} />
          </Panel>

          <Panel title="UNCERTAINTY">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {answer.uncertainty.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      {!answer && !asking && (
        <Panel title="КАК ЭТО РАБОТАЕТ">
          <EmptyState
            title="Задайте вопрос — ответ соберётся из данных платформы"
            note="Локальный режим: цифры только из подключённых инструментов (метрики, документы, источники, медиатемы, сценарии). LLM-провайдер подключается через ANALYST_LLM_* env; без ключа качество честно помечено DEGRADED MODE."
          />
        </Panel>
      )}
    </>
  );
}
