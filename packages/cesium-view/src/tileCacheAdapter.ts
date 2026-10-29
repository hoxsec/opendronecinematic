import { Resource, TrustedServers } from 'cesium';
import { isTileUrl, tileCache, tileCacheKey, tileExpiry } from './tileCache';

interface Deferred {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}
type LoadWithXhr = (
  url: string,
  responseType: string,
  method: string,
  data: unknown,
  headers: Record<string, string> | undefined,
  deferred: Deferred,
  overrideMimeType?: string,
) => { abort(): void } | undefined;

let installed = false;

/**
 * The sole Cesium-internal integration point. Keeps Cesium's XHR, request scheduler,
 * authentication, browser HTTP revalidation and cancellation, including on cache misses.
 * IndexedDB also works in packaged Tauri webviews, unlike service workers on custom schemes.
 */
export function installTileCache(): void {
  if (installed || typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return;
  const implementations = (
    Resource as unknown as {
      _Implementations?: { loadWithXhr: LoadWithXhr };
    }
  )._Implementations;
  if (!implementations?.loadWithXhr) return;
  installed = true;
  const original = implementations.loadWithXhr;
  implementations.loadWithXhr = cachedLoadWithXhr(original);
}

export function cachedLoadWithXhr(original: LoadWithXhr): LoadWithXhr {
  return (url, responseType, method, data, headers, deferred, overrideMimeType) => {
    const requestHeaders = new Headers(headers);
    // Only binary tile payloads, never ion token/session endpoints, range requests,
    // cookie-authenticated requests, or explicit cache bypasses. All LODs have distinct keys.
    if (
      method !== 'GET' ||
      data != null ||
      responseType !== 'arraybuffer' ||
      !isTileUrl(url) ||
      TrustedServers.contains(url) ||
      overrideMimeType ||
      ['range', 'cache-control', 'pragma', 'if-none-match', 'if-modified-since'].some((h) =>
        requestHeaders.has(h),
      )
    ) {
      return original(url, responseType, method, data, headers, deferred, overrideMimeType);
    }
    let aborted = false;
    let xhr: ReturnType<LoadWithXhr>;
    const network = (id?: string) => {
      if (aborted) return;
      const started = Date.now();
      xhr = original(
        url,
        responseType,
        method,
        data,
        headers,
        {
          resolve(value) {
            if (aborted) return;
            // Clone before resolving: Cesium may transfer/detach the buffer to a decoder worker.
            const response = xhr as XMLHttpRequest | undefined;
            if (
              id &&
              value instanceof ArrayBuffer &&
              response?.status === 200 &&
              !response.withCredentials
            ) {
              const responseHeaders = new Headers();
              for (const line of response
                .getAllResponseHeaders()
                .trim()
                .split(/[\r\n]+/)) {
                const colon = line.indexOf(':');
                if (colon > 0)
                  responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
              }
              const expires = tileExpiry(responseHeaders, started, Date.now());
              if (expires !== undefined) {
                void tileCache.put(id, value.slice(0), expires).catch(() => {});
              }
            }
            deferred.resolve(value);
          },
          reject(error) {
            if (!aborted) deferred.reject(error);
          },
        },
        overrideMimeType,
      );
    };
    void (async () => {
      let id: string | undefined;
      try {
        id = await tileCacheKey(url, headers);
        const body = await tileCache.get(id);
        if (aborted) return;
        if (body) {
          deferred.resolve(body);
          return;
        }
      } catch {
        // Storage unavailable/full: map loading must continue normally.
      }
      network(id);
    })().catch((error) => {
      if (!aborted) deferred.reject(error);
    });
    return {
      abort() {
        aborted = true;
        xhr?.abort();
      },
    };
  };
}
