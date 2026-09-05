import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { apiClient } from '@/services/api/client';
import { getErrorMessage } from '@/utils/helpers';
import styles from './MonitoringSettings.module.scss';

type Retention = { value: number; default_days: number; restart_required: boolean };

export function MonitoringSettings() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [days, setDays] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const value = Number(days);
  const valid = days.trim() !== '' && Number.isSafeInteger(value) && value >= 1 && value <= 36500;
  const shortening = retention !== null && valid && value < retention.value;
  const changed = retention !== null && value !== retention.value;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.get<Retention>('/usage-retention-days');
      if (!Number.isSafeInteger(result.value) || result.value < 1)
        throw new Error(t('monitoring_settings.upgrade_required'));
      setRetention(result);
      setDays(String(result.value));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const show = () => {
    setOpen(true);
    setSaved(false);
    setConfirmed(false);
    setRetention(null);
    void load();
  };
  const save = async () => {
    if (!valid || !retention || !changed || (shortening && !confirmed) || saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await apiClient.put('/usage-retention-days', { value });
      const active = await apiClient.get<Retention>('/usage-retention-days');
      setRetention(active);
      setDays(String(active.value));
      setConfirmed(false);
      if (active.value !== value) {
        setError(t('monitoring_settings.not_applied'));
      } else {
        setSaved(true);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={show}>
        {t('monitoring_settings.title')}
      </Button>
      <Modal
        open={open}
        title={t('monitoring_settings.title')}
        closeDisabled={saving || loading}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" disabled={saving || loading} onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={loading || !valid || !changed || (shortening && !confirmed)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className={styles.content} aria-busy={loading || saving}>
          {retention ? (
            <>
              <Input
                label={t('monitoring_settings.keep_days')}
                type="number"
                min="1"
                max="36500"
                step="1"
                value={days}
                disabled={saving}
                onChange={(event) => {
                  setDays(event.target.value);
                  setConfirmed(false);
                  setSaved(false);
                }}
                error={!valid ? t('monitoring_settings.invalid') : undefined}
                hint={t('monitoring_settings.effective', {
                  days: retention.value,
                  default: retention.default_days,
                })}
              />
              <p>{t('monitoring_settings.all_hint')}</p>
              <p>{t('monitoring_settings.recovery_hint')}</p>
              {shortening ? (
                <div className={styles.warning}>
                  <p>{t('monitoring_settings.shortening', { days: value })}</p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={saving}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />{' '}
                    {t('monitoring_settings.confirm')}
                  </label>
                </div>
              ) : null}
              <p className={styles.muted}>{t('monitoring_settings.applies_live')}</p>
            </>
          ) : loading ? (
            <p>{t('common.loading')}</p>
          ) : (
            <Button variant="secondary" onClick={() => void load()}>
              {t('monitoring_settings.retry')}
            </Button>
          )}
          <div className={styles.feedback} aria-live="polite">
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : saved ? (
              <p>{t('monitoring_settings.saved')}</p>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
