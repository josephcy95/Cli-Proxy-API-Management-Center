/**
 * 版本相关 API
 */

import { isRecord } from '@/utils/helpers';

const CLI_PROXY_API_REPOSITORY = 'josephcy95/CLIProxyAPI';

export const versionApi = {
  // Fork: check this fork's own GitHub releases instead of the backend
  // /latest-version endpoint, which reports upstream release numbers.
  async checkLatest(): Promise<Record<string, unknown>> {
    const response = await fetch(
      `https://api.github.com/repos/${CLI_PROXY_API_REPOSITORY}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!response.ok) {
      throw new Error(`GitHub release check failed (${response.status})`);
    }

    const release: unknown = await response.json();
    const latest = isRecord(release) && typeof release.tag_name === 'string' ? release.tag_name : '';
    return { latest };
  },
};
