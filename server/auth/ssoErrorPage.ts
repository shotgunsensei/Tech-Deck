import type { Request } from "express";

interface Copy {
  title: string;
  body: string;
}

interface Translation {
  pageTitleSuffix: string;
  errorCodeLabel: string;
  backLabel: string;
  fallback: Copy;
  codes: Record<string, Copy>;
}

const EN: Translation = {
  pageTitleSuffix: "Tech Deck",
  errorCodeLabel: "Error code",
  backLabel: "Return to OperatorOS",
  fallback: {
    title: "We couldn't complete your sign-in",
    body: "Please return to OperatorOS and try launching Tech Deck again.",
  },
  codes: {
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
  },
};

const ES: Translation = {
  pageTitleSuffix: "Tech Deck",
  errorCodeLabel: "Código de error",
  backLabel: "Volver a OperatorOS",
  fallback: {
    title: "No pudimos completar tu inicio de sesión",
    body: "Vuelve a OperatorOS e intenta abrir Tech Deck de nuevo.",
  },
  codes: {
    missing_token: {
      title: "Falta el enlace de inicio de sesión",
      body: "Este enlace de inicio de sesión no incluye la información que necesitamos. Vuelve a OperatorOS e intenta abrir Tech Deck de nuevo.",
    },
    bad_request: {
      title: "El enlace de inicio de sesión está mal formado",
      body: "No pudimos leer tu enlace de inicio de sesión. Vuelve a OperatorOS e intenta abrir Tech Deck de nuevo.",
    },
    signature_invalid: {
      title: "No se pudo verificar el enlace de inicio de sesión",
      body: "No pudimos verificar este enlace de inicio de sesión. Vuelve a OperatorOS e inicia sesión de nuevo.",
    },
    issuer_mismatch: {
      title: "El enlace de inicio de sesión proviene de una fuente desconocida",
      body: "Este enlace de inicio de sesión no fue emitido por OperatorOS. Vuelve a OperatorOS e inténtalo de nuevo.",
    },
    audience_mismatch: {
      title: "El enlace de inicio de sesión es para otra aplicación",
      body: "Este enlace de inicio de sesión no fue emitido para Tech Deck. Vuelve a OperatorOS y abre Tech Deck desde allí.",
    },
    env_mismatch: {
      title: "El enlace de inicio de sesión es para otro entorno",
      body: "Este enlace de inicio de sesión fue emitido para un entorno diferente. Vuelve a OperatorOS e inténtalo de nuevo.",
    },
    expired: {
      title: "Tu enlace de inicio de sesión ha caducado",
      body: "Los enlaces de inicio de sesión solo son válidos durante un corto periodo. Vuelve a OperatorOS e inicia sesión de nuevo.",
    },
    clock_skew: {
      title: "El enlace de inicio de sesión aún no es válido",
      body: "El reloj de tu equipo puede estar desajustado. Comprueba la hora de tu dispositivo y vuelve a OperatorOS para intentarlo de nuevo.",
    },
    consume_failed: {
      title: "El enlace de inicio de sesión ya se ha usado",
      body: "Cada enlace de inicio de sesión solo puede usarse una vez. Vuelve a OperatorOS e inicia sesión de nuevo.",
    },
    sso_consume_unavailable: {
      title: "No podemos contactar con OperatorOS en este momento",
      body: "No pudimos contactar con OperatorOS para completar tu inicio de sesión. Espera un momento y vuelve a OperatorOS para intentarlo de nuevo.",
    },
    sso_not_configured: {
      title: "El inicio de sesión de OperatorOS no está configurado",
      body: "El inicio de sesión único de OperatorOS no está configurado en esta instancia de Tech Deck. Contacta con tu administrador.",
    },
    server_error: {
      title: "Algo salió mal en nuestro extremo",
      body: "Encontramos un error inesperado al completar tu inicio de sesión. Vuelve a OperatorOS e inténtalo de nuevo.",
    },
  },
};

const TRANSLATIONS: Record<string, Translation> = {
  en: EN,
  es: ES,
};

const DEFAULT_LANG = "en";

/**
 * Pick a translation based on (in order):
 *   1. explicit `langOverride` (currently sourced from the `?lang=` query
 *      parameter; future callers may also pass a JWT `lang` claim here)
 *   2. the request's `Accept-Language` header (q-value aware)
 *   3. English fallback
 *
 * Both full tags (`es-MX`) and bare primary subtags (`es`) match the same
 * translation bucket.
 */
export function pickLanguage(
  acceptLanguage: string | undefined,
  langOverride?: string,
): string {
  const supported = Object.keys(TRANSLATIONS);
  const match = (tag: string | undefined): string | null => {
    if (!tag) return null;
    const lower = tag.toLowerCase();
    if (supported.includes(lower)) return lower;
    const primary = lower.split("-")[0];
    if (supported.includes(primary)) return primary;
    return null;
  };

  const overrideMatch = match(langOverride);
  if (overrideMatch) return overrideMatch;

  if (typeof acceptLanguage === "string" && acceptLanguage.length > 0) {
    const entries = acceptLanguage
      .split(",")
      .map((part) => {
        const [rawTag, ...params] = part.trim().split(";");
        let q = 1;
        for (const p of params) {
          const [k, v] = p.trim().split("=");
          if (k === "q") {
            const parsed = parseFloat(v);
            if (!Number.isNaN(parsed)) q = parsed;
          }
        }
        return { tag: rawTag.trim(), q };
      })
      .filter((e) => e.tag && e.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const e of entries) {
      const m = match(e.tag);
      if (m) return m;
    }
  }

  return DEFAULT_LANG;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderSsoErrorPageOptions {
  acceptLanguage?: string;
  langOverride?: string;
}

export function renderSsoErrorPage(
  code: string,
  message: string,
  operatorOsBaseUrl?: string,
  opts: RenderSsoErrorPageOptions = {},
): string {
  const lang = pickLanguage(opts.acceptLanguage, opts.langOverride);
  const t = TRANSLATIONS[lang];
  const copy = t.codes[code] || t.fallback;
  const title = escapeHtml(copy.title);
  const body = escapeHtml(copy.body);
  const safeCode = escapeHtml(code);
  const safeMessage = escapeHtml(message);
  const safeLang = escapeHtml(lang);
  const backLink = operatorOsBaseUrl
    ? `<a class="back" href="${escapeHtml(operatorOsBaseUrl)}" data-testid="link-back-to-operatoros">${escapeHtml(t.backLabel)}</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · ${escapeHtml(t.pageTitleSuffix)}</title>
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
      ${escapeHtml(t.errorCodeLabel)}: ${safeCode}<br />
      ${safeMessage}
    </div>
  </main>
</body>
</html>`;
}

export function ssoErrorPageOptionsFromRequest(req: Request): RenderSsoErrorPageOptions {
  const accept = req.headers["accept-language"];
  const acceptLanguage = typeof accept === "string" ? accept : undefined;
  const langOverride = typeof req.query.lang === "string" ? req.query.lang : undefined;
  return { acceptLanguage, langOverride };
}
