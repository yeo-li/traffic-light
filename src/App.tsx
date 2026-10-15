import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchIntersections, fetchSignals, SignalApiError } from "./api";
import { GoogleMap } from "./GoogleMap";
import { SignalPanel } from "./SignalPanel";
import type { Intersection, MapLocation, SignalDirection, SignalResponse, SignalState } from "./types";

function getMapSignalState(data: SignalResponse | null): SignalState {
  if (!data || data.signals.length === 0) return "UNKNOWN";
  if (data.signals.some((signal) => signal.state === "WALK")) return "WALK";
  if (data.signals.every((signal) => signal.state === "STOP")) return "STOP";
  return "UNKNOWN";
}

function predictedNextState(state: SignalState): SignalState {
  if (state === "WALK") return "STOP";
  if (state === "STOP") return "WALK";
  return "UNKNOWN";
}

function distanceTo(location: MapLocation, intersection: Intersection): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(intersection.latitude - location.latitude);
  const longitudeDelta = toRadians(intersection.longitude - location.longitude);
  const startLatitude = toRadians(location.latitude);
  const endLatitude = toRadians(intersection.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toUserMessage(error: unknown): string {
  if (error instanceof SignalApiError) {
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `${error.retryAfterSeconds}초 뒤에 다시 시도해 주세요.`
        : "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    }
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") return "";
  return "신호정보를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.";
}

export function App() {
  const [selectedIntersection, setSelectedIntersection] = useState<Intersection | null>(null);
  const [intersections, setIntersections] = useState<readonly Intersection[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<MapLocation | null>(null);
  const [signalData, setSignalData] = useState<SignalResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTimingResolutionFailed, setHasTimingResolutionFailed] = useState(false);
  const [isSignalPanelCollapsed, setIsSignalPanelCollapsed] = useState(false);
  const [predictedSignalStates, setPredictedSignalStates] = useState<Partial<Record<SignalDirection, SignalState>>>({});
  const [predictionTick, setPredictionTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const mapAbortRef = useRef<AbortController | null>(null);
  const hasAutoSelectedNearestRef = useRef(false);
  const completedPredictionKeysRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!selectedIntersection) return;
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchSignals(selectedIntersection, controller.signal);
      completedPredictionKeysRef.current.clear();
      setPredictedSignalStates({});
      setPredictionTick((tick) => tick + 1);
      setSignalData(response);
    } catch (caught) {
      const message = toUserMessage(caught);
      if (message) {
        // Never leave stale data on screen as though it were current signal information.
        setSignalData(null);
        setError(message);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [selectedIntersection]);

  // Keep this stable so refreshing signal data never recreates the map instance.
  const openSignalPanel = useCallback((intersection: Intersection) => {
    setIsSignalPanelCollapsed(false);
    if (intersection.id !== selectedIntersection?.id) {
      abortRef.current?.abort();
      abortRef.current = null;
      setSignalData(null);
      setError(null);
      setHasTimingResolutionFailed(false);
      completedPredictionKeysRef.current.clear();
      setPredictedSignalStates({});
      setSelectedIntersection(intersection);
    }
  }, [selectedIntersection?.id]);
  const manualRefresh = useCallback(() => {
    setHasTimingResolutionFailed(false);
    void refresh();
  }, [refresh]);
  const requestUserLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserLocation({ latitude: coords.latitude, longitude: coords.longitude }),
      () => { /* Keep the currently displayed map available when permission is unavailable. */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, []);
  const displayedSignalData = useMemo(() => {
    if (!signalData || Object.keys(predictedSignalStates).length === 0) return signalData;
    return {
      ...signalData,
      signals: signalData.signals.map((signal) => {
        const predictedState = predictedSignalStates[signal.direction];
        return predictedState === undefined
          ? signal
          : { ...signal, state: predictedState, remainingSeconds: null, rawRemainingValue: null };
      }),
    };
  }, [predictedSignalStates, signalData]);
  const mapSignalState = getMapSignalState(displayedSignalData);

  useEffect(() => {
    if (!selectedIntersection) return;
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh, selectedIntersection]);

  useEffect(() => {
    if (!selectedIntersection) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const correctionTimer = window.setInterval(refreshWhenVisible, 5 * 60 * 1_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(correctionTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh, selectedIntersection]);

  useEffect(() => {
    mapAbortRef.current?.abort();
    const controller = new AbortController();
    mapAbortRef.current = controller;
    setIntersections([]);
    setMapError(null);
    setSelectedIntersection(null);
    setSignalData(null);
    setError(null);
    void fetchIntersections("1100000000", controller.signal)
      .then((items) => setIntersections(items))
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setMapError(toUserMessage(caught));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    requestUserLocation();
  }, [requestUserLocation]);

  useEffect(() => {
    // Select once only: later location updates must not override a pin the user chose.
    if (hasAutoSelectedNearestRef.current || selectedIntersection || !userLocation || intersections.length === 0) return;
    const nearest = intersections.reduce((closest, intersection) => (
      distanceTo(userLocation, intersection) < distanceTo(userLocation, closest) ? intersection : closest
    ));
    hasAutoSelectedNearestRef.current = true;
    openSignalPanel(nearest);
  }, [intersections, openSignalPanel, selectedIntersection, userLocation]);

  useEffect(() => {
    if (!signalData || isLoading || signalData.signals.length === 0) return;
    const sourceTime = signalData.sourceTimestamp ? Date.parse(signalData.sourceTimestamp) : Date.parse(signalData.fetchedAt);
    if (Number.isNaN(sourceTime)) return;
    const earliestExpiry = signalData.signals.reduce<number | null>((earliest, signal) => {
      if (signal.remainingSeconds === null) return earliest;
      const expiry = sourceTime + signal.remainingSeconds * 1_000;
      return earliest === null ? expiry : Math.min(earliest, expiry);
    }, null);
    if (earliestExpiry === null) {
      const hasUnusableTiming = signalData.signals.some(
        (signal) => signal.rawRemainingValue !== null && signal.remainingSeconds === null,
      );
      setHasTimingResolutionFailed(hasUnusableTiming);
      return;
    }
    setHasTimingResolutionFailed(false);

    const now = Date.now();
    const newlyExpired = signalData.signals.filter((signal) => {
      if (signal.remainingSeconds === null) return false;
      const key = `${signal.direction}:${sourceTime + signal.remainingSeconds * 1_000}`;
      return sourceTime + signal.remainingSeconds * 1_000 <= now && !completedPredictionKeysRef.current.has(key);
    });
    if (newlyExpired.length > 0) {
      for (const signal of newlyExpired) {
        completedPredictionKeysRef.current.add(`${signal.direction}:${sourceTime + (signal.remainingSeconds ?? 0) * 1_000}`);
      }
      setPredictedSignalStates((states) => ({
        ...states,
        ...Object.fromEntries(newlyExpired.map((signal) => [signal.direction, predictedNextState(signal.state)])),
      }));
      setPredictionTick((tick) => tick + 1);
      return;
    }
    const nextExpiry = signalData.signals.reduce<number | null>((nearest, signal) => {
      if (signal.remainingSeconds === null) return nearest;
      const expiry = sourceTime + signal.remainingSeconds * 1_000;
      const key = `${signal.direction}:${expiry}`;
      if (completedPredictionKeysRef.current.has(key)) return nearest;
      return nearest === null ? expiry : Math.min(nearest, expiry);
    }, null);
    if (nextExpiry === null) return;
    const delay = Math.max(0, nextExpiry - now);
    const timer = window.setTimeout(() => {
      setPredictionTick((tick) => tick + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isLoading, predictionTick, signalData]);

  return (
    <main className={`app-shell ${isSignalPanelCollapsed ? "panel-collapsed" : ""}`}>
      <header className="top-bar">
        <span aria-hidden="true">🚦</span><strong>언제 건널까</strong>
        <p>보행 신호 참고 정보</p>
      </header>
      <GoogleMap
        intersections={intersections}
        selectedIntersection={selectedIntersection}
        selectedSignals={displayedSignalData?.signals ?? []}
        signalState={mapSignalState}
        userLocation={userLocation}
        onMarkerClick={openSignalPanel}
        onLocate={requestUserLocation}
      />
      {mapError ? <p className="map-load-error">{mapError}</p> : null}
      <SignalPanel
        intersectionName={selectedIntersection?.name ?? "교차로를 선택하세요"}
        data={displayedSignalData}
        isLoading={isLoading}
        predictedDirections={Object.keys(predictedSignalStates) as SignalDirection[]}
        hasTimingResolutionFailed={hasTimingResolutionFailed}
        error={error}
        onRefresh={manualRefresh}
        hasSelection={selectedIntersection !== null}
        isCollapsed={isSignalPanelCollapsed}
        onCollapse={() => setIsSignalPanelCollapsed(true)}
      />
    </main>
  );
}
