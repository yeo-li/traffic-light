import type { ApiError, Intersection, SignalResponse } from "./types";

export class SignalApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "SignalApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = (await response.json().catch(() => null)) as SignalResponse | ApiError | null;

  if (!response.ok || !body || "error" in body) {
    const error = body as ApiError | null;
    throw new SignalApiError(
      error?.message ?? "신호정보를 불러오지 못했습니다.",
      response.status,
      error?.retryAfterSeconds,
    );
  }
  return body as T;
}

export function fetchSignals(intersection: Intersection, signal?: AbortSignal): Promise<SignalResponse> {
  const query = new URLSearchParams({ intersectionId: intersection.id, stdgCd: intersection.standardRegionCode });
  return requestJson<SignalResponse>(`/api/signals?${query}`, signal);
}

export function fetchIntersections(stdgCd: string, signal?: AbortSignal): Promise<readonly Intersection[]> {
  return requestJson<readonly Intersection[]>(`/api/intersections?stdgCd=${encodeURIComponent(stdgCd)}`, signal);
}
