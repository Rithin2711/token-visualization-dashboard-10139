import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

/**
 * Fix chart import/build issues:
 * Some @mui/x-charts versions encourage importing from the package root.
 * This keeps the app building across minor version variations.
 */
import { LineChart } from '@mui/x-charts';

/**
 * @typedef {'hourly'|'weekly'|'monthly'} RangeKey
 */

const RANGE_OPTIONS = /** @type {{key: RangeKey, label: string, description: string}[]} */ ([
  { key: 'hourly', label: 'Hourly', description: 'Most recent hourly points' },
  { key: 'weekly', label: 'Weekly', description: 'Aggregated by day (last 7 days)' },
  { key: 'monthly', label: 'Monthly', description: 'Aggregated by day (last 30 days)' },
]);

/**
 * Convert an ISO timestamp into a short label suitable for an hourly axis.
 * Example: "14:00"
 */
function formatHourLabel(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Convert an ISO timestamp into a short date label suitable for daily aggregation.
 * Example: "Jan 05"
 */
function formatDayLabel(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: '2-digit' });
}

/**
 * Convert a timestamp into a stable "day bucket" key: YYYY-MM-DD (UTC).
 */
function toUtcDayKey(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse YYYY-MM-DD to an ISO-like timestamp for labeling/sorting.
 */
function fromUtcDayKeyToIso(dayKey) {
  if (!dayKey) return '';
  // Treat as UTC midnight
  return `${dayKey}T00:00:00.000Z`;
}

/**
 * Return a slice of points limited to the requested range.
 * For hourly: keep as-is.
 * For weekly/monthly: last 7/30 days based on the newest timestamp.
 */
function limitPointsByRange(points, rangeKey) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (rangeKey === 'hourly') return points;

  const last = points[points.length - 1];
  const lastTs = new Date(last.timestamp);
  if (Number.isNaN(lastTs.getTime())) return points;

  const windowDays = rangeKey === 'weekly' ? 7 : 30;
  const windowStart = new Date(lastTs.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);

  return points.filter((p) => {
    const ts = new Date(p.timestamp);
    if (Number.isNaN(ts.getTime())) return false;
    return ts >= windowStart && ts <= lastTs;
  });
}

/**
 * Aggregate token points by day (UTC). Sums input/output per day.
 */
function aggregateTokensByDay(points) {
  /** @type {Map<string, {timestamp: string, input_tokens: number, output_tokens: number}>} */
  const byDay = new Map();

  for (const p of points) {
    const key = toUtcDayKey(p.timestamp);
    if (!key) continue;

    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, {
        timestamp: fromUtcDayKeyToIso(key),
        input_tokens: Number(p.input_tokens) || 0,
        output_tokens: Number(p.output_tokens) || 0,
      });
    } else {
      existing.input_tokens += Number(p.input_tokens) || 0;
      existing.output_tokens += Number(p.output_tokens) || 0;
    }
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

/**
 * Aggregate cost points by day (UTC). Sums total_cost_usd per day.
 */
function aggregateCostByDay(points) {
  /** @type {Map<string, {timestamp: string, total_cost_usd: number}>} */
  const byDay = new Map();

  for (const p of points) {
    const key = toUtcDayKey(p.timestamp);
    if (!key) continue;

    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, {
        timestamp: fromUtcDayKeyToIso(key),
        total_cost_usd: Number(p.total_cost_usd) || 0,
      });
    } else {
      existing.total_cost_usd += Number(p.total_cost_usd) || 0;
    }
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

function getBackendBaseUrl() {
  // CRA exposes env vars prefixed with REACT_APP_
  return (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
}

/**
 * Segmented control for chart ranges.
 */
// PUBLIC_INTERFACE
function RangeToggle({ value, onChange }) {
  /** This is a public component for selecting time ranges for charts. */
  return (
    <div className="tm-toggle" role="group" aria-label="Chart range">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`tm-toggle__btn ${value === opt.key ? 'is-active' : ''}`}
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key ? 'true' : 'false'}
          title={opt.description}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// PUBLIC_INTERFACE
function App() {
  /** Main dashboard app: fetches metrics and renders charts with range selection. */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tokensPoints, setTokensPoints] = useState([]);
  const [costPoints, setCostPoints] = useState([]);

  /** @type {[RangeKey, (v: RangeKey) => void]} */
  const [range, setRange] = useState('hourly');

  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError('');

        const tokensUrl = `${backendBaseUrl}/metrics/tokens`;
        const costUrl = `${backendBaseUrl}/metrics/cost`;

        const [tokensRes, costRes] = await Promise.all([fetch(tokensUrl), fetch(costUrl)]);

        if (!tokensRes.ok) throw new Error(`Tokens API error: ${tokensRes.status}`);
        if (!costRes.ok) throw new Error(`Cost API error: ${costRes.status}`);

        const tokensJson = await tokensRes.json();
        const costJson = await costRes.json();

        if (!cancelled) {
          setTokensPoints(Array.isArray(tokensJson.points) ? tokensJson.points : []);
          setCostPoints(Array.isArray(costJson.points) ? costJson.points : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error fetching metrics');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!backendBaseUrl) {
      setLoading(false);
      setError('Missing REACT_APP_BACKEND_URL. Set it to your backend base URL (see .env.example).');
      return () => {
        cancelled = true;
      };
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [backendBaseUrl]);

  const displayTokensPoints = useMemo(() => {
    const limited = limitPointsByRange(tokensPoints, range);
    if (range === 'hourly') return limited;
    return aggregateTokensByDay(limited);
  }, [tokensPoints, range]);

  const displayCostPoints = useMemo(() => {
    const limited = limitPointsByRange(costPoints, range);
    if (range === 'hourly') return limited;
    return aggregateCostByDay(limited);
  }, [costPoints, range]);

  const tokenXLabels = useMemo(() => {
    if (range === 'hourly') return displayTokensPoints.map((p) => formatHourLabel(p.timestamp));
    return displayTokensPoints.map((p) => formatDayLabel(p.timestamp));
  }, [displayTokensPoints, range]);

  const inputSeries = useMemo(
    () => displayTokensPoints.map((p) => Number(p.input_tokens) || 0),
    [displayTokensPoints]
  );
  const outputSeries = useMemo(
    () => displayTokensPoints.map((p) => Number(p.output_tokens) || 0),
    [displayTokensPoints]
  );

  const costXLabels = useMemo(() => {
    if (range === 'hourly') return displayCostPoints.map((p) => formatHourLabel(p.timestamp));
    return displayCostPoints.map((p) => formatDayLabel(p.timestamp));
  }, [displayCostPoints, range]);

  const costSeries = useMemo(
    () => displayCostPoints.map((p) => Number(p.total_cost_usd) || 0),
    [displayCostPoints]
  );

  const rangeLabel = useMemo(() => {
    if (range === 'hourly') return 'hourly';
    if (range === 'weekly') return 'daily (last 7 days)';
    return 'daily (last 30 days)';
  }, [range]);

  const xAxisLabel = useMemo(() => (range === 'hourly' ? 'Time' : 'Date'), [range]);

  return (
    <div className="tm-app">
      <nav className="tm-nav" aria-label="Main navigation">
        <div className="tm-nav__brand">
          <div className="tm-nav__logo" aria-hidden="true" />
          <div className="tm-nav__title">Token Metrics Dashboard</div>
        </div>

        <div className="tm-nav__meta">
          <div className="tm-pill" title="Backend base URL">
            <span className="tm-pill__label">API</span>
            <span className="tm-pill__value">{backendBaseUrl}</span>
          </div>
        </div>
      </nav>

      <main className="tm-main">
        <section className="tm-hero" aria-label="Overview">
          <h1 className="tm-hero__title">Usage & Cost</h1>
          <p className="tm-hero__subtitle">
            Monitor input tokens, output tokens, and estimated total cost over time.
          </p>
        </section>

        {error ? (
          <div className="tm-alert" role="alert">
            <div className="tm-alert__title">Couldn&apos;t load metrics</div>
            <div className="tm-alert__body">{error}</div>
          </div>
        ) : null}

        <div className="tm-grid" aria-busy={loading ? 'true' : 'false'}>
          <section className="tm-card" aria-label="Token metrics">
            <header className="tm-card__header">
              <div>
                <h2 className="tm-card__title">Tokens</h2>
                <p className="tm-card__subtitle">Input vs output tokens ({rangeLabel})</p>
              </div>

              <div className="tm-card__actions">
                <RangeToggle value={range} onChange={setRange} />
                <div className="tm-legend" aria-label="Token chart legend">
                  <span className="tm-legend__item">
                    <span className="tm-dot tm-dot--primary" aria-hidden="true" /> Input
                  </span>
                  <span className="tm-legend__item">
                    <span className="tm-dot tm-dot--success" aria-hidden="true" /> Output
                  </span>
                </div>
              </div>
            </header>

            <div className="tm-card__content">
              <LineChart
                height={320}
                margin={{ left: 52, right: 18, top: 20, bottom: 40 }}
                xAxis={[{ scaleType: 'point', data: tokenXLabels, label: xAxisLabel }]}
                series={[
                  {
                    data: inputSeries,
                    label: 'Input tokens',
                    color: '#3b82f6',
                    showMark: false,
                    curve: 'linear',
                  },
                  {
                    data: outputSeries,
                    label: 'Output tokens',
                    color: '#06b6d4',
                    showMark: false,
                    curve: 'linear',
                  },
                ]}
                grid={{ vertical: true, horizontal: true }}
              />
              {loading ? <div className="tm-skeleton" aria-hidden="true" /> : null}
            </div>
          </section>

          <section className="tm-card" aria-label="Cost metrics">
            <header className="tm-card__header">
              <div>
                <h2 className="tm-card__title">Total Cost</h2>
                <p className="tm-card__subtitle">Estimated total cost in USD ({rangeLabel})</p>
              </div>

              <div className="tm-card__actions">
                <RangeToggle value={range} onChange={setRange} />
                <div className="tm-legend" aria-label="Cost chart legend">
                  <span className="tm-legend__item">
                    <span className="tm-dot tm-dot--secondary" aria-hidden="true" /> USD
                  </span>
                </div>
              </div>
            </header>

            <div className="tm-card__content">
              <LineChart
                height={320}
                margin={{ left: 52, right: 18, top: 20, bottom: 40 }}
                xAxis={[{ scaleType: 'point', data: costXLabels, label: xAxisLabel }]}
                series={[
                  {
                    data: costSeries,
                    label: 'Total cost (USD)',
                    color: '#64748b',
                    showMark: false,
                    curve: 'linear',
                  },
                ]}
                grid={{ vertical: true, horizontal: true }}
              />
              {loading ? <div className="tm-skeleton" aria-hidden="true" /> : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
