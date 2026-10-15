export interface OllamaInvocationStats {
  index: number;
  timestamp: string | null;
}

export function createOllamaInvocationTracker() {
  let index = 0;
  let timestamp: string | null = null;

  function recordOllamaInvocation(): OllamaInvocationStats {
    index += 1;
    timestamp = new Date().toISOString();

    return getOllamaInvocationStats();
  }

  function getOllamaInvocationStats(): OllamaInvocationStats {
    return {
      index,
      timestamp,
    };
  }

  return {
    recordOllamaInvocation,
    getOllamaInvocationStats,
  };
}
