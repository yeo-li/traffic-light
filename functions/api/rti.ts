export interface RtiEnv { NATIONAL_RTI_SERVICE_KEY?: string }

export const rtiBaseUrl = "https://apis.data.go.kr/B551982/rti";

export class RtiError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function field(record: Record<string, unknown>, name: string): unknown {
  if (record[name] !== undefined) return record[name];
  const found = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? record[found] : undefined;
}

export function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function nullableNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function collectRecords(value: unknown, predicate: (record: Record<string, unknown>) => boolean, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, predicate, found);
    return found;
  }
  const record = asRecord(value);
  if (!record) return found;
  if (predicate(record)) found.push(record);
  for (const child of Object.values(record)) collectRecords(child, predicate, found);
  return found;
}

function totalCount(value: unknown): number | null {
  const records = collectRecords(value, (record) => field(record, "totalCount") !== undefined);
  for (const record of records) {
    const count = nullableNumber(field(record, "totalCount"));
    if (count !== null) return count;
  }
  return null;
}

function resultError(value: unknown): string | null {
  const records = collectRecords(value, (record) => field(record, "resultCode") !== undefined || field(record, "resultMsg") !== undefined || field(record, "returnReasonCode") !== undefined);
  for (const record of records) {
    const code = nullableString(field(record, "resultCode"));
    const authCode = nullableString(field(record, "returnReasonCode"));
    const message = nullableString(field(record, "resultMsg")) ?? nullableString(field(record, "returnAuthMsg")) ?? nullableString(field(record, "errMsg"));
    // K3/NODATA_ERROR is the provider's normal empty-result response, not an API failure.
    if (code && !["00", "0", "K0", "K3", "NORMAL_SERVICE"].includes(code)) return message ?? `공공데이터 API 오류 (${code})`;
    if (authCode && !["00", "0", "NORMAL_SERVICE"].includes(authCode)) return message ?? `공공데이터 API 오류 (${authCode})`;
  }
  return null;
}

async function requestPage(env: RtiEnv, path: string, stdgCd: string, pageNo: number): Promise<unknown> {
  if (!env.NATIONAL_RTI_SERVICE_KEY) throw new RtiError("전국 신호 API가 아직 설정되지 않았습니다.", 503);
  const url = new URL(`${rtiBaseUrl}${path}`);
  // data.go.kr shows both percent-encoded and decoded variants of a key.
  // Normalise first because URLSearchParams performs the single final encoding.
  let serviceKey = env.NATIONAL_RTI_SERVICE_KEY;
  try { serviceKey = decodeURIComponent(serviceKey); } catch { /* keep an already-decoded key */ }
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("type", "json");
  url.searchParams.set("stdgCd", stdgCd);
  let response: Response;
  try { response = await fetch(url.toString()); }
  catch { throw new RtiError("전국 신호 API에 연결하지 못했습니다."); }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new RtiError(payload ? resultError(payload) ?? "전국 신호 API를 불러오지 못했습니다." : "전국 신호 API를 불러오지 못했습니다.", response.status === 429 ? 429 : 502);
  if (!payload) throw new RtiError("전국 신호 API 응답을 해석하지 못했습니다.");
  const error = resultError(payload);
  if (error) throw new RtiError(error, 502);
  return payload;
}

export async function fetchRtiRecords(env: RtiEnv, path: string, stdgCd: string, isRecord: (record: Record<string, unknown>) => boolean): Promise<Record<string, unknown>[]> {
  const firstPage = await requestPage(env, path, stdgCd, 1);
  const records = collectRecords(firstPage, isRecord);
  const count = totalCount(firstPage);
  const pageCount = count === null ? 1 : Math.min(10, Math.max(1, Math.ceil(count / 1000)));
  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    const page = await requestPage(env, path, stdgCd, pageNo);
    records.push(...collectRecords(page, isRecord));
  }
  return records;
}
