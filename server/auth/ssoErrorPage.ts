const FRIENDLY_COPY: Record<string, { title: string; body: string }> = {
  missing_token: {
    title: "Sign-in link is missing",
    body: "This sign-in link doesn't include the information we need. Please return to OperatorOS and try launching Tech Deck again.",
  },
  bad_request: {
    title: "Sign-in link is malformed",
    body: "We couldn't read your sign-in link. Please return to OperatorOS and try launching Tech Deck again.",
  },
  signature_invalid: {
    title: "Sign-in link couldn't be verified",
    body: "We couldn't verify this sign-in link. Please return to OperatorOS and start a fresh sign-in.",
  },
  issuer_mismatch: {
    title: "Sign-in link is from an unknown source",
    body: "This sign-in link wasn't issued by OperatorOS. Please return to OperatorOS and try again.",
  },
  audience_mismatch: {
    title: "Sign-in link is for a different app",
    body: "This sign-in link wasn't issued for Tech Deck. Please return to OperatorOS and launch Tech Deck from there.",
  },
  env_mismatch: {
    title: "Sign-in link is for a different environment",
    body: "This sign-in link was issued for a different environment. Please return to OperatorOS and try again.",
  },
  expired: {
    title: "Your sign-in link has expired",
    body: "Sign-in links are only valid for a short time. Please return to OperatorOS and start a fresh sign-in.",
  },
  clock_skew: {
    title: "Sign-in link isn't valid yet",
    body: "Your computer's clock may be out of sync. Please check the time on your device, then return to OperatorOS and try again.",
  },
  consume_failed: {
    title: "Sign-in link has already been used",
    body: "Each sign-in link can only be used once. Please return to OperatorOS and start a fresh sign-in.",
  },
  sso_consume_unavailable: {
    title: "We can't reach OperatorOS right now",
    body: "We couldn't reach OperatorOS to complete your sign-in. Please wait a moment, then return to OperatorOS and try again.",
  },
  sso_not_configured: {
    title: "OperatorOS sign-in isn't set up",
    body: "OperatorOS single sign-on isn't configured on this instance of Tech Deck. Please contact your administrator.",
  },
  server_error: {
    title: "Something went wrong on our end",
    body: "We hit an unexpected error completing your sign-in. Please return to OperatorOS and try again.",
  },
};

const FALLBACK = {
  title: "We couldn't complete your sign-in",
  body: "Please return to OperatorOS and try launching Tech Deck again.",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSsoErrorPage(
  code: string,
  message: string,
  operatorOsBaseUrl?: string,
): string {
  const copy = FRIENDLY_COPY[code] || FALLBACK;
  const title = escapeHtml(copy.title);
  const body = escapeHtml(copy.body);
  const safeCode = escapeHtml(code);
  const safeMessage = escapeHtml(message);
  const backLink = operatorOsBaseUrl
    ? `<a class="back" href="${escapeHtml(operatorOsBaseUrl)}" data-testid="link-back-to-operatoros">Return to OperatorOS</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · Tech Deck</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f6f7f9;
      color: #1a1a1a;
      padding: 24px;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0d1117; color: #e6edf3; }
      .card { background: #161b22; border-color: #30363d; }
      .meta { color: #8b949e; }
      .back { background: #238636; color: #fff; }
      .back:hover { background: #2ea043; }
    }
    .card {
      max-width: 480px;
      width: 100%;
      background: #fff;
      border: 1px solid #e1e4e8;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.06);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
      line-height: 1.3;
    }
    p {
      margin: 0 0 20px;
      font-size: 15px;
      line-height: 1.55;
    }
    .back {
      display: inline-block;
      padding: 10px 18px;
      background: #1f6feb;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
    }
    .back:hover { background: #388bfd; }
    .meta {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #e1e4e8;
      font-size: 12px;
      color: #6e7781;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      .meta { border-top-color: #30363d; }
    }
  </style>
</head>
<body>
  <main class="card" role="alert" data-testid="sso-error-card">
    <h1 data-testid="text-sso-error-title">${title}</h1>
    <p data-testid="text-sso-error-body">${body}</p>
    ${backLink}
    <div class="meta" data-testid="text-sso-error-meta">
      Error code: ${safeCode}<br />
      ${safeMessage}
    </div>
  </main>
</body>
</html>`;
}
