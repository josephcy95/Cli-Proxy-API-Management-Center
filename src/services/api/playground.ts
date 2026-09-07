import { apiClient } from './client';

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const PLAYGROUND_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type PlaygroundReasoningEffort = (typeof PLAYGROUND_REASONING_EFFORTS)[number];

export const isPlaygroundReasoningEffort = (value: string): value is PlaygroundReasoningEffort =>
  (PLAYGROUND_REASONING_EFFORTS as readonly string[]).includes(value);

export interface PlaygroundChatRequest {
  model: string;
  provider: string;
  auth_index: string;
  auth_id: string;
  reasoning_effort?: PlaygroundReasoningEffort;
  messages: PlaygroundMessage[];
}

export interface PlaygroundChatResponse {
  message: PlaygroundMessage;
  route: {
    model: string;
    provider: string;
    auth_index: string;
    credential_label: string;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  duration_ms: number;
}

export const playgroundApi = {
  chat: (request: PlaygroundChatRequest) =>
    apiClient.post<PlaygroundChatResponse>('/playground/chat', request),
};
