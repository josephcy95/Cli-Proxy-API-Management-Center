import type { TFunction } from 'i18next';
import { parseTimestamp } from './timestamp';

/**
 * 格式化工具函数
 * 从原项目 src/utils/string.js 迁移
 */

/**
 * 隐藏 API Key 中间部分，仅保留前后两位
 */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    return '';
  }

  const MASKED_LENGTH = 10;
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(MASKED_LENGTH - visibleChars * 2, 1);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 将 Unix 时间戳（秒/毫秒/微秒/纳秒）格式化为本地时间字符串
 */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = typeof value === 'number' ? value : Number(value);
  const date = (() => {
    if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
      return parseTimestamp(value) ?? new Date(String(value));
    }

    const abs = Math.abs(asNumber);

    // 秒：常见 10 位（~1e9）
    if (abs < 1e11) return new Date(asNumber * 1000);

    // 毫秒：常见 13 位（~1e12）
    if (abs < 1e14) return new Date(asNumber);

    // 微秒：常见 16 位（~1e15）
    if (abs < 1e17) return new Date(Math.round(asNumber / 1000));

    // 纳秒：常见 19 位（~1e18）
    return new Date(Math.round(asNumber / 1e6));
  })();

  if (Number.isNaN(date.getTime())) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date =
    typeof value === 'number'
      ? new Date(value < 1e12 ? value * 1000 : value)
      : (parseTimestamp(value) ?? new Date(String(value)));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleDateString(locale) : date.toLocaleDateString();
}

export function formatDateTimeValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

/**
 * Parse a timestamp/epoch value to an absolute epoch-milliseconds number.
 * Accepts seconds (10-digit), milliseconds (13-digit), microseconds (16-digit)
 * and nanoseconds (19-digit) epoch values, ISO strings, or raw Date-parseable
 * strings. Returns null when the value cannot be interpreted.
 */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const abs = Math.abs(value);
    if (abs < 1e11) return value * 1000;
    if (abs < 1e14) return value;
    if (abs < 1e17) return value / 1000;
    return value / 1e6;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  return null;
}

export interface RelativeTimeParts {
  sign: 'past' | 'future';
  days: number;
  hours: number;
  minutes: number;
}

/**
 * Split the delta between `value` and `now` into days/hours/minutes. Returns
 * null for unparseable values. Minute granularity is rounded up so a value a
 * few seconds away reads as "in 1m" rather than "in 0m".
 */
export function getRelativeTimeParts(value: unknown, now = Date.now()): RelativeTimeParts | null {
  const ms = toEpochMs(value);
  if (ms === null) return null;

  const deltaMs = ms - now;
  const sign: 'past' | 'future' = deltaMs >= 0 ? 'future' : 'past';
  const totalMinutes = Math.max(0, Math.ceil(Math.abs(deltaMs) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return { sign, days, hours, minutes };
}

/**
 * Human "time left / time ago" label using the `relative_time.*` translation
 * keys. Returns an empty string when the value is unparseable. Absolute dates
 * are shown by callers via a tooltip.
 */
export function formatRelativeTimeLabel(
  t: TFunction,
  value: unknown,
  now = Date.now()
): string {
  const parts = getRelativeTimeParts(value, now);
  if (!parts) return '';

  const { sign, days, hours, minutes } = parts;

  if (sign === 'past') {
    if (days > 0) return t('relative_time.days_ago', { count: days });
    if (hours > 0) return t('relative_time.hours_ago', { count: hours });
    if (minutes > 0) return t('relative_time.minutes_ago', { count: minutes });
    return t('relative_time.now');
  }

  if (days > 0) {
    return hours > 0
      ? t('relative_time.in_days_hours', { days, hours })
      : t('relative_time.in_days', { count: days });
  }
  if (hours > 0) return t('relative_time.in_hours', { count: hours });
  if (minutes > 0) return t('relative_time.in_minutes', { count: minutes });
  return t('relative_time.now');
}
