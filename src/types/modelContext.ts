/**
 * Model context window override types.
 * Wire format uses kebab-case keys; the UI uses camelCase.
 */

export interface ModelContextOverride {
  model: string;
  contextLength: number;
  maxCompletionTokens: number;
}

export interface ModelContextEntry {
  model: string;
  displayName: string;
  type: string;
  ownedBy: string;
  providers: string[];
  contextLength: number;
  maxCompletionTokens: number;
  /** True when the effective values come from a manual override. */
  overridden: boolean;
  /** True when a context window is known at all. */
  resolved: boolean;
}

export interface ModelContextStatus {
  models: ModelContextEntry[];
  overrides: ModelContextOverride[];
  missingCount: number;
}

export interface RawModelContextOverride {
  model?: string;
  'context-length'?: number;
  'max-completion-tokens'?: number;
}

export interface RawModelContextEntry {
  model?: string;
  'display-name'?: string;
  type?: string;
  'owned-by'?: string;
  providers?: unknown[];
  'context-length'?: number;
  'max-completion-tokens'?: number;
  overridden?: boolean;
  resolved?: boolean;
}
