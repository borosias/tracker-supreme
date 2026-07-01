export const DEFAULT_TARGET_ROLE = 'Senior Frontend Developer';

export const cleanScraperText = (value) => {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const compact = normalized.replace(/\s+/g, '');
  if (/^\*+$/.test(compact)) return '';
  if (/^(?:n\/a|n\.a\.|not available|unavailable|null|undefined|unknown|-+)$/.test(normalized)) return '';
  return text;
};

export const normalizeTargetRole = (value) => cleanScraperText(value) || DEFAULT_TARGET_ROLE;
