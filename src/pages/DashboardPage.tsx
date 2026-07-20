import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconKey,
  IconBot,
  IconFileText,
  IconSatellite,
  IconGithub,
  IconBookOpen,
  IconCode,
  IconExternalLink,
} from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useModelsStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import { authFilesApi, configApi, versionApi } from '@/services/api';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { formatDateTimeValue } from '@/utils/format';
import { getDashboardModelsStatValue } from '@/utils/dashboard';
import { classifyModels } from '@/utils/models';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  /** Route target; omitted for stats that scroll to an on-page section. */
  path?: string;
  loading?: boolean;
  sublabel?: string;
}

const PROVIDER_LABELS: Array<{ key: string; label: string }> = [
  { key: 'gemini', label: 'Gemini' },
  { key: 'codex', label: 'Codex' },
  { key: 'xai', label: 'xAI' },
  { key: 'claude', label: 'Claude' },
  { key: 'vertex', label: 'Vertex' },
  { key: 'openai', label: 'OpenAI' },
];

const API_REPO_URL = 'https://github.com/josephcy95/CLIProxyAPI';
const UI_REPO_URL = 'https://github.com/josephcy95/Cli-Proxy-API-Management-Center';
const DOCS_URL = 'https://help.router-for.me/';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

/** Strip a trailing colon so shared labels fit the row layout. */
const stripTrailingColon = (value: string) => value.replace(/[:：]\s*$/, '');

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const [authFilesLoading, setAuthFilesLoading] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);

  const modelsSectionRef = useRef<HTMLElement | null>(null);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveApiKeysForModels = useApiKeysForModels();

  const loadModels = useCallback(
    async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      if (connectionStatus !== 'connected' || !apiBase) {
        return;
      }

      try {
        const apiKeys = await resolveApiKeysForModels({ force: forceRefresh });
        const primaryKey = apiKeys[0];
        await fetchModelsFromStore(apiBase, primaryKey, forceRefresh);
      } catch {
        // Loading, empty, and error states are surfaced by the models store below.
      }
    },
    [apiBase, connectionStatus, fetchModelsFromStore, resolveApiKeysForModels]
  );

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    const loadAuthFiles = async () => {
      setAuthFilesLoading(true);
      try {
        const res = await authFilesApi.list();
        if (!cancelled) setAuthFilesCount(res.files.length);
      } catch {
        if (!cancelled) setAuthFilesCount(null);
      } finally {
        setAuthFilesLoading(false);
      }
    };

    // Provider/key counts come from the config store; ensure config is loaded and fetch auth files.
    fetchConfig().catch(() => undefined);
    void loadModels();
    void loadAuthFiles();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, fetchConfig, loadModels]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const configLoading = !config;
  const providerStats: Record<string, number> | null = config
    ? {
        gemini: config.geminiApiKeys?.length ?? 0,
        codex: config.codexApiKeys?.length ?? 0,
        xai: config.xaiApiKeys?.length ?? 0,
        claude: config.claudeApiKeys?.length ?? 0,
        vertex: config.vertexApiKeys?.length ?? 0,
        openai: config.openaiCompatibility?.length ?? 0,
      }
    : null;
  const totalProviderKeys = providerStats
    ? Object.values(providerStats).reduce((sum, count) => sum + count, 0)
    : 0;
  const providerBreakdown = providerStats
    ? PROVIDER_LABELS.filter(({ key }) => (providerStats[key] ?? 0) > 0)
        .map(({ key, label }) => `${label} ${providerStats[key]}`)
        .join(' · ')
    : '';

  const scrollToModels = useCallback(() => {
    modelsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: config ? (config.apiKeys?.length ?? 0) : '—',
      icon: <IconKey size={16} />,
      path: '/config',
      loading: configLoading,
      sublabel: t('nav.config_management'),
    },
    {
      label: t('nav.ai_providers'),
      value: providerStats ? totalProviderKeys : '—',
      icon: <IconBot size={16} />,
      path: '/ai-providers',
      loading: configLoading,
      sublabel: providerBreakdown || undefined,
    },
    {
      label: t('nav.auth_files'),
      value: authFilesCount ?? '—',
      icon: <IconFileText size={16} />,
      path: '/auth-files',
      loading: authFilesLoading && authFilesCount === null,
      sublabel: t('dashboard.oauth_credentials'),
    },
    {
      label: t('dashboard.available_models'),
      value: getDashboardModelsStatValue(models.length, modelsLoading, modelsError),
      icon: <IconSatellite size={16} />,
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc'),
    },
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '—'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;

  const connectionClass =
    connectionStatus === 'connected'
      ? styles.connected
      : connectionStatus === 'connecting'
        ? styles.connecting
        : styles.disconnected;
  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = serverVersion || t('system_info.version_unknown');
  const buildTime =
    formatDateTimeValue(serverBuildDate, i18n.language) || t('system_info.version_unknown');
  const canEditRequestLog = connectionStatus === 'connected' && Boolean(config);
  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);
  }, [requestLogEnabled]);

  /** Hidden request-log switch: tap the UI version value 7 times. */
  const handleVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleVersionCheck = useCallback(async () => {
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      const comparison = compareVersions(latest, serverVersion);

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  }, [serverVersion, showNotification, t]);

  const boolBadge = (value: boolean | undefined) => (
    <span className={`${styles.boolBadge} ${value ? styles.on : styles.off}`}>
      {value ? t('common.yes') : t('common.no')}
    </span>
  );

  const renderStatInner = (stat: QuickStat) => (
    <>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{stat.label}</span>
        <span className={styles.statIcon}>{stat.icon}</span>
      </div>
      <span className={styles.statValue}>{stat.loading ? '—' : stat.value}</span>
      {stat.sublabel && !stat.loading && (
        <span className={styles.statSub} title={stat.sublabel}>
          {stat.sublabel}
        </span>
      )}
    </>
  );

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1>{t('nav.dashboard')}</h1>
      </header>

      <section className={styles.statGrid}>
        {quickStats.map((stat) =>
          stat.path ? (
            <Link key={stat.label} to={stat.path} className={styles.statCard}>
              {renderStatInner(stat)}
            </Link>
          ) : (
            <button
              key={stat.label}
              type="button"
              className={`${styles.statCard} ${styles.statCardButton}`}
              onClick={scrollToModels}
            >
              {renderStatInner(stat)}
            </button>
          )
        )}
      </section>

      <div className={styles.summaryColumns}>
        {config && (
          <section className={styles.configCard}>
            <div className={styles.configHeader}>
              <h2>{t('dashboard.current_config')}</h2>
              <Link to="/config" className={styles.configEditLink}>
                {t('dashboard.edit_settings')}
              </Link>
            </div>
            <div className={styles.configGrid}>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>{t('basic_settings.debug_enable')}</span>
                {boolBadge(config.debug)}
              </div>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>
                  {t('basic_settings.logging_to_file_enable')}
                </span>
                {boolBadge(config.loggingToFile)}
              </div>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>{t('basic_settings.retry_count_label')}</span>
                <span className={styles.configValue}>{config.requestRetry ?? 0}</span>
              </div>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>{t('basic_settings.ws_auth_enable')}</span>
                {boolBadge(config.wsAuth)}
              </div>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>{t('dashboard.routing_strategy')}</span>
                <span className={styles.configValue}>{routingStrategyDisplay}</span>
              </div>
              {config.proxyUrl && (
                <div className={`${styles.configRow} ${styles.configRowWide}`}>
                  <span className={styles.configLabel}>{t('basic_settings.proxy_url_label')}</span>
                  <span className={styles.configMono} title={config.proxyUrl}>
                    {config.proxyUrl}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        <section className={styles.configCard}>
          <div className={styles.configHeader}>
            <h2>{t('nav.system_info')}</h2>
            <div className={styles.systemLinks}>
              <a
                className={styles.systemLink}
                href={API_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t('system_info.link_main_repo_desc')}
              >
                <IconGithub size={13} />
                <span>{t('system_info.link_main_repo')}</span>
                <IconExternalLink size={11} />
              </a>
              <a
                className={styles.systemLink}
                href={UI_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t('system_info.link_webui_repo_desc')}
              >
                <IconCode size={13} />
                <span>{t('system_info.link_webui_repo')}</span>
                <IconExternalLink size={11} />
              </a>
              <a
                className={styles.systemLink}
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t('system_info.link_docs_desc')}
              >
                <IconBookOpen size={13} />
                <span>{t('system_info.link_docs')}</span>
                <IconExternalLink size={11} />
              </a>
            </div>
          </div>
          <div className={styles.configGrid}>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('footer.version')}</span>
              <button type="button" className={styles.versionTap} onClick={handleVersionTap}>
                <span className={styles.configValue}>{appVersion}</span>
              </button>
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('footer.api_version')}</span>
              <span className={styles.configValueGroup}>
                <span className={styles.configValue}>{apiVersion}</span>
                <button
                  type="button"
                  className={styles.inlineAction}
                  onClick={() => void handleVersionCheck()}
                  disabled={checkingVersion}
                >
                  {t('system_info.version_check_button')}
                </button>
              </span>
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('footer.build_date')}</span>
              <span className={styles.configValue}>{buildTime}</span>
            </div>
            <div className={`${styles.configRow} ${styles.configRowWide}`}>
              <span className={styles.configLabel}>
                {stripTrailingColon(t('connection.status'))}
              </span>
              <span className={styles.configValueGroup}>
                <span className={`${styles.statusDot} ${connectionClass}`} />
                <span className={styles.configValue}>{connectionLabel}</span>
                {apiBase && (
                  <span className={styles.configMono} title={apiBase}>
                    {apiBase}
                  </span>
                )}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.modelsCard} ref={modelsSectionRef}>
        <div className={styles.configHeader}>
          <h2>{t('system_info.models_title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadModels({ forceRefresh: true })}
            loading={modelsLoading}
          >
            {t('common.refresh')}
          </Button>
        </div>
        <div className={styles.modelsBody}>
          {modelsError && <div className="error-box">{modelsError}</div>}
          {modelsLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : models.length === 0 ? (
            <div className="hint">{t('system_info.models_empty')}</div>
          ) : (
            <div className={styles.modelGroups}>
              {groupedModels.map((group) => {
                const iconSrc = getIconForCategory(group.id);
                return (
                  <div key={group.id} className={styles.modelGroup}>
                    <div className={styles.modelGroupHead}>
                      {iconSrc && <img src={iconSrc} alt="" className={styles.modelGroupIcon} />}
                      <span className={styles.modelGroupTitle}>{group.label}</span>
                      <span className={styles.modelGroupCount}>
                        {t('system_info.models_count', { count: group.items.length })}
                      </span>
                    </div>
                    <div className={styles.modelTags}>
                      {group.items.map((model) => (
                        <span
                          key={`${model.name}-${model.alias ?? 'default'}`}
                          className={styles.modelTag}
                          title={model.description || ''}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
