import { apiClient } from './client';

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PlaygroundChatRequest {
  model: string;
  provider: string;
  auth_index: string;
  auth_id: string;
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
