const forbiddenSecretKey = /(password|passphrase|secret|token|private.?key|api.?key|credential.?value)/i;

export function findForbiddenSecretField(details: Record<string, unknown>): string | null {
  return Object.keys(details).find((key) => forbiddenSecretKey.test(key)) ?? null;
}

export function sanitizeDocumentationContent(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/<(script|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .replace(/javascript\s*:/gi, "blocked:");
}
