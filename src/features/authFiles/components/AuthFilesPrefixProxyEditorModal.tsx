import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconInfo } from '@/components/ui/icons';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import styles from '@/pages/AuthFilesPage.module.scss';

const JSON_PREVIEW_ROWS = 5;

function LabelWithHint({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className={styles.prefixProxyLabelInner}>
      {label}
      {hint ? (
        <span className={styles.prefixProxyHint} title={hint} aria-label={hint}>
          <IconInfo size={12} />
        </span>
      ) : null}
    </span>
  );
}

export type AuthFilesPrefixProxyEditorModalProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;
  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const invalidContentPreview = editor?.invalidContentPreview ?? '';

  return (
    <Modal
      open={Boolean(editor)}
      onClose={onClose}
      closeDisabled={editor?.saving === true}
      width={720}
      title={
        editor?.fileName
          ? t('auth_files.auth_field_editor_title', { name: editor.fileName })
          : t('auth_files.prefix_proxy_button')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={editor?.saving === true}>
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError)
              || Boolean(editor?.weightError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.prefixProxyEditor}>
          {editor.loading ? (
            <div className={styles.prefixProxyLoading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.prefixProxyError}>{editor.error}</div>}
              {editor.json && (
                <div className={styles.prefixProxyFields}>
                  <div className={styles.prefixProxyTopRow}>
                    <Input
                      label={
                        <LabelWithHint
                          label={t('auth_files.priority_label')}
                          hint={t('auth_files.priority_hint')}
                        />
                      }
                      value={editor.priority}
                      placeholder={t('auth_files.priority_placeholder')}
                      disabled={disableControls || editor.saving}
                      onChange={(e) => onChange('priority', e.target.value)}
                    />
                    <Input
                      label={
                        <LabelWithHint
                          label={t('auth_files.weight_label')}
                          hint={t('auth_files.weight_hint')}
                        />
                      }
                      type="number"
                      step="1"
                      max={MAX_CREDENTIAL_WEIGHT}
                      value={editor.weight}
                      placeholder="1"
                      error={editor.weightError ?? undefined}
                      disabled={disableControls || editor.saving}
                      onChange={(e) => onChange('weight', e.target.value)}
                    />
                  </div>
                  <div className={styles.prefixProxySwitches}>
                    <div className={styles.prefixProxySwitch}>
                      <ToggleSwitch
                        checked={editor.disableCooling}
                        onChange={(value) => onChange('disableCooling', value)}
                        disabled={disableControls || editor.saving}
                        label={t('auth_files.disable_cooling_label')}
                        ariaLabel={t('auth_files.disable_cooling_label')}
                      />
                      <span
                        className={styles.prefixProxyHint}
                        title={t('auth_files.disable_cooling_hint')}
                        aria-label={t('auth_files.disable_cooling_hint')}
                      >
                        <IconInfo size={12} />
                      </span>
                    </div>
                    {supportsAuthFileWebsockets(editor.providerKey) && (
                      <div className={styles.prefixProxySwitch}>
                        <ToggleSwitch
                          checked={editor.websockets}
                          onChange={(value) => onChange('websockets', value)}
                          disabled={disableControls || editor.saving}
                          label={t('auth_files.websockets_label')}
                          ariaLabel={t('auth_files.websockets_label')}
                        />
                        <span
                          className={styles.prefixProxyHint}
                          title={t('auth_files.websockets_hint')}
                          aria-label={t('auth_files.websockets_hint')}
                        >
                          <IconInfo size={12} />
                        </span>
                      </div>
                    )}
                    {editor.providerKey === 'codex' && (
                      <div className={styles.prefixProxySwitch}>
                        <ToggleSwitch
                          checked={editor.allowPrivateInstructions}
                          onChange={(checked) => onChange('allowPrivateInstructions', checked)}
                          disabled={disableControls || editor.saving}
                          label={t('auth_files.allow_private_instructions_label')}
                          ariaLabel={t('auth_files.allow_private_instructions_label')}
                        />
                        <span
                          className={styles.prefixProxyHint}
                          title={t('auth_files.allow_private_instructions_hint')}
                          aria-label={t('auth_files.allow_private_instructions_hint')}
                        >
                          <IconInfo size={12} />
                        </span>
                      </div>
                    )}
                    {supportsAuthFileUsingApi(editor.providerKey) && (
                      <div className={styles.prefixProxySwitch}>
                        <ToggleSwitch
                          checked={editor.usingApi}
                          onChange={(value) => onChange('usingApi', value)}
                          disabled={disableControls || editor.saving}
                          label={t('auth_files.using_api_label')}
                          ariaLabel={t('auth_files.using_api_label')}
                        />
                        <span
                          className={styles.prefixProxyHint}
                          title={t('auth_files.using_api_hint')}
                          aria-label={t('auth_files.using_api_hint')}
                        >
                          <IconInfo size={12} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_info_label')}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={JSON_PREVIEW_ROWS}
                  readOnly
                  value={editor.fileInfoText}
                />
              </div>
              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {editor.json
                    ? t('auth_files.prefix_proxy_source_label')
                    : t('auth_files.prefix_proxy_invalid_content_label')}
                </label>
                {editor.json ? (
                  <textarea
                    className={styles.prefixProxyTextarea}
                    rows={JSON_PREVIEW_ROWS}
                    readOnly
                    value={previewText}
                  />
                ) : (
                  <pre className={styles.prefixProxyInvalidContentPreview}>
                    {invalidContentPreview}
                  </pre>
                )}
              </div>
              {editor.json && (
                <div className={styles.prefixProxyFields}>
                  <Input
                    label={t('auth_files.prefix_label')}
                    value={editor.prefix}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('prefix', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.proxy_url_label')}
                    value={editor.proxyUrl}
                    placeholder={t('auth_files.proxy_url_placeholder')}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('proxyUrl', e.target.value)}
                  />
                  <div className="form-group">
                    <label>
                      <LabelWithHint
                        label={t('auth_files.excluded_models_label')}
                        hint={t('auth_files.excluded_models_hint')}
                      />
                    </label>
                    <textarea
                      className="input"
                      value={editor.excludedModelsText}
                      placeholder={t('auth_files.excluded_models_placeholder')}
                      rows={4}
                      disabled={disableControls || editor.saving}
                      onChange={(e) => onChange('excludedModelsText', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      <LabelWithHint
                        label={t('auth_files.headers_label')}
                        hint={t('auth_files.headers_hint')}
                      />
                    </label>
                    <textarea
                      className={`input ${editor.headersError ? styles.prefixProxyTextareaInvalid : ''}`}
                      value={editor.headersText}
                      placeholder={t('auth_files.headers_placeholder')}
                      rows={4}
                      aria-invalid={Boolean(editor.headersError)}
                      disabled={disableControls || editor.saving}
                      onChange={(e) => onChange('headersText', e.target.value)}
                    />
                    {editor.headersError && <div className="error-box">{editor.headersError}</div>}
                  </div>
                  <Input
                    label={
                      <LabelWithHint
                        label={t('auth_files.note_label')}
                        hint={t('auth_files.note_hint')}
                      />
                    }
                    value={editor.note}
                    placeholder={t('auth_files.note_placeholder')}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('note', e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
