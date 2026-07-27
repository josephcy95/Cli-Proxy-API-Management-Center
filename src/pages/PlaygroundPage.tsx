import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect';
import { IconBot, IconRefreshCw } from '@/components/ui/icons';
import { modelsApi, playgroundApi, type ModelSourceCandidate } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { PlaygroundChatResponse, PlaygroundMessage } from '@/services/api/playground';
import {
  buildPlaygroundProviderGroups,
  isPlaygroundCandidateReady,
  pickPlaygroundCredential,
  playgroundCredentialValue,
} from './playgroundUtils';
import styles from './PlaygroundPage.module.scss';

interface DisplayMessage extends PlaygroundMessage {
  result?: PlaygroundChatResponse;
}

const usageTotal = (response: PlaygroundChatResponse) =>
  response.usage?.total_tokens ??
  (response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? 0) +
    (response.usage?.completion_tokens ?? response.usage?.output_tokens ?? 0);

export function PlaygroundPage() {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [sources, setSources] = useState<Record<string, ModelSourceCandidate[]>>({});
  const [model, setModel] = useState('');
  const [providerGroupID, setProviderGroupID] = useState('');
  const [credentialValue, setCredentialValue] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const groups = buildPlaygroundProviderGroups(sources[model] ?? []);
  const selectedGroup = groups.find((group) => group.id === providerGroupID) ?? null;
  const selectedCredential =
    selectedGroup?.credentials.find(
      (candidate) => playgroundCredentialValue(candidate) === credentialValue
    ) ?? null;

  const selectModelRoute = useCallback(
    (nextModel: string, sourceMap = sources) => {
      const nextGroups = buildPlaygroundProviderGroups(sourceMap[nextModel] ?? []);
      const nextGroup =
        nextGroups.find((group) => group.credentials.some(isPlaygroundCandidateReady)) ??
        nextGroups[0];
      const nextCredential = nextGroup
        ? pickPlaygroundCredential(nextGroup.credentials)
        : undefined;
      setModel(nextModel);
      setProviderGroupID(nextGroup?.id ?? '');
      setCredentialValue(nextCredential ? playgroundCredentialValue(nextCredential) : '');
    },
    [sources]
  );

  const loadSources = useCallback(
    async (preserveRoute = false) => {
      setLoading(true);
      setError('');
      try {
        const nextSources = await modelsApi.fetchModelSources();
        setSources(nextSources);
        const models = Object.keys(nextSources).sort((left, right) => left.localeCompare(right));
        const currentModel = model && nextSources[model] ? model : (models[0] ?? '');
        if (preserveRoute && currentModel === model) {
          const nextGroups = buildPlaygroundProviderGroups(nextSources[currentModel] ?? []);
          const matchingGroup = nextGroups.find((group) => group.id === providerGroupID);
          const matchingCredential = matchingGroup?.credentials.find(
            (candidate) => playgroundCredentialValue(candidate) === credentialValue
          );
          if (matchingGroup && matchingCredential) {
            setProviderGroupID(matchingGroup.id);
            setCredentialValue(playgroundCredentialValue(matchingCredential));
            return;
          }
        }
        selectModelRoute(currentModel, nextSources);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('playground.load_failed'));
      } finally {
        setLoading(false);
      }
    },
    [credentialValue, model, providerGroupID, selectModelRoute, t]
  );

  useEffect(() => {
    void loadSources();
    // Initial catalog load only; refresh is explicit after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeRoute = (apply: () => void) => {
    if (messages.length === 0) {
      apply();
      return;
    }
    showConfirmation({
      title: t('playground.change_route_title'),
      message: t('playground.change_route_message'),
      confirmText: t('playground.change_route_confirm'),
      onConfirm: () => {
        setMessages([]);
        setError('');
        apply();
      },
    });
  };

  const modelOptions: SearchableSelectOption[] = Object.keys(sources)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));

  const providerOptions: SearchableSelectOption[] = groups.map((group) => {
    const ready = group.credentials.some(isPlaygroundCandidateReady);
    return {
      value: group.id,
      label: ready ? group.label : `${group.label} · ${t('playground.unavailable')}`,
      disabled: !ready,
    };
  });

  const credentialOptions: SearchableSelectOption[] = selectedGroup
    ? selectedGroup.credentials.map((candidate, index) => {
        const ready = isPlaygroundCandidateReady(candidate);
        const identity = selectedGroup.baseUrl
          ? `${t('playground.key_number', { number: index + 1 })}${candidate.label ? ` · ${candidate.label}` : ''}`
          : candidate.label ||
            candidate.auth_id ||
            t('playground.credential_number', { number: index + 1 });
        const reason = candidate.reason || candidate.status || t('playground.unavailable');
        return {
          value: playgroundCredentialValue(candidate),
          label: ready ? identity : `${identity} · ${reason}`,
          disabled: !ready,
        };
      })
    : [];

  const send = async () => {
    const content = draft.trim();
    if (
      !content ||
      !selectedGroup ||
      !selectedCredential ||
      !isPlaygroundCandidateReady(selectedCredential)
    )
      return;
    const userMessage: DisplayMessage = { role: 'user', content };
    const requestMessages: PlaygroundMessage[] = [...messages, userMessage].map(
      ({ role, content: messageContent }) => ({ role, content: messageContent })
    );
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setError('');
    setSending(true);
    try {
      const response = await playgroundApi.chat({
        model,
        provider: selectedGroup.provider,
        auth_index: selectedCredential.auth_index ?? '',
        auth_id: selectedCredential.auth_id ?? '',
        messages: requestMessages,
      });
      setMessages((current) => [...current, { ...response.message, result: response }]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('playground.send_failed'));
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const canSend =
    !loading &&
    !sending &&
    Boolean(draft.trim()) &&
    Boolean(
      model && selectedGroup && selectedCredential && isPlaygroundCandidateReady(selectedCredential)
    );

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.titleRow}>
            <IconBot size={22} />
            <h1>{t('playground.title')}</h1>
          </div>
          <p>{t('playground.description')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadSources(true)}
          disabled={sending}
        >
          <IconRefreshCw size={14} /> {t('common.refresh')}
        </Button>
      </header>

      <section className={styles.routePanel} aria-label={t('playground.route')}>
        <label>
          <span>{t('playground.model')}</span>
          <SearchableSelect
            value={model}
            options={modelOptions}
            onChange={(value) => changeRoute(() => selectModelRoute(value))}
            placeholder={loading ? t('common.loading') : t('playground.select_model')}
            searchPlaceholder={t('playground.type_to_search')}
            emptyMessage={t('playground.no_models')}
            disabled={loading || sending}
          />
        </label>
        <label>
          <span>{t('playground.provider')}</span>
          <SearchableSelect
            value={providerGroupID}
            options={providerOptions}
            onChange={(value) =>
              changeRoute(() => {
                const group = groups.find((item) => item.id === value);
                setProviderGroupID(value);
                const credential = group ? pickPlaygroundCredential(group.credentials) : undefined;
                setCredentialValue(credential ? playgroundCredentialValue(credential) : '');
              })
            }
            placeholder={t('playground.select_provider')}
            searchPlaceholder={t('playground.type_to_search')}
            emptyMessage={t('playground.no_providers')}
            disabled={loading || sending || !model}
          />
        </label>
        <label>
          <span>{t('playground.credential')}</span>
          <SearchableSelect
            value={credentialValue}
            options={credentialOptions}
            onChange={(value) => changeRoute(() => setCredentialValue(value))}
            placeholder={t('playground.select_credential')}
            searchPlaceholder={t('playground.type_to_search')}
            emptyMessage={t('playground.no_credentials')}
            disabled={loading || sending || !selectedGroup}
          />
        </label>
        <div className={styles.routeSummary}>
          {selectedCredential ? (
            <>
              <span>{model}</span>
              <b>→</b>
              <span>{selectedGroup?.label}</span>
              <b>→</b>
              <span>
                {credentialOptions.find((option) => option.value === credentialValue)?.label}
              </span>
            </>
          ) : (
            t('playground.no_route')
          )}
        </div>
      </section>

      <section className={styles.chatPanel}>
        <div className={styles.chatHeader}>
          <span>{t('playground.conversation')}</span>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMessages([])} disabled={sending}>
              {t('playground.new_chat')}
            </Button>
          )}
        </div>
        <div className={styles.messages} aria-live="polite">
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <IconBot size={28} />
              <strong>{t('playground.empty_title')}</strong>
              <span>{t('playground.empty_hint')}</span>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
                key={`${message.role}-${index}`}
              >
                <div className={styles.messageRole}>
                  {message.role === 'user' ? t('playground.you') : t('playground.assistant')}
                </div>
                <div className={styles.messageContent}>{message.content}</div>
                {message.result && (
                  <div className={styles.messageMeta}>
                    {message.result.route.model} · {message.result.route.provider} ·{' '}
                    {message.result.route.credential_label} ·{' '}
                    {(message.result.duration_ms / 1000).toFixed(1)}s
                    {usageTotal(message.result) > 0
                      ? ` · ${usageTotal(message.result)} tokens`
                      : ''}
                  </div>
                )}
              </article>
            ))
          )}
          {sending && <div className={styles.thinking}>{t('playground.waiting')}</div>}
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.composer}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={t('playground.message_placeholder')}
            disabled={sending || !selectedCredential}
            rows={3}
          />
          <div className={styles.composerFooter}>
            <span>{t('playground.send_hint')}</span>
            <Button onClick={() => void send()} disabled={!canSend} loading={sending}>
              {t('playground.send')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
