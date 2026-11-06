import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { captureSiwcBindingApi, type SiwcBindResponse } from '@/services/api/oauth';
import { useAuthStore } from '@/stores/useAuthStore';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import type { AuthFileItem } from '@/types';
import { createSiwcStart, isSiwcCallbackValid, listSiwcTargets } from '../siwcBinding';
import styles from '@/pages/OAuthPage.module.scss';

type Phase = 'idle' | 'starting' | 'wait' | 'ok' | 'error' | 'expired' | 'unsupported';

export function SiwcBindDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<AuthFileItem[] | null>(null);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<SiwcBindResponse>();
  const [callback, setCallback] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [run, setRun] = useState(0);
  const startupRef = useRef<ReturnType<typeof createSiwcStart<SiwcBindResponse>> | null>(null);
  const attemptRef = useRef<{
    api: ReturnType<typeof captureSiwcBindingApi>;
    signal: AbortSignal;
    revision: number;
  } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const revision = apiClient.getConnectionRevision();
    const unsubscribe = useAuthStore.subscribe(() => {
      if (
        apiClient.getConnectionRevision() !== revision ||
        !useAuthStore.getState().isAuthenticated
      ) {
        active = false;
        startupRef.current?.close();
        closeRef.current();
      }
    });
    void authFilesApi
      .list()
      .then((response) => {
        if (!active || apiClient.getConnectionRevision() !== revision) return;
        const files = listSiwcTargets(response.files);
        setTargets(files);
        if (files.length === 1) setName(files[0].name);
      })
      .catch(() => {
        if (active) setFeedback('load_failed');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!name) return;
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    const api = captureSiwcBindingApi();
    const attempt = { api, signal: controller.signal, revision: apiClient.getConnectionRevision() };
    attemptRef.current = attempt;
    const current = () =>
      active &&
      !controller.signal.aborted &&
      attemptRef.current === attempt &&
      apiClient.getConnectionRevision() === attempt.revision;
    const startup = createSiwcStart({
      start: () => {
        if (!current()) throw new Error('Binding connection changed');
        setPhase('starting');
        return api.start(name);
      },
      cancel: api.cancel,
      onResult: (result) => {
        if (!current()) {
          startup.close();
          return;
        }
        const url = new URL(result.url);
        if (
          result.status !== 'ok' ||
          result.flow !== 'siwc_bind' ||
          !result.state ||
          !['http:', 'https:'].includes(url.protocol) ||
          !(result.expires_in > 0)
        ) {
          throw new Error('Invalid binding session');
        }
        setSession(result);
        setPhase('wait');
        const expiresAt = Date.now() + result.expires_in * 1000;
        const poll = async () => {
          try {
            if (!current()) {
              startup.close();
              return;
            }
            if (Date.now() >= expiresAt) {
              setPhase('expired');
              return;
            }
            const status = await api.getStatus(result.state, controller.signal);
            if (!current()) {
              startup.close();
              return;
            }
            if (status.status === 'ok') {
              startup.complete();
              notifyAuthFilesChanged();
              setPhase('ok');
            } else if (status.status === 'error') setPhase('error');
            else timer = window.setTimeout(() => void poll(), 2000);
          } catch {
            if (current()) setPhase('error');
          }
        };
        timer = window.setTimeout(() => void poll(), 2000);
      },
      onError: (error: unknown) => {
        if (current())
          setPhase(
            typeof error === 'object' && error !== null && 'status' in error && error.status === 404
              ? 'unsupported'
              : 'error'
          );
      },
    });
    startupRef.current = startup;
    return () => {
      active = false;
      if (attemptRef.current === attempt) attemptRef.current = null;
      controller.abort();
      window.clearTimeout(timer);
      startup.close();
      if (startupRef.current === startup) startupRef.current = null;
    };
  }, [name, run]);

  const submit = async () => {
    if (!session || phase !== 'wait' || submitting) return;
    if (!isSiwcCallbackValid(callback, session.state)) {
      setFeedback('invalid_callback');
      return;
    }
    const attempt = attemptRef.current;
    if (
      !attempt ||
      attempt.signal.aborted ||
      apiClient.getConnectionRevision() !== attempt.revision
    )
      return;
    const current = () =>
      attemptRef.current === attempt &&
      !attempt.signal.aborted &&
      apiClient.getConnectionRevision() === attempt.revision;
    setSubmitting(true);
    try {
      await attempt.api.submitCallback(callback, attempt.signal);
      if (current()) setFeedback('submitted');
    } catch {
      if (current()) setFeedback('callback_failed');
    } finally {
      if (current()) setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title={t('siwc.title')}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t(phase === 'ok' ? 'siwc.done' : 'siwc.cancel')}
        </Button>
      }
    >
      <div className={styles.cardContent}>
        <p>{t('siwc.intro')}</p>
        <Select
          value={name}
          ariaLabel={t('siwc.target')}
          placeholder={t(
            targets === null
              ? 'siwc.loading'
              : targets.length === 0
                ? 'siwc.no_targets'
                : 'siwc.target'
          )}
          options={(targets ?? []).map((file) => ({ value: file.name, label: file.name }))}
          onChange={setName}
          disabled={phase !== 'idle'}
          fullWidth
        />
        {phase === 'idle' && (
          <Button disabled={!name} onClick={() => void startupRef.current?.start()}>
            {t('siwc.start')}
          </Button>
        )}
        {phase === 'starting' && <p role="status">{t('siwc.starting')}</p>}
        {phase === 'wait' && session && (
          <>
            <Button onClick={() => window.open(session.url, '_blank', 'noopener,noreferrer')}>
              {t('siwc.open')}
            </Button>
            <Input
              label={t('siwc.callback')}
              hint={t('siwc.hint')}
              value={callback}
              onChange={(event) => setCallback(event.target.value)}
              autoComplete="off"
            />
            <Button loading={submitting} disabled={!callback.trim()} onClick={() => void submit()}>
              {t('siwc.submit')}
            </Button>
          </>
        )}
        {phase !== 'idle' && phase !== 'starting' && <p role="status">{t(`siwc.${phase}`)}</p>}
        {feedback && <p role="status">{t(`siwc.${feedback}`)}</p>}
        {['error', 'expired'].includes(phase) && (
          <Button
            onClick={() => {
              setSubmitting(false);
              setPhase('idle');
              setSession(undefined);
              setCallback('');
              setFeedback('');
              setRun((value) => value + 1);
            }}
          >
            {t('siwc.retry')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
