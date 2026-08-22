import type { AuthFileItem } from '@/types';

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : '';
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/**
 * Resolve the account email recorded by the backend on the auth file. Codex
 * and other providers store it under `attributes.email` (see the API's
 * filestore), but we also accept explicit top-level `email` fields and
 * `metadata.email` for files created by other flows.
 */
export function resolveAuthFileEmail(file: AuthFileItem): string {
  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);

  const candidates = [
    file.email,
    file['email'],
    metadata?.email,
    attributes?.email,
    metadata?.email_address,
    attributes?.email_address,
  ];

  for (const candidate of candidates) {
    const email = readString(candidate);
    if (email && email.includes('@')) return email;
  }

  return '';
}

/**
 * The short, human-facing account label shown on the card: the account email
 * when available, otherwise the raw auth-file name.
 */
export function resolveAuthFileDisplayName(file: AuthFileItem): string {
  const email = resolveAuthFileEmail(file);
  if (email) return email;
  return file.name;
}
