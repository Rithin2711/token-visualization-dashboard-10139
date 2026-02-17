import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

import { LineChart } from '@mui/x-charts/LineChart';

/**
 * Convert an ISO timestamp into a short label suitable for the X axis.
 * Example: "14:00", "15:00", ...
 */
function formatHourLabel(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getBackendBaseUrl() {
  // CRA exposes env vars prefixed with REACT_APP_
  return (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
}

// PUBLIC_INTERFACE
function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tokensPoints, setTokensPoints] = useState([]);
  const [costPoints, setCostPoints] = useState([]);

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

  const tokenXLabels = useMemo(
    () => tokensPoints.map((p) => formatHourLabel(p.timestamp)),
    [tokensPoints]
  );
  const inputSeries = useMemo(() => tokensPoints.map((p) => p.input_tokens), [tokensPoints]);
  const outputSeries = useMemo(() => tokensPoints.map((p) => p.output_tokens), [tokensPoints]);

  const costXLabels = useMemo(() => costPoints.map((p) => formatHourLabel(p.timestamp)), [costPoints]);
  const costSeries = useMemo(() => costPoints.map((p) => p.total_cost_usd), [costPoints]);

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
                <p className="tm-card__subtitle">Input vs output tokens (hourly)</p>
              </div>
              <div className="tm-legend">
                <span className="tm-legend__item">
                  <span className="tm-dot tm-dot--primary" aria-hidden="true" /> Input
                </span>
                <span className="tm-legend__item">
                  <span className="tm-dot tm-dot--success" aria-hidden="true" /> Output
                </span>
              </div>
            </header>

            <div className="tm-card__content">
              <LineChart
                height={320}
                margin={{ left: 52, right: 18, top: 20, bottom: 40 }}
                xAxis={[{ scaleType: 'point', data: tokenXLabels, label: 'Time (UTC-ish)' }]}
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
                <p className="tm-card__subtitle">Estimated total cost in USD (hourly)</p>
              </div>
              <div className="tm-legend">
                <span className="tm-legend__item">
                  <span className="tm-dot tm-dot--secondary" aria-hidden="true" /> USD
                </span>
              </div>
            </header>

            <div className="tm-card__content">
              <LineChart
                height={320}
                margin={{ left: 52, right: 18, top: 20, bottom: 40 }}
                xAxis={[{ scaleType: 'point', data: costXLabels, label: 'Time (UTC-ish)' }]}
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
