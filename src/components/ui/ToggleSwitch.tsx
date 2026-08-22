import type { ChangeEvent, ReactNode } from 'react';
import styles from './ToggleSwitch.module.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
  /** 'primary' uses the theme accent when on; 'success' uses green when on. */
  variant?: 'primary' | 'success';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  labelPosition = 'right',
  variant = 'primary',
}: ToggleSwitchProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  const className = [
    styles.root,
    labelPosition === 'left' ? styles.labelLeft : '',
    disabled ? styles.disabled : '',
    variant === 'success' ? styles.success : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
