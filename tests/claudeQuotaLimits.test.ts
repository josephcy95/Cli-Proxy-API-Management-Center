import { describe, expect, test } from 'bun:test';
import { buildClaudeQuotaWindows } from '@/components/quota/quotaConfigs';
import type { ClaudeUsagePayload } from '@/types/quota';

// Minimal stand-in for i18next's t(): returns the key so "missing translation"
// is observable, which is exactly what the humanize fallback keys off.
const t = ((key: string) => key) as never;

describe('buildClaudeQuotaWindows', () => {
  test('renders the real Max 20x payload: session + scoped Fable weekly', () => {
    const payload: ClaudeUsagePayload = {
      five_hour: { utilization: 0, resets_at: null as never },
      seven_day: null,
      seven_day_opus: null,
      limits: [
        {
          kind: 'session',
          group: 'session',
          percent: 0,
          severity: 'normal',
          resets_at: null,
          scope: null,
          is_active: false,
        },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 8,
          severity: 'normal',
          resets_at: '2026-07-27T10:59:59.958262+00:00',
          scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          is_active: true,
        },
      ],
    };

    const windows = buildClaudeQuotaWindows(payload, t);

    // Inactive unused session is noise; Fable is promoted to the dedicated weekly window.
    // Named five_hour (0%) from the payload is still shown when present.
    expect(windows.some((w) => w.id === 'limit-session-0')).toBe(false);
    const fable = windows.find((w) => w.id === 'seven-day-fable');
    expect(fable).toBeTruthy();
    expect(fable?.usedPercent).toBe(8);
    expect(fable?.labelKey).toBe('claude_quota.seven_day_fable');
    expect(fable?.resetLabel).not.toBe('-');
  });

  test('keeps an active limit even at 0 percent', () => {
    const windows = buildClaudeQuotaWindows(
      { limits: [{ kind: 'session', percent: 0, is_active: true, resets_at: null }] },
      t
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].usedPercent).toBe(0);
  });

  test('labels an unscoped limit from its kind translation when one exists', () => {
    // Stand-in translator that resolves the session key, mirroring real locales.
    const translate = ((key: string) =>
      key === 'claude_quota.limit_kind_session' ? 'Current session' : key) as never;
    const windows = buildClaudeQuotaWindows(
      { limits: [{ kind: 'session', percent: 42, is_active: true }] },
      translate
    );
    expect(windows[0].label).toBe('Current session');
  });

  test('humanizes an unknown future limit kind instead of dropping it', () => {
    const windows = buildClaudeQuotaWindows(
      { limits: [{ kind: 'brand_new_thing', percent: 12, is_active: true }] },
      t
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].label).toBe('Brand New Thing');
  });

  test('prefers a scoped model name over the kind', () => {
    const windows = buildClaudeQuotaWindows(
      {
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 5,
            is_active: true,
            scope: { model: { display_name: 'Opus' } },
          },
        ],
      },
      t
    );
    expect(windows[0].label).toBe('Opus');
  });

  test('falls back to legacy named windows when limits[] is absent', () => {
    const windows = buildClaudeQuotaWindows(
      { five_hour: { utilization: 25, resets_at: '2026-07-27T10:00:00Z' } },
      t
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].id).toBe('five-hour');
    expect(windows[0].usedPercent).toBe(25);
  });

  test('returns nothing for an empty payload', () => {
    expect(buildClaudeQuotaWindows({}, t)).toEqual([]);
    expect(buildClaudeQuotaWindows({ limits: [] }, t)).toEqual([]);
  });
});
