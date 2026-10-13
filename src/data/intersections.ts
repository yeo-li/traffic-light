import crossroadCsv from "./v2xCrossroadMapInformation_20241114_final.csv?raw";
import type { Intersection } from "../types";

function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell); cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function loadIntersections(csv: string): readonly Intersection[] {
  const unique = new Set<string>();
  return csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).flatMap((row) => {
    const [id, name, latitude, longitude] = parseCsvRow(row);
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    if (!/^\d+$/.test(id) || !name || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude) || unique.has(id)) return [];
    unique.add(id);
    return [{ id, name, latitude: parsedLatitude, longitude: parsedLongitude, standardRegionCode: "1100000000" }];
  });
}

export const intersections = loadIntersections(crossroadCsv);
export const defaultIntersection = intersections.find((intersection) => intersection.id === "20386") ?? intersections[0];
