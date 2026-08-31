/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export interface CodexAdaptiveCandidateInfo {
  candidate?: boolean;
  rank?: number;
  blocked_reason?: string;
  deadline?: string | number;
  quota_urgency?: number;
  priority?: number;
  in_flight?: number;
  concurrency_limit?: number;
}

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  disabled_reason?: string;
  note?: string;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  xai_last_error_status?: number | string;
  xai_cooldown_until?: string | number;
  next_retry_after?: string | number;
  nextRetryAfter?: string | number;
  plan_type?: string;
  chatgpt_plan_type?: string;
  plan_checked_at?: string;
  chatgpt_subscription_active_until?: string | number;
  expired?: string | number;
  expires_at?: string | number;
  expires?: string | number;
  codex_quota_observed_at?: string | number;
  codexQuotaObservedAt?: string | number;
  'X-Codex-Primary-Used-Percent'?: number | string;
  'X-Codex-Primary-Window-Minutes'?: number | string;
  'X-Codex-Primary-Reset-At'?: number | string;
  'X-Codex-Primary-Reset-After-Seconds'?: number | string;
  'X-Codex-Secondary-Used-Percent'?: number | string;
  'X-Codex-Secondary-Window-Minutes'?: number | string;
  'X-Codex-Secondary-Reset-At'?: number | string;
  'X-Codex-Secondary-Reset-After-Seconds'?: number | string;
  rate_limit_reset_credits_available_count?: number;
  rate_limit_reset_credits_applicable_available_count?: number;
  rate_limit_reset_credits?: unknown[] | Record<string, unknown>;
  rate_limit_reset_credits_checked_at?: string;
  codex_adaptive?: CodexAdaptiveCandidateInfo;
  lastRefresh?: string | number;
  modified?: number;
  weight?: number;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
