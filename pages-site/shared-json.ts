const requests = new Map<string, Promise<unknown>>();

export function fetchStaticJson<T>(url: URL | string): Promise<T> {
  const key = String(url);
  const existing = requests.get(key);
  if (existing) return existing as Promise<T>;
  const request = fetch(key, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`${new URL(key).pathname}: HTTP ${response.status}`);
      return response.json() as Promise<T>;
    })
    .catch((error) => {
      requests.delete(key);
      throw error;
    });
  requests.set(key, request);
  return request;
}
