import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { AuthFileItem, CodexQuotaState } from '@/types';
import { useCodexCreditOverage } from './useCodexCreditOverage';
import { CodexCreditOverageDialog } from './CodexCreditOverageDialog';
import { resolveCodexCreditOverageState } from './creditOverage';
import { useClaudeResetGrants } from './ClaudeResetGrants';
import { ClaudeResetGrantDialog } from './ClaudeResetGrantDialog';
import styles from '@/pages/QuotaPage.module.scss';

export function CodexAccountActions({
  file,
  quota,
  disabled,
  sharedCredentialCount,
}: {
  file: AuthFileItem;
  quota?: CodexQuotaState;
  disabled: boolean;
  sharedCredentialCount: number;
}) {
  const { t } = useTranslation();
  const credit = useCodexCreditOverage(file, quota, disabled);
  if (!credit.visible) return null;
  return (
    <>
      <div className={styles.quotaRow}>
        <span className={styles.quotaModel}>
          {t('codex_quota.credit_overage_label')}:{' '}
          {t(`codex_quota.credit_overage_state_${resolveCodexCreditOverageState(credit.entry)}`)}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={credit.openDialog}
          disabled={credit.blocked}
          aria-haspopup="dialog"
          aria-label={t('codex_quota.credit_overage_manage_aria', { name: file.name })}
        >
          {t('codex_quota.credit_overage_manage')}
        </Button>
      </div>
      {credit.context && (
        <CodexCreditOverageDialog
          open={credit.open}
          context={credit.context}
          entry={credit.entry}
          operation={credit.operation}
          writeDisabled={credit.writeDisabled}
          contextCurrent={credit.contextCurrent}
          sharedCredentialCount={sharedCredentialCount}
          selection={credit.selection}
          pendingTarget={credit.pendingTarget}
          feedback={credit.feedback}
          onSelect={credit.selectValue}
          onSave={() => void credit.save()}
          onClose={credit.closeDialog}
        />
      )}
    </>
  );
}

export function ClaudeAccountActions({
  file,
  enabled,
  disabled,
  refreshToken,
  onRefresh,
}: {
  file: AuthFileItem;
  enabled: boolean;
  disabled: boolean;
  refreshToken: unknown;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const reset = useClaudeResetGrants(file, enabled, disabled, refreshToken, onRefresh);
  if (!enabled) return null;
  return (
    <>
      <div className={styles.quotaRow}>
        <span className={styles.quotaModel}>
          {t('claude_reset.remaining')}: {reset.count ?? '--'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={reset.openDialog}
          disabled={reset.blocked}
          aria-haspopup="dialog"
        >
          {t(`claude_reset.${reset.buttonLabel}`)}
        </Button>
      </div>
      <ClaudeResetGrantDialog
        open={reset.open}
        busy={reset.busy}
        loading={reset.loading}
        grants={reset.grants}
        selected={reset.selected}
        pendingGrantId={reset.pendingGrantId}
        canRedeemGrant={reset.canRedeemGrant}
        message={reset.message}
        name={file.name}
        onSelect={reset.selectGrant}
        onConfirm={() => void reset.confirm()}
        onClose={reset.closeDialog}
      />
    </>
  );
}
