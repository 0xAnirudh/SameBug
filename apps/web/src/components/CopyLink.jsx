import { useState } from 'react';

export function CopyLink({ url }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context; the input below is the fallback.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <input
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        style={{ flex: '1 1 260px', fontFamily: 'var(--mono)', fontSize: 13 }}
        aria-label="Shareable link"
      />
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
