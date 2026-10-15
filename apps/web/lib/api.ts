export type User = { id: string; email: string };
export type Chat = { id: string; title: string; createdAt: string; updatedAt: string };
export type Budget = {
  allowed: boolean;
  reason: string;
  inputTokens: number;
  overheadTokens: number;
  reservedOutputTokens: number;
  projectedTotal: number;
  remainingTokens: number;
  contextLimit: number;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  usage?: { estimatedInputTokens: number; actualInputTokens: number; actualOutputTokens: number; doneReason: string; projectedTotal: number };
};
export type LabConfig = {
  model: string;
  contextWindowTokens: number;
  policyLimitTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  overLimitAction: string;
  temperature: number;
  systemPrompt: string;
  accounting: string;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}


export async function api<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const rawBody = await response.text();

  let result: any;

  try {
    result = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_API_RESPONSE",
      `API returned ${response.status} instead of JSON: ${
        rawBody.slice(0, 300)
      }`
    );
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      result?.error?.code ?? "API_ERROR",
      result?.error?.message ??
        `HTTP ${response.status}`,
      result?.error?.details
    );
  }

  return result as T;
}

