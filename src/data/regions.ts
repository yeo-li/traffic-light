export const regions = [
  { id: "seoul", name: "서울", standardRegionCode: "1100000000" },
  { id: "gyeonggi", name: "경기도", standardRegionCode: "4100000000" },
] as const;

export type RegionId = (typeof regions)[number]["id"];

export function regionById(id: RegionId) {
  return regions.find((region) => region.id === id) ?? regions[0];
}
