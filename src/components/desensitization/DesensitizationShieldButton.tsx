import { IconShield } from '@/components/ui/icons';
import styles from './DesensitizationShieldButton.module.scss';

export function DesensitizationShieldButton({
  enabled,
  disabled,
  busy,
  onToggle,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  const label = enabled ? onLabel : offLabel;
  return (
    <button
      type="button"
      className={`${styles.shield} ${enabled ? styles.shieldOn : styles.shieldOff}`}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled || busy) return;
        onToggle(!enabled);
      }}
    >
      <IconShield size={16} />
    </button>
  );
}
