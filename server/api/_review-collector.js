export function reviewCollectorConfigured() {
  return Boolean(process.env.REVIEW_COLLECTOR_URL && process.env.REVIEW_COLLECTOR_SECRET);
}

export async function reviewCollectorRequest(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${process.env.REVIEW_COLLECTOR_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.REVIEW_COLLECTOR_SECRET}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `review_collector_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
