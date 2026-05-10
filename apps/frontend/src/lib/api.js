const inflightGetRequests = new Map();

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = options.method || 'GET';
  const inflightKey = method === 'GET' && options.body === undefined ? path : '';
  if (inflightKey && inflightGetRequests.has(inflightKey)) {
    return inflightGetRequests.get(inflightKey);
  }

  const requestOptions = {
    method,
    credentials: 'include',
    headers
  };

  if (options.body instanceof FormData) {
    requestOptions.body = options.body;
  } else if (options.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    requestOptions.body = JSON.stringify(options.body);
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const requestPromise = (async () => {
    const res = await fetch(path, requestOptions);
    const contentType = res.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      headers: res.headers
    };
  })();

  if (inflightKey) {
    inflightGetRequests.set(inflightKey, requestPromise);
    requestPromise.then(
      () => inflightGetRequests.delete(inflightKey),
      () => inflightGetRequests.delete(inflightKey)
    );
  }

  return requestPromise;
}

const IST_TIME_ZONE = 'Asia/Kolkata';

export function istDateTime(value) {
  if (!value) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIME_ZONE,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(new Date(value)) + ' IST';
  } catch (_err) {
    return String(value);
  }
}

export function utcDateTime(value) {
  return istDateTime(value);
}
