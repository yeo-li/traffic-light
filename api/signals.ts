import { getSignals } from "../functions/api/signals";

declare const process: { env: Record<string, string | undefined> };

// Vercel maps this file to GET /api/signals.
export function GET(request: Request): Promise<Response> {
  return getSignals(request, process.env.T_DATA_API_KEY);
}
