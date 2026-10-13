declare const process: { env: Record<string, string | undefined> };

type Intersection = { id: string; name: string; latitude: number; longitude: number; standardRegionCode: string };
const baseUrl = "https://apis.data.go.kr/B551982/rti/crsrd_map_info";
const cacheTtlMs = 24 * 60 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; data: readonly Intersection[] }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
}
function apiError(error: string, message: string, status: number) { return json({ error, message }, status); }
function asRecord(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(number) ? number : null; }
function field(record: Record<string, unknown>, name: string): unknown {
  if (record[name] !== undefined) return record[name];
  const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? record[key] : undefined;
}
function collectRecords(value: unknown, predicate: (record: Record<string, unknown>) => boolean, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) { for (const item of value) collectRecords(item, predicate, found); return found; }
  const record = asRecord(value);
  if (!record) return found;
  if (predicate(record)) found.push(record);
  for (const child of Object.values(record)) collectRecords(child, predicate, found);
  return found;
}
function totalCount(value: unknown): number | null {
  for (const record of collectRecords(value, (item) => field(item, "totalCount") !== undefined)) {
    const count = numberValue(field(record, "totalCount"));
    if (count !== null) return count;
  }
  return null;
}
function providerError(value: unknown): string | null {
  for (const record of collectRecords(value, (item) => field(item, "resultCode") !== undefined || field(item, "returnReasonCode") !== undefined)) {
    const code = stringValue(field(record, "resultCode"));
    const authCode = stringValue(field(record, "returnReasonCode"));
    const message = stringValue(field(record, "resultMsg")) ?? stringValue(field(record, "returnAuthMsg"));
    if (code && !["00", "0", "K0", "K3", "NORMAL_SERVICE"].includes(code)) return message ?? `공공데이터 API 오류 (${code})`;
    if (authCode && !["00", "0", "NORMAL_SERVICE"].includes(authCode)) return message ?? `공공데이터 API 오류 (${authCode})`;
  }
  return null;
}
async function requestPage(serviceKey: string, stdgCd: string, pageNo: number): Promise<unknown> {
  const url = new URL(baseUrl);
  let decodedKey = serviceKey;
  try { decodedKey = decodeURIComponent(decodedKey); } catch { /* An already-decoded key is valid. */ }
  url.searchParams.set("serviceKey", decodedKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("type", "json");
  url.searchParams.set("stdgCd", stdgCd);
  let response: Response;
  try { response = await fetch(url); } catch { throw new Error("전국 신호 API에 연결하지 못했습니다."); }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload ? providerError(payload) ?? "전국 신호 API를 불러오지 못했습니다." : "전국 신호 API를 불러오지 못했습니다.");
  const error = providerError(payload);
  if (error) throw new Error(error);
  return payload;
}
function toIntersection(record: Record<string, unknown>, standardRegionCode: string): Intersection | null {
  const id = stringValue(field(record, "crsrdId"));
  const name = stringValue(field(record, "crsrdNm"));
  const latitude = numberValue(field(record, "mapCtptIntLat"));
  const longitude = numberValue(field(record, "mapCtptIntLot"));
  if (!id || !name || latitude === null || longitude === null || !/^\d+$/.test(id)) return null;
  return { id, name, latitude, longitude, standardRegionCode };
}

export async function GET(request: Request): Promise<Response> {
  const stdgCd = new URL(request.url).searchParams.get("stdgCd");
  if (!stdgCd || !/^\d{10}$/.test(stdgCd)) return apiError("BAD_REQUEST", "10자리 stdgCd가 필요합니다.", 400);
  const serviceKey = process.env.NATIONAL_RTI_SERVICE_KEY;
  if (!serviceKey) return apiError("CONFIGURATION_ERROR", "전국 신호 API가 아직 설정되지 않았습니다.", 503);
  const cached = cache.get(stdgCd);
  if (cached && cached.expiresAt > Date.now()) return json(cached.data);
  try {
    const firstPage = await requestPage(serviceKey, stdgCd, 1);
    const records = collectRecords(firstPage, (record) => stringValue(field(record, "crsrdId")) !== null && field(record, "mapCtptIntLat") !== undefined);
    const pageCount = Math.min(10, Math.max(1, Math.ceil((totalCount(firstPage) ?? 0) / 1000)));
    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) records.push(...collectRecords(await requestPage(serviceKey, stdgCd, pageNo), (record) => stringValue(field(record, "crsrdId")) !== null && field(record, "mapCtptIntLat") !== undefined));
    const seen = new Set<string>();
    const intersections = records.flatMap((record) => {
      const intersection = toIntersection(record, stdgCd);
      if (!intersection || seen.has(intersection.id)) return [];
      seen.add(intersection.id);
      return [intersection];
    });
    cache.set(stdgCd, { expiresAt: Date.now() + cacheTtlMs, data: intersections });
    return json(intersections);
  } catch (caught) {
    return apiError("UPSTREAM_ERROR", caught instanceof Error ? caught.message : "교차로 목록을 불러오지 못했습니다.", 502);
  }
}
