const SENSITIVE_KEY = /token|secret|authorization|cookie|html|raw|payload/i;

const sanitizeValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, sanitizeValue(item)]),
  );
};

export const normalizeDiagnostic = (diagnostic = {}) => {
  const traceCorrupted = Boolean(diagnostic.traceCorrupted) || !Array.isArray(diagnostic.trace);
  return {
    requestId: String(diagnostic.requestId || ''),
    shortRequestId: String(diagnostic.requestId || '').slice(0, 10),
    action: String(diagnostic.action || 'importSource'),
    sourceType: String(diagnostic.sourceType || ''),
    sourceUrl: String(diagnostic.sourceUrl || ''),
    outcome: String(diagnostic.outcome || 'failed'),
    provider: String(diagnostic.provider || 'manual'),
    failedStage: String(diagnostic.failedStage || ''),
    reasonCode: String(diagnostic.reasonCode || 'UNKNOWN'),
    message: String(diagnostic.message || 'Нет описания результата'),
    confidence: String(diagnostic.confidence || 'low'),
    durationMs: Math.max(0, Number(diagnostic.durationMs) || 0),
    startedAt: String(diagnostic.startedAt || ''),
    completedAt: String(diagnostic.completedAt || ''),
    trace: Array.isArray(diagnostic.trace) ? diagnostic.trace.map((entry) => sanitizeValue(entry)) : [],
    traceCorrupted,
  };
};

export const filterDiagnostics = (diagnostics, filter) => {
  const items = Array.isArray(diagnostics) ? diagnostics : [];
  if (filter === 'problems') return items.filter((item) => item.outcome !== 'success');
  if (filter === 'success') return items.filter((item) => item.outcome === 'success');
  return items;
};

export const maskDiagnosticUrl = (value) => {
  if (!value) return 'Источник без URL';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    const maskedSlug = slug.length > 5 ? `${slug.slice(0, 5)}…` : slug;
    return `${url.hostname.replace(/^www\./, '')}/${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}${maskedSlug}`;
  } catch {
    return String(value).slice(0, 28);
  }
};

export const formatDiagnosticReport = (diagnostic) => {
  const normalized = normalizeDiagnostic(diagnostic);
  const report = {
    requestId: normalized.requestId,
    action: normalized.action,
    sourceType: normalized.sourceType,
    sourceUrl: normalized.sourceUrl,
    outcome: normalized.outcome,
    provider: normalized.provider,
    failedStage: normalized.failedStage,
    reasonCode: normalized.reasonCode,
    message: normalized.message,
    confidence: normalized.confidence,
    durationMs: normalized.durationMs,
    startedAt: normalized.startedAt,
    completedAt: normalized.completedAt,
    trace: normalized.trace.map((entry) => sanitizeValue(entry)),
  };
  return JSON.stringify(report, null, 2);
};

export const DIAGNOSTIC_STATUS = {
  success: { label: 'Успешно', color: '#6FAE8A' },
  fallback: { label: 'Ручной fallback', color: '#E8A33D' },
  failed: { label: 'Ошибка', color: '#C56B5D' },
};

export const DIAGNOSTIC_STAGE_LABELS = {
  validate_input: 'Проверка ссылки',
  public_fetch: 'Запрос LinkedIn',
  public_parse: 'Разбор публичного профиля',
  apify_config: 'Настройка Apify',
  apify_fetch: 'Запрос Apify',
  apify_parse: 'Разбор ответа Apify',
  parse_source: 'Разбор источника',
  finalize: 'Итог',
};
