import QRCodeSVG from "qrcode-svg";

interface PaymentRequired {
  accepts?: Array<{
    scheme?: string;
    network?: string;
    amount?: string;
    asset?: string;
    extra?: {
      invoice?: string;
      paymentHash?: string;
      expiresAt?: number;
      merchantId?: string;
    };
  }>;
  resource?: { description?: string; url?: string };
}

const ALBY_MARK = `<svg viewBox="0 0 9423.73 10000" xmlns="http://www.w3.org/2000/svg" width="21" height="21"><path d="M5527.96224,4990.99038c393.30097-.83389,787.34626,74.24689,1132.77979,208.88965,0,1299.07031-892.4502,1794.66992-2010.18018,1794.70996-.5,1.02002-678.01978,1397.06055,1141.30029,3005.41016-1807.59009,0-3151.49023-1108.55957-3151.49023-2496.66016,0-399.54004,105.11011-777.31006,292.13013-1112.73975,462.71997-829.91016,1481.01978-1399.60986,2595.46021-1399.60986ZM9260.87191,3990.18008c89.94043,0,162.86035,71.11011,162.86035,158.82007,0,87.72021-72.91992,158.83008-162.86035,158.83008-420.34961,0-761.79004,329.3999-767.7002,737.94971,395.18066,134.90039,679.28027,508.38037,679.28027,948v1001.80029h-1005.08984c-555.09033,0-1005.09033-448.52002-1005.09033-1001.80029s450-1001.7998,1005.09033-1001.7998h1.97998c34.22998-558.87988,509.84033-1001.80005,1091.52979-1001.80005ZM65.87383,3361.38003c-211.3608-681.57983,74.34121-894.85986,1024.97819-775.18994,460.32996,64.1001,1315.68005,332.36011,1957.75012,621.58008,1043.88989,468.09009,1727.36011,989.66016,1653.94995,1262.8501-43.5,161.87988-550.30029,399.52002-1054.13013,497.31006-1028.43994,195.6499-2013.84998,50.82959-2632.16992-378.31006-414.83099-284.95996-813.81001-809.21021-950.37821-1228.24023ZM4098.12191,435.87313c334.09033-630.92099,687.41016-580.36899,1274.72021,174.25299,280.02979,369.763,694.54004,1162.29407,943.37988,1819.33398,406.06006,1066.70996,519.31982,1917.22021,273.60986,2058.66016-145.59961,83.81006-672.5498-105.34033-1098.17969-391.29004-866.02002-586.48999-1460.07007-1592.8501-2122.64014-91.17017-493.87-1.38013-1145.76794,199.31982-1538.31696Z" fill="#ffc800"/></svg>`;

export const lightningPaywallProvider = {
  generateHtml(paymentRequired: unknown): string {
    const pr = paymentRequired as PaymentRequired;
    const req = pr.accepts?.[0];
    const invoice = req?.extra?.invoice ?? "";
    const paymentHash = req?.extra?.paymentHash ?? "";
    const expiresAt = req?.extra?.expiresAt ?? 0;
    const amountSats = Number(req?.amount ?? 0);
    const requirementsJson = JSON.stringify(req ?? {});
    const qrSvg = invoice
      ? new QRCodeSVG({ content: invoice.toUpperCase(), width: 210, height: 210, padding: 2, color: "#000", background: "#fff", ecl: "L" })
          .svg()
          .replace("<svg ", '<svg shape-rendering="crispEdges" ')
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Required — x402</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,300&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f0f0ee; --card: #fff; --border: #e6e6e4; --border-mid: #d0d0cc;
      --text: #0f0f0f; --text-2: #555; --text-3: #999;
      --green: #16a34a; --green-soft: #f0fdf4; --green-border: #bbf7d0;
      --serif: "Instrument Serif", Georgia, serif;
      --sans: "Inter", -apple-system, sans-serif;
      --mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
      --radius: 18px;
      --shadow: 0 2px 8px rgba(0,0,0,.06), 0 8px 32px rgba(0,0,0,.06);
    }
    body {
      background: var(--bg); color: var(--text);
      font-family: var(--sans); font-size: 15px; line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      font-feature-settings: "cv02","cv03","cv04","cv11";
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 1.5rem;
      gap: 0.75rem;
    }

    /* ── flip scene ── */
    .card-scene {
      width: 100%; max-width: 380px;
      perspective: 1200px;
    }
    .card-inner {
      position: relative;
      transform-style: preserve-3d;
      transition: transform 0.65s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card-inner.flipped { transform: rotateY(180deg); }
    .card-face {
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }
    .card-back {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      transform: rotateY(180deg);
    }

    /* shared card shell */
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow);
      width: 100%; overflow: hidden;
    }

    /* ── header ── */
    .card-header {
      padding: 0.85rem 1.1rem;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .header-left { display: flex; align-items: center; gap: 10px; }
    .logo-mark {
      width: 34px; height: 34px; border-radius: 50%;
      background: #111;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .site-name { font-weight: 600; font-size: 13px; line-height: 1.25; }
    .site-sub { font-size: 11px; color: var(--text-3); line-height: 1.25; margin-top: 2px; }
    .network-badge {
      font-size: 10.5px; font-weight: 500; color: var(--text-3);
      background: #f5f5f3; border: 1px solid var(--border);
      border-radius: 20px; padding: 4px 10px;
      display: flex; align-items: center; gap: 5px;
    }
    .network-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #22c55e; flex-shrink: 0;
    }

    /* ── amount hero ── */
    .amount-section {
      padding: 1.75rem 1.5rem 1.25rem;
      text-align: center;
    }
    .amount-label {
      font-size: 11px; font-weight: 500; color: var(--text-3);
      letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 0.5rem;
    }
    .amount-primary {
      font-family: var(--serif); font-weight: 400;
      font-size: 3rem; letter-spacing: -0.01em;
      line-height: 1; color: var(--text);
    }
    .amount-primary.loading { color: var(--text-3); }
    .amount-secondary {
      font-size: 13px; color: var(--text-3); margin-top: 6px; font-weight: 400;
    }

    /* ── qr ── */
    .qr-section {
      padding: 1.25rem 1.5rem 1rem;
      border-top: 1px solid var(--border);
      display: flex; flex-direction: column; align-items: center; gap: 1rem;
    }
    .qr-wrap {
      border: 1px solid var(--border); border-radius: 12px;
      background: #fff; display: inline-flex; overflow: hidden;
    }
    .qr-wrap svg { display: block; width: 210px; height: 210px; }

    /* ── actions ── */
    .actions { padding: 0 1.5rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .btn {
      border-radius: 10px; font-family: var(--sans);
      font-size: 14px; font-weight: 500; padding: 11px 16px;
      cursor: pointer; border: none; transition: opacity 0.12s, background 0.12s;
      text-align: center; text-decoration: none; display: block;
      white-space: nowrap; width: 100%; line-height: 1;
    }
    .btn:hover { opacity: 0.82; }
    .btn-primary { background: var(--text); color: #fff; }
    .btn-secondary {
      background: transparent; color: var(--text-2);
      border: 1px solid var(--border-mid); font-size: 13px;
    }

    /* ── status (front, waiting) ── */
    .status-bar {
      display: flex; align-items: center; gap: 7px;
      font-size: 12px; color: var(--text-3);
    }
    .spinner {
      width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
      border: 1.5px solid var(--border-mid); border-top-color: var(--text-3);
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── back face ── */
    .card-back-inner {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center; padding: 2.5rem 2rem;
      min-height: 100%;
    }
    .back-check {
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--green-soft); border: 1.5px solid var(--green-border);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: var(--green); margin-bottom: 1.5rem; flex-shrink: 0;
    }
    .back-label {
      font-size: 10.5px; font-weight: 500; color: var(--text-3);
      letter-spacing: 0.09em; text-transform: uppercase; margin-bottom: 1.1rem;
    }
    .back-quote {
      font-family: var(--serif); font-style: italic;
      font-size: 1.45rem; line-height: 1.45; color: var(--text);
      letter-spacing: -0.01em; margin-bottom: 1rem;
    }
    .back-attr {
      font-size: 12px; color: var(--text-3); font-style: normal;
    }
    .back-divider {
      width: 32px; height: 1px; background: var(--border);
      margin: 1.5rem auto;
    }
    .back-again {
      font-size: 12px; color: var(--text-3); cursor: pointer;
      background: none; border: none; padding: 0; font-family: var(--sans);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .back-again:hover { color: var(--text-2); }

    /* ── code drawer ── */
    .code-toggle {
      font-size: 12px; color: var(--text-3); cursor: pointer;
      background: none; border: none; padding: 0; font-family: var(--sans);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .code-toggle:hover { color: var(--text-2); }
    .code-drawer-content {
      display: none; margin-top: 0.75rem;
      width: 100%; max-width: 700px;
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
    }
    .code-drawer-content.open { display: block; }
    .tabs { display: flex; border-bottom: 1px solid var(--border); }
    .tab {
      font-family: var(--mono); font-size: 11.5px; color: var(--text-3);
      padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent;
      transition: color 0.12s; margin-bottom: -1px; user-select: none;
    }
    .tab:hover { color: var(--text-2); }
    .tab.active { color: var(--text); border-bottom-color: var(--text); }
    .code-panel { display: none; }
    .code-panel.active { display: block; }
    pre {
      padding: 1.1rem 1.5rem; overflow-x: auto;
      font-family: var(--mono); font-size: 12.5px; line-height: 1.9; color: #374151;
      margin: 0; white-space: pre;
    }
    .c0 { color: var(--text-3); }
    .c1 { color: #6366f1; }
    .c2 { color: #0d9488; }
    .c3 { color: #111; font-weight: 600; }
    .c4 { color: #92400e; }

    .below-card {
      text-align: center; margin-top: 0.5rem;
    }
  </style>
</head>
<body>

<div class="card-scene">
  <div class="card-inner" id="card-inner">

    <!-- FRONT -->
    <div class="card-face card-front card">
      <div class="card-header">
        <div class="header-left">
          <div class="logo-mark">${ALBY_MARK}</div>
          <div>
            <div class="site-name">x402</div>
            <div class="site-sub">x402.albylabs.com</div>
          </div>
        </div>
        <div class="network-badge"><span class="network-dot"></span>Lightning</div>
      </div>

      <div class="amount-section">
        <div class="amount-label">Amount due</div>
        <div class="amount-primary loading" id="amount-primary">—</div>
        <div class="amount-secondary" id="amount-secondary">${amountSats.toLocaleString()} sat</div>
      </div>

      <div class="qr-section">
        ${qrSvg ? `<div class="qr-wrap">${qrSvg}</div>` : ""}
        <div class="status-bar" id="status-bar">
          <div class="spinner" id="spinner"></div>
          <span id="status-text">Waiting for payment…</span>
        </div>
      </div>

      <div class="actions">
        ${invoice ? `<a class="btn btn-primary" href="lightning:${invoice}">Open in Wallet</a>` : ""}
        <button class="btn btn-secondary" id="copy-btn" onclick="copyInvoice()">Copy invoice</button>
      </div>
    </div>

    <!-- BACK -->
    <div class="card-face card-back card">
      <div class="card-back-inner">
        <div class="back-check">✓</div>
        <div class="back-label">A word from Satoshi</div>
        <div class="back-quote" id="back-quote"></div>
        <div class="back-attr" id="back-attr"></div>
        <div class="back-divider"></div>
        <button class="back-again" onclick="location.reload()">Start over</button>
      </div>
    </div>

  </div>
</div>

<div class="below-card">
  <button class="code-toggle" onclick="toggleCode()">How to pay programmatically</button>
</div>

<div class="code-drawer-content" id="code-drawer">
  <div class="tabs">
    <div class="tab active" id="tab-ts" onclick="switchTab('ts')">TypeScript</div>
    <div class="tab" id="tab-curl" onclick="switchTab('curl')">curl</div>
    <div class="tab" id="tab-alby" onclick="switchTab('alby')">AI Agents</div>
  </div>

  <div class="code-panel active" id="panel-ts">
    <pre><span class="c0">// 1. Request the resource — server responds 402 with a BOLT11 invoice</span>
<span class="c3">const</span> res = <span class="c3">await</span> <span class="c4">fetch</span>(<span class="c2">"https://x402.albylabs.com/demo/quote"</span>);
<span class="c3">const</span> { accepts } = JSON.<span class="c4">parse</span>(<span class="c4">atob</span>(res.headers.<span class="c4">get</span>(<span class="c2">"PAYMENT-REQUIRED"</span>)!));
<span class="c3">const</span> requirements = accepts[<span class="c1">0</span>];
<span class="c3">const</span> { invoice } = requirements.extra;

<span class="c0">// 2. Pay the invoice with any Lightning wallet (example: Alby NWC)</span>
<span class="c3">import</span> { nwc } <span class="c3">from</span> <span class="c2">"@getalby/sdk"</span>;
<span class="c3">const</span> client = <span class="c3">new</span> nwc.<span class="c4">NWCClient</span>({ nostrWalletConnectUrl: <span class="c2">"nostr+walletconnect://..."</span> });
<span class="c3">const</span> { preimage } = <span class="c3">await</span> client.<span class="c4">payInvoice</span>({ invoice });

<span class="c0">// 3. Retry with proof of payment</span>
<span class="c3">const</span> payload = <span class="c4">btoa</span>(JSON.<span class="c4">stringify</span>({
  <span class="c1">x402Version</span>: <span class="c1">2</span>, <span class="c1">scheme</span>: requirements.scheme,
  <span class="c1">network</span>: requirements.network,
  <span class="c1">payload</span>: { preimage }, <span class="c1">accepted</span>: requirements,
}));
<span class="c3">const</span> data = <span class="c3">await</span> <span class="c4">fetch</span>(<span class="c2">"https://x402.albylabs.com/demo/quote"</span>, {
  <span class="c1">headers</span>: { <span class="c2">"payment-signature"</span>: payload },
}).<span class="c3">then</span>(r => r.<span class="c4">json</span>());
<span class="c0">// { quote: "...", attribution: "Satoshi Nakamoto", timestamp: "..." }</span></pre>
  </div>

  <div class="code-panel" id="panel-curl">
    <pre><span class="c0"># 1. Get 402 — extract requirements and invoice</span>
<span class="c3">REQS</span>=<span class="c2">$(curl -si https://x402.albylabs.com/demo/quote \\
  | grep -i "^payment-required:" \\
  | sed 's/.*: //' | tr -d '\\r' \\
  | base64 -d | jq -c '.accepts[0]')</span>
<span class="c3">INVOICE</span>=<span class="c2">$(echo "$REQS" | jq -r '.extra.invoice')</span>

<span class="c0"># 2. Pay $INVOICE with your Lightning wallet → save preimage as $PREIMAGE</span>

<span class="c0"># 3. Retry with proof of payment</span>
<span class="c3">PAYLOAD</span>=<span class="c2">$(printf \\
  '{"x402Version":2,"scheme":"exact","network":"lightning:mainnet","payload":{"preimage":"%s"},"accepted":%s}' \\
  "$PREIMAGE" "$REQS" | base64 -w0)</span>
<span class="c3">curl</span> https://x402.albylabs.com/demo/quote \\
  -H <span class="c2">"payment-signature: $PAYLOAD"</span></pre>
  </div>

  <div class="code-panel" id="panel-alby">
    <div style="padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:0.85rem;">
      <p style="font-size:12px;color:var(--text-3);line-height:1.55;margin:0;">
        Paste this prompt into your AI agent to get started:
      </p>
      <div style="position:relative;">
        <pre id="agent-prompt" style="margin:0;white-space:pre-wrap;word-break:break-word;background:#fafaf8;border:1px solid var(--border);border-radius:10px;padding:0.9rem 1rem;font-family:var(--sans);font-size:12.5px;color:var(--text);line-height:1.6;">Load this skill: https://raw.githubusercontent.com/getAlby/alby-cli-skill/refs/heads/master/SKILL.md

If the wallet doesn't have any funds, generate a Lightning invoice for $1 USD and present it to the user to fund the wallet. Wait for payment confirmation.

Then fetch this resource (payment is handled automatically via x402): https://x402.albylabs.com/demo/quote

Print the result.</pre>
        <button onclick="copyAgentPrompt()" id="copy-agent-btn" style="position:absolute;top:0.6rem;right:0.6rem;font-family:var(--sans);font-size:11px;font-weight:500;color:var(--text-2);background:var(--card);border:1px solid var(--border-mid);border-radius:6px;padding:4px 10px;cursor:pointer;transition:color 0.12s,border-color 0.12s;">Copy</button>
      </div>
    </div>
  </div>
</div>

<script>
  const INVOICE = ${JSON.stringify(invoice)};
  const PAYMENT_HASH = ${JSON.stringify(paymentHash)};
  const EXPIRES_AT = ${JSON.stringify(expiresAt)}; // unix seconds
  const RESOURCE_URL = window.location.href;
  const REQUIREMENTS = ${requirementsJson};
  const AMOUNT_SATS = ${amountSats};
  let pollTimer = null;
  const POLL_INITIAL = 1500;   // ms between first polls
  const POLL_MAX = 15000;      // ms ceiling for backoff interval
  const POLL_FACTOR = 1.5;     // backoff multiplier
  let pollInterval = POLL_INITIAL;
  let paid = false;

  // Fetch live USD value — show as primary amount hero
  (async () => {
    const primary = document.getElementById('amount-primary');
    const secondary = document.getElementById('amount-secondary');
    try {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
      const d = await r.json();
      const price = parseFloat(d?.result?.XXBTZUSD?.c?.[0]);
      if (price > 0) {
        const usd = ((AMOUNT_SATS / 1e8) * price).toFixed(2);
        primary.textContent = '$' + usd;
        primary.classList.remove('loading');
        secondary.textContent = AMOUNT_SATS.toLocaleString() + ' sat';
        return;
      }
    } catch (_) {}
    // Fallback: show sats as primary
    primary.textContent = AMOUNT_SATS.toLocaleString() + ' sat';
    primary.classList.remove('loading');
    secondary.textContent = '';
  })();

  function copyInvoice() {
    if (!INVOICE) return;
    navigator.clipboard.writeText(INVOICE).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'Copied!';
      btn.style.borderColor = '#16a34a';
      btn.style.color = '#16a34a';
      setTimeout(() => { btn.textContent = 'Copy invoice'; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
    });
  }

  async function checkPayment() {
    if (paid || !PAYMENT_HASH) return;
    if (EXPIRES_AT > 0 && Math.floor(Date.now() / 1000) > EXPIRES_AT) {
      document.getElementById('status-text').textContent = 'Invoice expired — please refresh to generate a new one.';
      document.getElementById('spinner').style.display = 'none';
      return;
    }
    try {
      const res = await fetch('/invoice/status/' + PAYMENT_HASH);
      if (!res.ok) return;
      const data = await res.json();
      if (data.paid && data.preimage) {
        paid = true;
        clearTimeout(pollTimer);
        await onPaid(data.preimage);
        return;
      }
    } catch (_) {}
    pollInterval = Math.min(pollInterval * POLL_FACTOR, POLL_MAX);
    pollTimer = setTimeout(checkPayment, pollInterval);
  }

  async function onPaid(preimage) {
    document.getElementById('status-text').textContent = 'Payment confirmed — fetching response…';

    const payloadObj = {
      x402Version: 2,
      scheme: REQUIREMENTS.scheme,
      network: REQUIREMENTS.network,
      payload: { preimage },
      accepted: REQUIREMENTS,
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj))));

    try {
      const res = await fetch(RESOURCE_URL, { headers: { 'payment-signature': encoded } });
      const body = await res.json();
      document.getElementById('back-quote').textContent = body.quote ?? JSON.stringify(body);
      if (body.attribution) document.getElementById('back-attr').textContent = '— ' + body.attribution;
    } catch (_) {
      document.getElementById('back-quote').textContent = 'Payment confirmed.';
    }

    // Flip to back after a short pause so the user sees the "confirmed" state
    setTimeout(() => {
      document.getElementById('card-inner').classList.add('flipped');
    }, 400);
  }

  function toggleCode() {
    const drawer = document.getElementById('code-drawer');
    drawer.classList.toggle('open');
  }

  function copyAgentPrompt() {
    const text = document.getElementById('agent-prompt').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-agent-btn');
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--green)';
      btn.style.borderColor = 'var(--green-border)';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
    });
  }

  function switchTab(id) {
    ['ts', 'curl', 'alby'].forEach(t => {
      document.getElementById('tab-' + t).classList.toggle('active', t === id);
      document.getElementById('panel-' + t).classList.toggle('active', t === id);
    });
  }

  if (PAYMENT_HASH) {
    pollTimer = setTimeout(checkPayment, POLL_INITIAL);
  }
</script>

</body>
</html>`;
  },
};
