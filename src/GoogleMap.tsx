import { useEffect, useRef, useState } from "react";
import type { Intersection, MapLocation, PedestrianSignal, SignalDirection, SignalState } from "./types";

type MarkerIcon = { url: string; anchor?: unknown; scaledSize?: unknown };
type JunctionShape = "crossroads" | "three-way";
interface GoogleMarker {
  setIcon: (icon: MarkerIcon) => void;
  setTitle: (title: string) => void;
  setPosition: (position: { lat: number; lng: number }) => void;
  setVisible: (visible: boolean) => void;
}

interface GoogleMapInstance {
  panTo: (position: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  getZoom: () => number | undefined;
}

interface GoogleMaps {
  LatLng: new (latitude: number, longitude: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  Map: new (container: HTMLElement, options: { center: { lat: number; lng: number }; zoom: number; mapTypeControl: boolean; streetViewControl: boolean; fullscreenControl: boolean; zoomControl: boolean; rotateControl: boolean; scaleControl: boolean; cameraControl: boolean; gestureHandling: "greedy"; scrollwheel: boolean }) => GoogleMapInstance;
  Marker: new (options: { position: { lat: number; lng: number }; map: GoogleMapInstance; title: string; icon: MarkerIcon }) => GoogleMarker;
  event: { addListener: (target: unknown, event: string, handler: () => void) => void };
}

declare global {
  interface Window { google?: { maps: GoogleMaps } }
}

let sdkPromise: Promise<GoogleMaps> | null = null;

function loadGoogleMaps(apiKey: string): Promise<GoogleMaps> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps SDK를 불러오지 못했습니다."));
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps SDK 초기화에 실패했습니다."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

interface GoogleMapProps {
  intersections: readonly Intersection[];
  selectedIntersection: Intersection | null;
  selectedSignals: readonly PedestrianSignal[];
  signalState: SignalState;
  userLocation: MapLocation | null;
  onMarkerClick: (intersection: Intersection) => void;
  onLocate: () => void;
}

const signalDescription: Record<SignalState, string> = {
  WALK: "진행 허용",
  STOP: "정지",
  UNKNOWN: "신호 정보 없음",
};

const directionName: Record<SignalDirection, string> = {
  N: "북쪽", NE: "북동쪽", E: "동쪽", SE: "남동쪽",
  S: "남쪽", SW: "남서쪽", W: "서쪽", NW: "북서쪽",
};

const gunjaStation = { lat: 37.5571793, lng: 127.0794927 };

const directionTestPhases: Record<JunctionShape, readonly { label: string; nextLabel: string; activeArms: readonly string[]; nextArms: readonly string[] }[]> = {
  crossroads: [
    { label: "① 북 ↕ 남", nextLabel: "② 동 ↔ 서", activeArms: ["north", "south"], nextArms: ["east", "west"] },
    { label: "② 동 ↔ 서", nextLabel: "③ 전체 정지", activeArms: ["east", "west"], nextArms: [] },
    { label: "③ 전체 정지", nextLabel: "① 북 ↕ 남", activeArms: [], nextArms: ["north", "south"] },
  ],
  "three-way": [
    { label: "① 북 ↔ 남서", nextLabel: "② 북 ↔ 남동", activeArms: ["north", "southwest"], nextArms: ["north", "southeast"] },
    { label: "② 북 ↔ 남동", nextLabel: "③ 전체 정지", activeArms: ["north", "southeast"], nextArms: [] },
    { label: "③ 전체 정지", nextLabel: "① 북 ↔ 남서", activeArms: [], nextArms: ["north", "southwest"] },
  ],
};

// The source provides a direction but not the exact crosswalk geometry. Keep directional
// signal pins close to the intersection while making each approach independently selectable.
const directionOffsetMeters: Record<SignalDirection, readonly [north: number, east: number]> = {
  N: [20, 0], NE: [14, 14], E: [0, 20], SE: [-14, 14],
  S: [-20, 0], SW: [-14, -14], W: [0, -20], NW: [14, -14],
};

function directionalPosition(intersection: Intersection, direction: SignalDirection) {
  const [north, east] = directionOffsetMeters[direction];
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree * Math.cos(intersection.latitude * Math.PI / 180);
  return {
    lat: intersection.latitude + north / metersPerLatitudeDegree,
    lng: intersection.longitude + east / metersPerLongitudeDegree,
  };
}

function trafficLightIcon(maps: GoogleMaps, state: SignalState, compact = false, emphasized = false): MarkerIcon {
  const redActive = state === "STOP";
  const greenActive = state === "WALK";
  const outline = state === "UNKNOWN" ? "#64748b" : greenActive ? "#15803d" : "#b91c1c";
  const width = compact ? (emphasized ? 38 : 30) : 56;
  const height = compact ? (emphasized ? 52 : 41) : 76;
  // Every pedestrian glyph stays within the signal housing; only the pointed base reaches the map coordinate.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 56 76">
    <defs><filter id="shadow" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".32"/></filter></defs>
    <g filter="url(#shadow)">
      <path d="M11 3h34a7 7 0 0 1 7 7v43a7 7 0 0 1-7 7H37L28 73 19 60h-8a7 7 0 0 1-7-7V10a7 7 0 0 1 7-7Z" fill="#11271d" stroke="${outline}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="12" y="11" width="32" height="19" rx="5" fill="${redActive ? "#e53935" : "#5f2929"}"/>
      <g fill="none" stroke="${redActive ? "#fff" : "#b77b7b"}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="28" cy="16" r="2.4" fill="${redActive ? "#fff" : "#b77b7b"}" stroke="none"/>
        <path d="M28 20v5m-6-3 6-2 6 2m-4 3-2 5-2-5"/>
      </g>
      <rect x="12" y="35" width="32" height="19" rx="5" fill="${greenActive ? "#20b55a" : "#245e3c"}"/>
      <g fill="none" stroke="${greenActive ? "#fff" : "#79aa8b"}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="29" cy="40" r="2.4" fill="${greenActive ? "#fff" : "#79aa8b"}" stroke="none"/>
        <path d="m28 44-3 5 5 2m-2-7 5 3m-8 2-4 3m9-1 4 3"/>
      </g>
    </g>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    // Fix the pointed foot to the supplied coordinate. Without this, Google Maps uses
    // each SVG's changing bounds when a selected pin becomes larger.
    anchor: new maps.Point(width / 2, height * (73 / 76)),
    scaledSize: new maps.Size(width, height),
  };
}

function clusterIcon(count: number): MarkerIcon {
  const label = count > 99 ? "99+" : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
    <circle cx="23" cy="23" r="20" fill="#0c6d4a" stroke="#fff" stroke-width="3"/>
    <text x="23" y="28" text-anchor="middle" font-family="Arial,sans-serif" font-size="${count > 99 ? 12 : 15}" font-weight="700" fill="#fff">${label}</text>
  </svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` };
}

function userLocationIcon(): MarkerIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2563eb" fill-opacity=".2"/><circle cx="12" cy="12" r="6" fill="#2563eb" stroke="white" stroke-width="2"/></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` };
}

export function GoogleMap({ intersections, selectedIntersection, selectedSignals, signalState, userLocation, onMarkerClick, onLocate }: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef(new Map<string, GoogleMarker>());
  const directionMarkersRef = useRef(new Map<SignalDirection, GoogleMarker>());
  const clusterMarkersRef = useRef(new Map<string, GoogleMarker>());
  const syncIntersectionMarkersRef = useRef<() => void>(() => undefined);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMaps | null>(null);
  const userMarkerRef = useRef<GoogleMarker | null>(null);
  const onMarkerClickRef = useRef(onMarkerClick);
  const selectedIntersectionRef = useRef<Intersection | null>(selectedIntersection);
  const directionalSelectionRef = useRef<Intersection | null>(selectedIntersection);
  const hasUserInteractedRef = useRef(false);
  const signalStateRef = useRef(signalState);
  const userLocationRef = useRef(userLocation);
  const [error, setError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<SignalDirection | null>(null);
  const [isDirectionTestOpen, setIsDirectionTestOpen] = useState(false);
  const [junctionShape, setJunctionShape] = useState<JunctionShape>("crossroads");
  const [testPhaseIndex, setTestPhaseIndex] = useState(0);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const focusCurrentLocation = () => {
    hasUserInteractedRef.current = false;
    if (userLocation && mapRef.current) {
      mapRef.current.panTo({ lat: userLocation.latitude, lng: userLocation.longitude });
      mapRef.current.setZoom(16);
    }
    onLocate();
  };

  const toggleDirectionTest = () => {
    setIsDirectionTestOpen((isOpen) => {
      const nextOpen = !isOpen;
      if (nextOpen && mapRef.current) {
        hasUserInteractedRef.current = true;
        mapRef.current.panTo(gunjaStation);
        mapRef.current.setZoom(18);
      }
      return nextOpen;
    });
  };
  const chooseJunctionShape = (shape: JunctionShape) => {
    setJunctionShape(shape);
    setTestPhaseIndex(0);
  };

  useEffect(() => { onMarkerClickRef.current = onMarkerClick; }, [onMarkerClick]);
  useEffect(() => { directionalSelectionRef.current = selectedIntersection; }, [selectedIntersection]);
  useEffect(() => { setSelectedDirection(null); }, [selectedIntersection?.id]);
  useEffect(() => {
    // The initial intersection pin is selected before its directional data arrives.
    // Keep one incoming direction emphasized so the selection does not visually shrink.
    if (!selectedDirection && selectedSignals.length > 0) setSelectedDirection(selectedSignals[0].direction);
  }, [selectedDirection, selectedSignals]);
  useEffect(() => {
    userLocationRef.current = userLocation;
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!userLocation || !map || !maps) return;
    const position = { lat: userLocation.latitude, lng: userLocation.longitude };
    if (userMarkerRef.current) userMarkerRef.current.setPosition(position);
    else userMarkerRef.current = new maps.Marker({ position, map, title: "현재 위치", icon: userLocationIcon() });
    // Do not pull the map away from an intersection the user has already selected.
    // The explicit current-location button above remains the way to recenter after that.
    if (!hasUserInteractedRef.current) {
      map.panTo(position);
      map.setZoom(16);
    }
  }, [userLocation]);
  useEffect(() => {
    const previous = selectedIntersectionRef.current;
    const maps = mapsRef.current;
    if (previous && previous.id !== selectedIntersection?.id) {
      const previousMarker = markersRef.current.get(previous.id);
      if (maps) previousMarker?.setIcon(trafficLightIcon(maps, "UNKNOWN", true));
      previousMarker?.setTitle(`${previous.name}: ${signalDescription.UNKNOWN}`);
      previousMarker?.setVisible(true);
    }
    selectedIntersectionRef.current = selectedIntersection;
    signalStateRef.current = signalState;
    if (selectedIntersection) {
      const selectedMarker = markersRef.current.get(selectedIntersection.id);
      const hasDirectionalSignals = selectedSignals.length > 0;
      // Match the emphasized directional-pin size so the selected pin does not shrink
      // when the first signal response replaces the representative intersection pin.
      if (maps) selectedMarker?.setIcon(trafficLightIcon(maps, signalState, true, true));
      selectedMarker?.setTitle(`${selectedIntersection.name}: ${signalDescription[signalState]}`);
      selectedMarker?.setVisible(!hasDirectionalSignals);
    }
  }, [selectedIntersection, selectedSignals.length, signalState]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    const selectedMarker = selectedIntersection ? markersRef.current.get(selectedIntersection.id) : null;
    const shouldSplitPins = Boolean(map && maps && selectedIntersection && selectedSignals.length > 0);

    selectedMarker?.setVisible(!shouldSplitPins);
    if (!shouldSplitPins || !map || !maps || !selectedIntersection) {
      for (const marker of directionMarkersRef.current.values()) marker.setVisible(false);
      return;
    }

    const visibleDirections = new Set(selectedSignals.map((signal) => signal.direction));
    const emphasizedDirection = selectedDirection && visibleDirections.has(selectedDirection)
      ? selectedDirection
      : selectedSignals[0]?.direction ?? null;
    for (const [direction, marker] of directionMarkersRef.current) {
      if (!visibleDirections.has(direction)) marker.setVisible(false);
    }

    for (const signal of selectedSignals) {
      const position = directionalPosition(selectedIntersection, signal.direction);
      const displayedState = signal.state;
      const title = `${selectedIntersection.name} ${directionName[signal.direction]}: ${signalDescription[displayedState]}`;
      const isEmphasized = signal.direction === emphasizedDirection;
      const existing = directionMarkersRef.current.get(signal.direction);
      if (existing) {
        existing.setPosition(position);
        existing.setIcon(trafficLightIcon(maps, displayedState, true, isEmphasized));
        existing.setTitle(title);
        existing.setVisible(true);
        continue;
      }
      const marker = new maps.Marker({
        position,
        map,
        title,
        icon: trafficLightIcon(maps, displayedState, true, isEmphasized),
      });
      directionMarkersRef.current.set(signal.direction, marker);
      maps.event.addListener(marker, "click", () => {
        hasUserInteractedRef.current = true;
        setSelectedDirection(signal.direction);
        const currentSelection = directionalSelectionRef.current;
        if (currentSelection) onMarkerClickRef.current(currentSelection);
      });
    }
  }, [isMapReady, selectedDirection, selectedIntersection, selectedSignals]);

  // Google Maps does not provide clustering for legacy Marker instances by default.
  // This lightweight grid clusters nearby intersections only while zoomed out.
  syncIntersectionMarkersRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom() ?? 15;
    const selectedId = selectedIntersection?.id;
    const selectedHasDirectionalPins = selectedSignals.length > 0;
    for (const marker of clusterMarkersRef.current.values()) marker.setVisible(false);

    if (zoom >= 15) {
      for (const intersection of intersections) {
        const marker = markersRef.current.get(intersection.id);
        marker?.setVisible(intersection.id !== selectedId || !selectedHasDirectionalPins);
      }
      return;
    }

    const cellDegrees = (72 * 360) / (256 * 2 ** zoom);
    const groups = new Map<string, Intersection[]>();
    for (const intersection of intersections) {
      if (intersection.id === selectedId) {
        markersRef.current.get(intersection.id)?.setVisible(!selectedHasDirectionalPins);
        continue;
      }
      const key = `${Math.floor(intersection.latitude / cellDegrees)}:${Math.floor(intersection.longitude / cellDegrees)}`;
      const group = groups.get(key) ?? [];
      group.push(intersection);
      groups.set(key, group);
    }

    for (const [key, group] of groups) {
      if (group.length === 1) {
        markersRef.current.get(group[0].id)?.setVisible(true);
        continue;
      }
      for (const intersection of group) markersRef.current.get(intersection.id)?.setVisible(false);
      const position = {
        lat: group.reduce((sum, intersection) => sum + intersection.latitude, 0) / group.length,
        lng: group.reduce((sum, intersection) => sum + intersection.longitude, 0) / group.length,
      };
      const title = `${group.length}개 교차로 — 눌러서 확대`;
      const existing = clusterMarkersRef.current.get(key);
      if (existing) {
        existing.setPosition(position);
        existing.setIcon(clusterIcon(group.length));
        existing.setTitle(title);
        existing.setVisible(true);
        continue;
      }
      const maps = mapsRef.current;
      if (!maps) continue;
      const marker = new maps.Marker({ position, map, title, icon: clusterIcon(group.length) });
      clusterMarkersRef.current.set(key, marker);
      maps.event.addListener(marker, "click", () => {
        hasUserInteractedRef.current = true;
        map.panTo(position);
        map.setZoom(Math.min(15, zoom + 2));
      });
    }
  };

  useEffect(() => {
    if (isMapReady) syncIntersectionMarkersRef.current();
  }, [intersections, isMapReady, selectedIntersection, selectedSignals]);

  useEffect(() => {
    if (!apiKey) { setError("Google Maps API 키가 설정되지 않았습니다."); return; }
    const container = containerRef.current;
    if (!container) return;
    setIsMapReady(false);
    let cancelled = false;
    void loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled) return;
      const map = new maps.Map(container, {
        center: userLocationRef.current
          ? { lat: userLocationRef.current.latitude, lng: userLocationRef.current.longitude }
          : { lat: 37.5665, lng: 126.978 },
        zoom: userLocationRef.current ? 16 : 11,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,
        rotateControl: false,
        scaleControl: false,
        cameraControl: false,
        gestureHandling: "greedy",
        scrollwheel: true,
      });
      mapRef.current = map;
      mapsRef.current = maps;
      markersRef.current.clear();
      directionMarkersRef.current.clear();
      clusterMarkersRef.current.clear();
      if (userLocationRef.current) {
        userMarkerRef.current = new maps.Marker({
          position: { lat: userLocationRef.current.latitude, lng: userLocationRef.current.longitude },
          map,
          title: "현재 위치",
          icon: userLocationIcon(),
        });
      }
      for (const intersection of intersections) {
        const isSelected = intersection.id === selectedIntersectionRef.current?.id;
        const marker = new maps.Marker({
          position: { lat: intersection.latitude, lng: intersection.longitude },
          map,
          title: `${intersection.name}: ${signalDescription[isSelected ? signalStateRef.current : "UNKNOWN"]}`,
          icon: trafficLightIcon(maps, isSelected ? signalStateRef.current : "UNKNOWN", true, isSelected),
        });
        markersRef.current.set(intersection.id, marker);
        maps.event.addListener(marker, "click", () => {
          hasUserInteractedRef.current = true;
          onMarkerClickRef.current(intersection);
        });
      }
      maps.event.addListener(map, "zoom_changed", () => syncIntersectionMarkersRef.current());
      setIsMapReady(true);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Google 지도를 표시할 수 없습니다.");
    });
    return () => { cancelled = true; };
  // Signal refreshes intentionally do not appear here: Google Maps is loaded once per page visit.
  }, [apiKey, intersections]);

  return (
    <section className="map-area" aria-label="서울 보행 신호 교차로 구글 지도">
      <div ref={containerRef} className="map" />
      <button type="button" className="direction-test-toggle" onClick={toggleDirectionTest} aria-expanded={isDirectionTestOpen}>
        <span aria-hidden="true">⌘</span> 방향성 테스트
      </button>
      {isDirectionTestOpen ? <DirectionalityTest shape={junctionShape} phaseIndex={testPhaseIndex} onShapeChange={chooseJunctionShape} onPhaseChange={setTestPhaseIndex} /> : null}
      <button type="button" className="current-location-button" onClick={focusCurrentLocation} aria-label="현재 위치로 지도 이동">
        <span aria-hidden="true">◎</span> 현재 위치
      </button>
      {error ? <div className="map-error"><strong>구글 지도를 표시할 수 없습니다.</strong><span>{error}</span><code>VITE_GOOGLE_MAPS_API_KEY</code>를 설정한 뒤 서버를 다시 시작하세요.</div> : null}
    </section>
  );
}

function DirectionalityTest({ shape, phaseIndex, onShapeChange, onPhaseChange }: {
  shape: JunctionShape;
  phaseIndex: number;
  onShapeChange: (shape: JunctionShape) => void;
  onPhaseChange: (index: number) => void;
}) {
  const phases = directionTestPhases[shape];
  const phase = phases[phaseIndex] ?? phases[0];
  const isActive = (arm: string) => phase.activeArms.includes(arm);
  const isNext = (arm: string) => phase.nextArms.includes(arm);
  const arm = (name: string, label: string) => <span className={`junction-arm ${name} ${isActive(name) ? "active" : ""} ${!isActive(name) && isNext(name) ? "next" : ""}`}><b>{label}</b><small>{isActive(name) ? "현재" : isNext(name) ? "다음" : "대기"}</small></span>;
  return (
    <aside className="direction-test-panel" aria-label="군자역 방향성 테스트">
      <div className="direction-test-heading">
        <div><p>군자역 인근</p><strong>횡단 방향성 실험</strong></div>
        <span>TEST</span>
      </div>
      <p className="direction-test-caption">신호 API 없이, 현재 보행 신호 다음에 어느 방향이 바뀌는지 검토합니다.</p>
      <div className="junction-tabs" role="tablist" aria-label="교차로 형태">
        <button type="button" className={shape === "crossroads" ? "selected" : ""} onClick={() => onShapeChange("crossroads")}>사거리</button>
        <button type="button" className={shape === "three-way" ? "selected" : ""} onClick={() => onShapeChange("three-way")}>삼거리</button>
      </div>
      <div className={`junction-diagram ${shape}`} aria-label={`${shape === "crossroads" ? "사거리" : "삼거리"} ${phase.label}`}>
        {shape === "crossroads" ? <><i className="road vertical" /><i className="road horizontal" />{arm("north", "북")}{arm("east", "동")}{arm("south", "남")}{arm("west", "서")}</> : <><i className="road stem" /><i className="road branch-left" /><i className="road branch-right" />{arm("north", "북")}{arm("southwest", "남서")}{arm("southeast", "남동")}</>}
        <span className="junction-core">보행<br />신호</span>
      </div>
      <div className="phase-picker" aria-label="신호 단계 선택">
        {phases.map((item, index) => <button key={item.label} type="button" className={index === phaseIndex ? "selected" : ""} onClick={() => onPhaseChange(index)}>{item.label}</button>)}
      </div>
      <p className="phase-description"><strong>{phase.label}</strong><span aria-hidden="true"> → </span><strong>{phase.nextLabel}</strong> 순서로 바뀝니다.</p>
      <p className="direction-test-note">초록은 현재 신호, 노랑은 다음 신호입니다. 실제 횡단보도 배치는 현장·지도 데이터로 확정합니다.</p>
    </aside>
  );
}
