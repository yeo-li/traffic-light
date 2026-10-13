type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
type State = "WALK" | "STOP" | "UNKNOWN";
type PedestrianSignal = { direction: Direction; state: State; rawState: string | null; rawRemainingValue: number | null; remainingSeconds: number | null };

declare const process: { env: Record<string, string | undefined> };

const directions: readonly Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const fieldPrefixes: Record<Direction, string> = { N: "nt", NE: "ne", E: "et", SE: "se", S: "st", SW: "sw", W: "wt", NW: "nw" };
const endpoint = "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionCurrentInfo/1.0";
const cacheTtlMs = 1_000;
let cached: { id: string; expiresAt: number; data: unknown } | null = null;

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store", ...headers } });
}
function apiError(error: string, message: string, status: number, retryAfterSeconds?: number) {
  return json({ error, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, status, retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {});
}
function asRecord(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function field(record: Record<string, unknown>, name: string): unknown {
  if (record[name] !== undefined) return record[name];
  const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? record[key] : undefined;
}
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function numberValue(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(number) ? number : null; }
function findSignalRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) { for (const item of value) { const found = findSignalRecord(item); if (found) return found; } return null; }
  const record = asRecord(value);
  if (!record) return null;
  if (Object.keys(record).some((key) => /Pdsg(?:StatNm|RmdrCs)$/i.test(key))) return record;
  for (const child of Object.values(record)) { const found = findSignalRecord(child); if (found) return found; }
  return null;
}
function signalState(raw: string | null): State {
  if (raw === "permissive-Movement-Allowed" || raw === "protected-Movement-Allowed") return "WALK";
  return raw === "stop-And-Remain" ? "STOP" : "UNKNOWN";
}
function remainingSeconds(raw: number | null): number | null {
  if (raw === null || raw === 36_000 || raw === 36_001 || raw > 3_000) return null;
  return Math.max(0, raw / 10);
}
function extractSignals(record: Record<string, unknown> | null): PedestrianSignal[] {
  if (!record) return [];
  return directions.flatMap((direction) => {
    const prefix = fieldPrefixes[direction];
    const rawState = stringValue(field(record, `${prefix}PdsgStatNm`));
    const rawRemainingValue = numberValue(field(record, `${prefix}PdsgRmdrCs`));
    if (rawState === null && rawRemainingValue === null) return [];
    return [{ direction, state: signalState(rawState), rawState, rawRemainingValue, remainingSeconds: remainingSeconds(rawRemainingValue) }];
  });
}
function extractTimestamp(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const timestamp = numberValue(field(record, "trsmUtcTime"));
  if (timestamp !== null) { const date = new Date(timestamp); if (!Number.isNaN(date.valueOf())) return date.toISOString(); }
  for (const name of ["dataTime", "regDt", "timestamp"]) { const value = stringValue(field(record, name)); if (value) return value; }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const intersectionId = new URL(request.url).searchParams.get("intersectionId");
  if (!intersectionId || !/^\d+$/.test(intersectionId)) return apiError("BAD_REQUEST", "유효한 intersectionId가 필요합니다.", 400);
  const apiKey = process.env.T_DATA_API_KEY;
  if (!apiKey) return apiError("CONFIGURATION_ERROR", "T-Data 신호 API가 아직 설정되지 않았습니다.", 503);
  if (cached?.id === intersectionId && cached.expiresAt > Date.now()) return json(cached.data, 200, { "x-cache": "HIT" });
  const upstreamUrl = new URL(endpoint);
  upstreamUrl.searchParams.set("apikey", apiKey);
  upstreamUrl.searchParams.set("itstId", intersectionId);
  let upstream: Response;
  try { upstream = await fetch(upstreamUrl.toString()); }
  catch { return apiError("UPSTREAM_ERROR", "실시간 신호정보를 불러오지 못했습니다.", 502); }
  if (upstream.status === 429) return apiError("RATE_LIMITED", "요청이 많습니다. 잠시 후 다시 시도해 주세요.", 429, Number(upstream.headers.get("retry-after")) || undefined);
  if (!upstream.ok) return apiError("UPSTREAM_ERROR", "실시간 신호정보를 불러오지 못했습니다.", 502);
  const payload: unknown = await upstream.json().catch(() => null);
  if (!payload) return apiError("UPSTREAM_ERROR", "실시간 신호 응답을 해석하지 못했습니다.", 502);
  const record = findSignalRecord(payload);
  const data = { intersectionId, sourceTimestamp: extractTimestamp(record), fetchedAt: new Date().toISOString(), signals: extractSignals(record) };
  cached = { id: intersectionId, expiresAt: Date.now() + cacheTtlMs, data };
  return json(data, 200, { "x-cache": "MISS" });
}
