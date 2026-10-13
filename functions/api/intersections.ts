import { fetchRtiRecords, field, nullableNumber, nullableString, RtiError, type RtiEnv } from "./rti";

interface Env extends RtiEnv {}

interface Intersection { id: string; name: string; latitude: number; longitude: number; standardRegionCode: string }

const mapCacheTtlMs = 24 * 60 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; data: readonly Intersection[] }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
}

function apiError(error: string, message: string, status: number) { return json({ error, message }, status); }

function toIntersection(record: Record<string, unknown>, fallbackRegionCode: string): Intersection | null {
  const id = nullableString(field(record, "crsrdId"));
  const name = nullableString(field(record, "crsrdNm"));
  const latitude = nullableNumber(field(record, "mapCtptIntLat"));
  const longitude = nullableNumber(field(record, "mapCtptIntLot"));
  const standardRegionCode = nullableString(field(record, "stdgCd")) ?? fallbackRegionCode;
  if (!id || !name || latitude === null || longitude === null || !/^\d+$/.test(id) || !/^\d{10}$/.test(standardRegionCode)) return null;
  return { id, name, latitude, longitude, standardRegionCode };
}

export async function getIntersections(request: Request, env: RtiEnv): Promise<Response> {
  const stdgCd = new URL(request.url).searchParams.get("stdgCd");
  if (!stdgCd || !/^\d{10}$/.test(stdgCd)) return apiError("BAD_REQUEST", "10자리 stdgCd가 필요합니다.", 400);
  const cached = cache.get(stdgCd);
  if (cached && cached.expiresAt > Date.now()) return json(cached.data, 200);
  try {
    const records = await fetchRtiRecords(env, "/crsrd_map_info", stdgCd, (record) => nullableString(field(record, "crsrdId")) !== null && field(record, "mapCtptIntLat") !== undefined);
    const seen = new Set<string>();
    const intersections = records.flatMap((record) => {
      const intersection = toIntersection(record, stdgCd);
      if (!intersection || seen.has(intersection.id)) return [];
      seen.add(intersection.id);
      return [intersection];
    });
    cache.set(stdgCd, { expiresAt: Date.now() + mapCacheTtlMs, data: intersections });
    return json(intersections, 200);
  } catch (caught) {
    const status = caught instanceof RtiError ? caught.status : 502;
    const message = caught instanceof Error ? caught.message : "교차로 목록을 불러오지 못했습니다.";
    return apiError(status === 503 ? "CONFIGURATION_ERROR" : "UPSTREAM_ERROR", message, status);
  }
}

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => getIntersections(request, env);
