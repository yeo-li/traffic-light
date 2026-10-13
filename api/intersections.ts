import { getIntersections } from "../functions/api/intersections";

declare const process: { env: Record<string, string | undefined> };

// Vercel maps this file to GET /api/intersections.
export function GET(request: Request): Promise<Response> {
  return getIntersections(request, { NATIONAL_RTI_SERVICE_KEY: process.env.NATIONAL_RTI_SERVICE_KEY });
}
