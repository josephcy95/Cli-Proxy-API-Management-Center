import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

const CODEX_RESET_STATUS_URL = 'https://codex-resets.com/api/v1/status';
const SEEN_RESET_STORAGE_KEY = 'cpamc-codex-reset-seen';

interface ResetSource {
  url: string;
}

interface CodexReset {
  id: string;
  reset_type: 'regular' | 'banked';
  announced_at: string;
  text: string;
  source: ResetSource;
}

interface CodexResetWatch {
  level: 'elevated' | 'strong';
  reset_chance_percent: number | null;
  forecast_window: string;
  expires_at: string;
  text: string;
  source: ResetSource;
}

interface CodexResetStatus {
  data: {
    latest_reset: CodexReset | null;
    active_watch: CodexResetWatch | null;
  };
}

const bellIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.27 21h3.46" />
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
  </svg>
);

function formatAnnouncementTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function CodexResetNotice() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CodexResetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [seenResetID, setSeenResetID] = useState(() => {
    try {
      return localStorage.getItem(SEEN_RESET_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(false);

    try {
      const response = await fetch(CODEX_RESET_STATUS_URL, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus((await response.json()) as CodexResetStatus);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    const latestID = status?.data.latest_reset?.id;
    if (!open || !latestID || latestID === seenResetID) return;

    try {
      localStorage.setItem(SEEN_RESET_STORAGE_KEY, latestID);
    } catch {
      // The notice still works when browser storage is unavailable.
    }
    setSeenResetID(latestID);
  }, [open, seenResetID, status]);

  const latestReset = status?.data.latest_reset ?? null;
  const activeWatch = status?.data.active_watch ?? null;
  const hasUnread = Boolean(latestReset && latestReset.id !== seenResetID);

  const toggleNotice = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) void loadStatus();
  };

  return (
    <div className={`codex-reset-notice ${open ? 'open' : ''}`} ref={menuRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleNotice}
        className="codex-reset-trigger"
        title={t('codex_resets.button')}
        aria-label={t('codex_resets.button')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {bellIcon}
        {hasUnread ? <span className="codex-reset-unread" aria-hidden="true" /> : null}
      </Button>

      {open ? (
        <div className="codex-reset-popover" role="dialog" aria-label={t('codex_resets.title')}>
          <div className="codex-reset-heading">
            <div>
              <span className="codex-reset-kicker">Codex</span>
              <strong>{t('codex_resets.title')}</strong>
            </div>
            <button
              type="button"
              className="codex-reset-reload"
              onClick={() => void loadStatus()}
              disabled={loading}
            >
              {loading ? t('common.loading') : t('common.refresh')}
            </button>
          </div>

          {error && !status ? (
            <div className="codex-reset-state">
              <span>{t('codex_resets.load_failed')}</span>
              <button type="button" onClick={() => void loadStatus()}>
                {t('common.retry')}
              </button>
            </div>
          ) : latestReset ? (
            <>
              {activeWatch ? (
                <div className={`codex-reset-watch ${activeWatch.level}`}>
                  <span>{t('codex_resets.watch_label')}</span>
                  <strong>
                    {activeWatch.reset_chance_percent !== null
                      ? t('codex_resets.watch_chance', {
                          chance: activeWatch.reset_chance_percent,
                          window: activeWatch.forecast_window,
                        })
                      : activeWatch.forecast_window}
                  </strong>
                </div>
              ) : null}

              <div className="codex-reset-meta">
                <span>{t(`codex_resets.type_${latestReset.reset_type}`)}</span>
                <time dateTime={latestReset.announced_at}>
                  {formatAnnouncementTime(latestReset.announced_at, i18n.language)}
                </time>
              </div>
              <p className="codex-reset-message">{latestReset.text}</p>
              <div className="codex-reset-footer">
                <span>{t('codex_resets.unofficial')}</span>
                <a href={latestReset.source.url} target="_blank" rel="noreferrer">
                  {t('codex_resets.view_source')}
                </a>
              </div>
            </>
          ) : (
            <div className="codex-reset-state">{t('codex_resets.no_announcements')}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
