import { useState } from 'react';
import { api } from '../api/client.js';

const LIKELIHOOD_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * What is probably wrong and how to fix it.
 *
 * Generated once per error group and stored, so opening this on the fiftieth
 * occurrence costs nothing. The grouping is what makes the call affordable.
 */
export function Diagnosis({ fingerprint, initial, available }) {
  const [diagnosis, setDiagnosis] = useState(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(force = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.diagnose(force ? `${fingerprint}?force=true` : fingerprint);
      setDiagnosis(res.diagnosis);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!available && !diagnosis) {
    return (
      <div className="card diagnosis">
        <h2 style={{ marginBottom: 6 }}>Diagnosis</h2>
        <p className="diag-off">
          Not configured on this server. Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and
          restart to enable it.
        </p>
      </div>
    );
  }

  if (!diagnosis) {
    return (
      <div className="card diagnosis">
        <h2 style={{ marginBottom: 6 }}>Diagnosis</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 12px' }}>
          Ask Claude what is likely wrong. Only the signature is sent — the error type, the message
          with every literal already stripped, and frames as <code>file:function</code>. Never the
          paste, never a path.
        </p>
        {error && <div className="notice error">{error}</div>}
        <button onClick={() => run(false)} disabled={busy}>
          {busy ? 'Thinking…' : 'Diagnose this error'}
        </button>
      </div>
    );
  }

  const causes = [...(diagnosis.likelyCauses ?? [])].sort(
    (a, b) => (LIKELIHOOD_ORDER[a.likelihood] ?? 1) - (LIKELIHOOD_ORDER[b.likelihood] ?? 1)
  );

  return (
    <div className="card diagnosis">
      <div className="diag-top">
        <h2 style={{ margin: 0 }}>Diagnosis</h2>
        <span className={`chip conf-${diagnosis.confidence}`}>
          {diagnosis.confidence} confidence
        </span>
      </div>

      {error && <div className="notice error">{error}</div>}

      <p className="diag-summary">{diagnosis.summary}</p>

      {causes.length > 0 && (
        <>
          <h4 className="var-head">Likely causes</h4>
          <ol className="diag-causes">
            {causes.map((c, i) => (
              <li key={i}>
                <div className="diag-cause-head">
                  <strong>{c.cause}</strong>
                  <span className={`chip conf-${c.likelihood}`}>{c.likelihood}</span>
                </div>
                {c.detail && <p>{c.detail}</p>}
              </li>
            ))}
          </ol>
        </>
      )}

      {diagnosis.suggestedFix && (
        <>
          <h4 className="var-head">Suggested fix</h4>
          <pre className="diag-fix">{diagnosis.suggestedFix}</pre>
        </>
      )}

      {diagnosis.whatToCheck?.length > 0 && (
        <>
          <h4 className="var-head">What to check</h4>
          <ol className="diag-check">
            {diagnosis.whatToCheck.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </>
      )}

      <div className="diag-foot">
        <span>
          {diagnosis.model} · {new Date(diagnosis.generatedAt).toLocaleString()} · generated once
          for this group
        </span>
        <button className="link" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Thinking…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
}
