import type { ModelSourceCandidate } from '@/services/api';

export interface PlaygroundProviderGroup {
  id: string;
  provider: string;
  baseUrl: string;
  label: string;
  credentials: ModelSourceCandidate[];
}

const PROVIDER_LABELS: Record<string, string> = {
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  kimi: 'Kimi',
  qoder: 'Qoder',
  qodercn: 'Qoder CN',
  vertex: 'Vertex',
  xai: 'xAI',
};

export const isPlaygroundCandidateReady = (candidate: ModelSourceCandidate) =>
  !candidate.disabled && !candidate.unavailable && candidate.status !== 'error';

export const normalizePlaygroundProviderBaseUrl = (baseUrl: string) => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
};

const baseHost = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
};

const providerLabel = (provider: string, baseUrl: string, candidate: ModelSourceCandidate) => {
  const normalized = provider.toLowerCase();
  const base =
    PROVIDER_LABELS[normalized] ??
    (normalized.startsWith('openai-compatible') ? candidate.label || provider : provider);
  return baseUrl ? `${base} · ${baseHost(baseUrl)}` : base;
};

export const buildPlaygroundProviderGroups = (
  sources: ModelSourceCandidate[]
): PlaygroundProviderGroup[] => {
  const groups = new Map<string, PlaygroundProviderGroup>();
  sources.forEach((candidate) => {
    const provider = candidate.provider.trim();
    if (!provider || !candidate.auth_index || !candidate.auth_id) return;
    const baseUrl = normalizePlaygroundProviderBaseUrl(candidate.base_url ?? '');
    const id = `${provider.toLowerCase()}::${baseUrl}`;
    const existing = groups.get(id);
    if (existing) {
      existing.credentials.push(candidate);
      return;
    }
    groups.set(id, {
      id,
      provider,
      baseUrl,
      label: providerLabel(provider, baseUrl, candidate),
      credentials: [candidate],
    });
  });
  return Array.from(groups.values());
};

export const playgroundCredentialValue = (candidate: ModelSourceCandidate) =>
  `${candidate.auth_id ?? ''}::${candidate.auth_index ?? ''}`;

export const pickPlaygroundCredential = (credentials: ModelSourceCandidate[]) =>
  credentials.find(isPlaygroundCandidateReady) ?? credentials[0];
