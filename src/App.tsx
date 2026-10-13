import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIntersections, fetchSignals, SignalApiError } from "./api";
import { GoogleMap } from "./GoogleMap";
import { SignalPanel } from "./SignalPanel";
import type { Intersection, MapLocation, SignalResponse, SignalState } from "./types";

function getMapSignalState(data: SignalResponse | null, isTransitionPending: boolean): SignalState {
  if (isTransitionPending) return "UNKNOWN";
  if (!data || data.signals.length === 0) return "UNKNOWN";
  if (data.signals.some((signal) => signal.state === "WALK")) return "WALK";
  if (data.signals.every((signal) => signal.state === "STOP")) return "STOP";
  return "UNKNOWN";
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
  const [isTransitionPending, setIsTransitionPending] = useState(false);
  const [hasTimingResolutionFailed, setHasTimingResolutionFailed] = useState(false);
  const [isSignalPanelCollapsed, setIsSignalPanelCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mapAbortRef = useRef<AbortController | null>(null);
  const unusableTimingRetriesRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!selectedIntersection) return;
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchSignals(selectedIntersection, controller.signal);
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
      setIsTransitionPending(false);
      setHasTimingResolutionFailed(false);
      unusableTimingRetriesRef.current = 0;
      setSelectedIntersection(intersection);
    }
  }, [selectedIntersection?.id]);
  const manualRefresh = useCallback(() => {
    unusableTimingRetriesRef.current = 0;
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
  const mapSignalState = getMapSignalState(signalData, isTransitionPending);

  useEffect(() => {
    if (!selectedIntersection) return;
    void refresh();
    return () => abortRef.current?.abort();
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
      if (!hasUnusableTiming) return;
      if (unusableTimingRetriesRef.current >= 5) {
        setHasTimingResolutionFailed(true);
        return;
      }
      setHasTimingResolutionFailed(false);
      const timer = window.setTimeout(() => {
        unusableTimingRetriesRef.current += 1;
        void refresh();
      }, 2_000);
      return () => window.clearTimeout(timer);
    }
    unusableTimingRetriesRef.current = 0;
    setHasTimingResolutionFailed(false);

    const now = Date.now();
    const isExpired = earliestExpiry <= now;
    setIsTransitionPending(isExpired);

    // Refresh only after the predicted transition. If upstream data is still old after zero,
    // poll at its observed update cadence until a fresh phase arrives.
    const retryIntervalMs = 1_200;
    const cacheSafetyDelayMs = 1_100;
    const fetchedTime = Date.parse(signalData.fetchedAt);
    const cacheReadyAt = Number.isNaN(fetchedTime) ? 0 : fetchedTime + cacheSafetyDelayMs;
    const nextCheckAt = isExpired ? now + retryIntervalMs : earliestExpiry;
    const delay = Math.max(0, nextCheckAt, cacheReadyAt) - now;
    const timer = window.setTimeout(() => {
      if (Date.now() >= earliestExpiry) setIsTransitionPending(true);
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isLoading, refresh, signalData]);

  return (
    <main className={`app-shell ${isSignalPanelCollapsed ? "panel-collapsed" : ""}`}>
      <header className="top-bar">
        <span aria-hidden="true">🚦</span><strong>건널까?</strong>
        <p>보행 신호 참고 정보</p>
      </header>
      <GoogleMap
        intersections={intersections}
        selectedIntersection={selectedIntersection}
        selectedSignals={signalData?.signals ?? []}
        signalState={mapSignalState}
        isTransitionPending={isTransitionPending}
        userLocation={userLocation}
        onMarkerClick={openSignalPanel}
        onLocate={requestUserLocation}
      />
      {mapError ? <p className="map-load-error">{mapError}</p> : null}
      <SignalPanel
        intersectionName={selectedIntersection?.name ?? "교차로를 선택하세요"}
        data={signalData}
        isLoading={isLoading}
        isTransitionPending={isTransitionPending}
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
