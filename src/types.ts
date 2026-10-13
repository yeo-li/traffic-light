export type SignalState = "WALK" | "STOP" | "UNKNOWN";

export type SignalDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface Intersection {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  standardRegionCode: string;
}

export interface MapLocation {
  latitude: number;
  longitude: number;
}

export interface PedestrianSignal {
  direction: SignalDirection;
  state: SignalState;
  rawState: string | null;
  rawRemainingValue: number | null;
  /** Valid T-Data RmdrCs values are deciseconds; unavailable/sentinel values remain null. */
  remainingSeconds: number | null;
}

export interface SignalResponse {
  intersectionId: string;
  sourceTimestamp: string | null;
  fetchedAt: string;
  signals: PedestrianSignal[];
}

export interface ApiError {
  error: "BAD_REQUEST" | "NOT_FOUND" | "RATE_LIMITED" | "UPSTREAM_ERROR" | "CONFIGURATION_ERROR";
  message: string;
  retryAfterSeconds?: number;
}
