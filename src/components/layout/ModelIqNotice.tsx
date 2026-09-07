import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  MODEL_FAMILIES, EFFORTS, combineRadarPoints, normalizeRadarCost,
  createRadarScale, loadRadarData, radarMetricValue,
  type RadarData, type RadarMetric, type RadarMode, type RadarPoint,
} from '@/features/modelIq/radar';
import styles from './ModelIqNotice.module.scss';

const W = 1200, H = 470, LEFT = 66, RIGHT = 34, TOP = 30, BOTTOM = 62;
const formatNumber = (v: number) => v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1)
  : v >= 0.01 ? v.toFixed(2) : v.toPrecision(2);
const keyOf = (p: RadarPoint) => `${p.model}|${p.effort}`;

function Marker({ effort }: { effort: string }) {
  switch (effort) {
    case 'medium': return <path d="M0 -7 L7 6 L-7 6 Z" />;
    case 'high': return <rect x="-5.5" y="-5.5" width="11" height="11" rx="0.5" />;
    case 'xhigh': return <path d="M0 -7 L7 0 L0 7 L-7 0 Z" />;
    case 'max': return <path d="M0 -7 L6 -3.5 L6 3.5 L0 7 L-6 3.5 L-6 -3.5 Z" />;
    case 'ultra': return <path d="M0 -8 L2.4 -2.5 L8 -2.5 L3.8 1.2 L5 7 L0 3.8 L-5 7 L-3.8 1.2 L-8 -2.5 L-2.4 -2.5 Z" />;
    default: return <circle r="5.5" />;
  }
}

function RadarChart({ points, metric }: { points: RadarPoint[]; metric: RadarMetric }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const plotted = points.filter(p => (radarMetricValue(p, metric) ?? 0) > 0);
  const scale = createRadarScale(plotted.map(p => radarMetricValue(p, metric)!));
  const yMax = Math.max(20, Math.ceil(Math.max(...plotted.map(p => p.iq), 0) / 20) * 20);
  const x = (p: RadarPoint) => LEFT + scale.position(radarMetricValue(p, metric)!) * (W - LEFT - RIGHT);
  const y = (p: RadarPoint) => TOP + (1 - p.iq / yMax) * (H - TOP - BOTTOM);
  const current = plotted.find(p => keyOf(p) === selected);
  const family = MODEL_FAMILIES.find(f => f.id === current?.model);
  if (!plotted.length) return <div className={styles.state}>{t('model_iq.no_points')}</div>;
  return <div className={styles.chartScroll}>
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-label={t('model_iq.chart_label')} role="group">
        {Array.from({ length: yMax / 20 + 1 }, (_, i) => i * 20).map(value => {
          const at = TOP + (1 - value / yMax) * (H - TOP - BOTTOM);
          return <g key={value} className={styles.grid}>
            <line x1={LEFT} x2={W - RIGHT} y1={at} y2={at} />
            <text x={LEFT - 12} y={at + 4} textAnchor="end">{value}</text>
          </g>;
        })}
        {scale.ticks.map(value => {
          const at = LEFT + scale.position(value) * (W - LEFT - RIGHT);
          return <g key={value} className={styles.grid}>
            <line x1={at} x2={at} y1={TOP} y2={H - BOTTOM} />
            <text x={at} y={H - BOTTOM + 24} textAnchor="middle">{metric === 'price' ? '$' : ''}{formatNumber(value)}</text>
          </g>;
        })}
        <path className={styles.axis} d={`M${LEFT} ${TOP} V${H - BOTTOM} H${W - RIGHT}`} />
        {scale.broken && <path className={styles.axis} d={`M${LEFT + (W - LEFT - RIGHT) * .07 - 6} ${H - BOTTOM + 5} l6 -10 m0 10 l6 -10`} />}
        {MODEL_FAMILIES.map((f, familyIndex) => {
          const series = plotted.filter(p => p.model === f.id).sort((a, b) =>
            EFFORTS.indexOf(a.effort as typeof EFFORTS[number]) - EFFORTS.indexOf(b.effort as typeof EFFORTS[number]));
          return <g key={f.id} style={{ color: f.color }} aria-label={f.label}>
            <path className={styles.series} d={series.map((p, i) => `${i ? 'L' : 'M'}${x(p)} ${y(p)}`).join(' ')} />
            {series.map((p, index) => <g key={keyOf(p)} transform={`translate(${x(p)}, ${y(p)})`}
              className={styles.point} tabIndex={0} role="button"
              aria-label={`${f.label} ${p.effort}, IQ ${p.iq.toFixed(1)}, ${t(`model_iq.axis_${metric}`)} ${formatNumber(radarMetricValue(p, metric)!)}`}
              onMouseEnter={() => setSelected(keyOf(p))} onMouseLeave={() => setSelected(null)}
              onFocus={() => setSelected(keyOf(p))} onBlur={() => setSelected(null)}
              onClick={() => setSelected(keyOf(p))}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(keyOf(p)); } }}>
              <circle r="13" className={styles.hitTarget} />
              <g className={styles.marker}><Marker effort={p.effort} /></g>
              <text className={styles.pointLabel} textAnchor="middle" y={(familyIndex + index) % 2 ? 21 : -12}>{p.effort}</text>
            </g>)}
          </g>;
        })}
        <text className={styles.axisLabel} x={(LEFT + W - RIGHT) / 2} y={H - 10} textAnchor="middle">{t(`model_iq.axis_${metric}`)}</text>
        <text className={styles.axisLabel} transform={`translate(18 ${(TOP + H - BOTTOM) / 2}) rotate(-90)`} textAnchor="middle">IQ</text>
      </svg>
      {current && <div className={styles.tooltip} role="tooltip" style={{
        left: `${Math.min(74, Math.max(2, x(current) / W * 100))}%`,
        top: `${Math.min(60, Math.max(2, y(current) / H * 100 + 5))}%`,
        '--series-color': family?.color,
      } as CSSProperties}>
        <strong>{family?.label} <span>{current.effort}</span></strong>
        <div className={styles.tooltipIq}>IQ {current.iq.toFixed(1)}</div>
        <dl>
          <dt>{t('model_iq.price')}</dt><dd>{current.price === null ? '—' : `$${current.price.toFixed(2)}`}</dd>
          <dt>{t('model_iq.minutes')}</dt><dd>{current.minutes === null ? '—' : `${current.minutes.toFixed(1)} ${t('model_iq.min')}`}</dd>
          <dt>{t('model_iq.cost')}</dt><dd>{current.cost === null ? '—' : formatNumber(current.cost)}</dd>
          <dt>{t('model_iq.samples')}</dt><dd>{current.samples}</dd>
          {current.softwareIq !== undefined && <><dt>{t('model_iq.software')}</dt><dd>{current.softwareIq.toFixed(1)} IQ</dd></>}
          {current.visualIq !== undefined && <><dt>{t('model_iq.visual')}</dt><dd>{current.visualIq.toFixed(1)} IQ</dd></>}
        </dl>
        <small>{current.model}</small>
      </div>}
    </div>
  </div>;
}

export function ModelIqNotice() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RadarData | null>(null);
  const [mode, setMode] = useState<RadarMode>('composite');
  const [metric, setMetric] = useState<RadarMetric>('cost');
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(false);
    void loadRadarData(controller.signal, request > 0).then(result => {
      if (active) setData(result);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, request]);
  const points = useMemo(() => !data ? [] : normalizeRadarCost(mode === 'composite'
    ? combineRadarPoints(data.software.points, data.visual.points) : data[mode].points), [data, mode]);
  const timestamps = data ? (mode === 'composite'
    ? [data.software.updatedAt, data.visual.updatedAt] : [data[mode].updatedAt]) : [];
  const dated = timestamps.filter((v): v is string => v !== null).map(Date.parse);
  const updatedAt = dated.length === timestamps.length && dated.length ? Math.min(...dated) : null;
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={t('model_iq.title')}
      aria-label={t('model_iq.title')} aria-haspopup="dialog" aria-expanded={open}>
      <span className={styles.iqIcon} aria-hidden="true">IQ</span>
    </Button>
    <Modal open={open} onClose={() => setOpen(false)} title={t('model_iq.title')}
      width="min(1380px, calc(100vw - 40px))" className={styles.modal}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label={t('model_iq.benchmark')}>
          {(['composite', 'software', 'visual'] as const).map(value => <button key={value}
            type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{t(`model_iq.${value}`)}</button>)}
        </div>
        <div className={styles.source}>
          {updatedAt !== null && <time dateTime={new Date(updatedAt).toISOString()}>{t('model_iq.updated', {
            time: new Date(updatedAt).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          })}</time>}
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRequest(v => v + 1)}>{t(loading ? 'model_iq.loading' : 'model_iq.refresh')}</Button>
          <a href="https://codexradar.com/" target="_blank" rel="noreferrer">{t('model_iq.source')} ↗</a>
        </div>
      </div>
      {data?.recommendations?.length ? <div className={styles.recommendations}>
        {data.recommendations.slice(0, 4).map((rec, index) => <section key={rec.key} className={styles.recommendation} style={{ '--recommendation-color': MODEL_FAMILIES[index]?.color ?? '#7b9fff' } as CSSProperties}>
          <h3>{rec.title}<span>i</span></h3><div className={styles.recommendationHeader}><b>{t('model_iq.model')}</b><b>IQ</b><b>{t('model_iq.minutes')}</b><b>{t('model_iq.price')}</b></div>
          {rec.items.slice(0, 2).map(item => <div className={styles.recommendationRow} key={`${item.model}-${item.effort}`}><strong>{MODEL_FAMILIES.find(f => f.id === item.model)?.label ?? item.model} {item.effort}</strong><b>{Math.round(item.iq)}</b><span>{item.average_duration_minutes?.toFixed(0) ?? '—'} {t('model_iq.min')}</span><b>${item.average_cost_usd?.toFixed(2) ?? '—'}</b></div>)}
        </section>)}
      </div> : null}
      <div className={styles.panel} aria-busy={loading}>
        <div className={styles.chartHeading}>
          <strong>{t(`model_iq.axis_${metric}`)} × IQ</strong>
          <label><span>{t('model_iq.metric')}</span><select value={metric} onChange={e => setMetric(e.target.value as RadarMetric)}>
            {(['cost', 'price', 'minutes'] as const).map(value => <option key={value} value={value}>{t(`model_iq.axis_${value}`)} × IQ</option>)}
          </select></label>
          <span className={styles.hint}>{t('model_iq.efficient')}</span>
        </div>
        <div className={styles.legend}>
          {MODEL_FAMILIES.map(f => <span key={f.id}><i style={{ background: f.color }} />{f.label}</span>)}
        </div>
        {error && <div role="alert" className={styles.error}>{t(data ? 'model_iq.stale' : 'model_iq.error')}</div>}
        {!data ? <div className={styles.state} role="status">{t(error ? 'model_iq.retry_hint' : 'model_iq.loading')}</div>
          : <RadarChart key={`${mode}-${metric}`} points={points} metric={metric} />}
        <p className={styles.note}>{t(mode === 'composite' ? 'model_iq.composite_note' : 'model_iq.note')} {t('model_iq.hover')}</p>
        {metric === 'cost' && <p className={styles.formula}>{t('model_iq.formula')}</p>}
      </div>
      {!!points.length && <details className={styles.tableDetails}>
        <summary>{t('model_iq.table')}</summary>
        <div className={styles.cardsScroll}><div className={styles.cards}>
          {MODEL_FAMILIES.flatMap(f => [...EFFORTS].reverse().map(effort => {
            const p = points.find(p => p.model === f.id && p.effort === effort);
            return <div key={`${f.id}-${effort}`} className={p ? styles.card : styles.emptyCard}
              style={{ '--series-color': f.color } as CSSProperties}>
              {p && <><div className={styles.cardScore}><span>{f.label} {effort}</span><strong>{Math.round(p.iq)}</strong></div>
                <div className={styles.cardCost}><b>{p.price === null ? '—' : `$${p.price.toFixed(2)}`}</b><b>{p.minutes === null ? '—' : `${Math.round(p.minutes)} ${t('model_iq.min')}`}</b></div></>}
            </div>;
          }))}
        </div></div>
      </details>}
    </Modal>
  </>;
}
