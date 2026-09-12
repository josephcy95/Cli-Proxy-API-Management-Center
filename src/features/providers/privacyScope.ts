import { isMultiProtocolSponsorBrand } from './sponsorDefinitions';
import type { ProviderBrand, ProviderResource } from './types';

const BRAND_SCOPE_ID: Partial<Record<ProviderBrand, string>> = {
  claude: 'claude',
  claudeApi: 'claude',
  gemini: 'gemini',
  interactions: 'gemini-interactions',
  codex: 'codex',
  xai: 'xai',
  vertex: 'vertex',
};

export function privacyScopeId(resource: ProviderResource): string | null {
  if (isMultiProtocolSponsorBrand(resource.brand)) return null;
  if (resource.brand === 'openaiCompatibility') {
    const name = resource.name?.trim();
    return name || null;
  }
  return BRAND_SCOPE_ID[resource.brand] ?? null;
}

export function setHasIgnoreCase(values: ReadonlySet<string> | undefined, value: string): boolean {
  if (!values) return false;
  if (values.has(value)) return true;
  const needle = value.toLowerCase();
  for (const item of values) {
    if (item.toLowerCase() === needle) return true;
  }
  return false;
}
