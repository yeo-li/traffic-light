import { useEffect, useState } from "react";
import type { PedestrianSignal, SignalResponse } from "./types";

const directionNames: Record<PedestrianSignal["direction"], string> = {
  N: "북쪽", NE: "북동 방향", E: "동쪽", SE: "남동 방향",
  S: "남쪽", SW: "남서 방향", W: "서쪽", NW: "북서 방향",
};

const stateInfo = {
  WALK: { label: "진행 허용", icon: "🟢", className: "walk" },
  STOP: { label: "정지", icon: "🔴", className: "stop" },
  UNKNOWN: { label: "정보 없음", icon: "⚪", className: "unknown" },
} as const;

function formatDateTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? "확인할 수 없음"
    : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function Countdown({ signal, sourceTimestamp }: { signal: PedestrianSignal; sourceTimestamp: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  if (signal.remainingSeconds === null) {
    return <p className="remaining">잔여시간: {signal.rawRemainingValue === null ? "정보 없음" : "확인 불가"}</p>;
  }
  const sourceTime = sourceTimestamp ? Date.parse(sourceTimestamp) : now;
  const elapsedSeconds = Number.isNaN(sourceTime) ? 0 : Math.max(0, (now - sourceTime) / 1000);
  // Rounding up avoids showing 0 before the source signal has actually reached its end.
  const seconds = Math.max(0, Math.ceil((signal.remainingSeconds - elapsedSeconds) * 10) / 10);
  return <p className="remaining">잔여시간: <strong>{seconds.toFixed(1)}초</strong></p>;
}

function SignalCard({ signal, sourceTimestamp }: { signal: PedestrianSignal; sourceTimestamp: string | null }) {
  const knownState = stateInfo[signal.state];
  const info = signal.state === "UNKNOWN" && signal.rawState !== null
    ? { ...knownState, label: "확인되지 않은 상태" }
    : knownState;
  return (
    <article className="signal-card">
      <p className="direction">{directionNames[signal.direction]}</p>
      <p className={`signal-state ${info.className}`}>
        <span aria-hidden="true">{info.icon}</span> {info.label}
      </p>
      {signal.state === "UNKNOWN" && signal.rawState !== null ? <p className="raw-state">원본 상태: {signal.rawState}</p> : null}
      <Countdown signal={signal} sourceTimestamp={sourceTimestamp} />
      <p className="raw-remaining">원본값: {signal.rawRemainingValue ?? "정보 없음"}</p>
    </article>
  );
}

interface SignalPanelProps {
  intersectionName: string;
  data: SignalResponse | null;
  isLoading: boolean;
  isTransitionPending: boolean;
  hasTimingResolutionFailed: boolean;
  error: string | null;
  onRefresh: () => void;
  hasSelection: boolean;
  isCollapsed: boolean;
  onCollapse: () => void;
}

export function SignalPanel({ intersectionName, data, isLoading, isTransitionPending, hasTimingResolutionFailed, error, onRefresh, hasSelection, isCollapsed, onCollapse }: SignalPanelProps) {
  const statusText = !hasSelection
    ? "지도에서 신호등을 선택하면 실시간 보행 신호를 확인합니다."
    : isLoading
    ? "신호정보를 불러오는 중입니다."
    : error
      ? error
      : isTransitionPending
        ? "신호 전환을 확인 중입니다. 현장 신호등을 우선 확인하세요."
      : hasTimingResolutionFailed
        ? "잔여시간 정보를 확인하지 못했습니다. 현장 신호등을 우선 확인하세요."
      : data?.signals.length === 0
        ? "현재 제공되는 보행 신호정보가 없습니다."
        : null;

  if (isCollapsed) return null;

  return (
    <section className="bottom-sheet" aria-live="polite" aria-label={`${intersectionName} 신호 정보`}>
      <div className="sheet-handle" aria-hidden="true" />
      <div className="panel-heading">
        <div>
          <p className="eyebrow">선택한 교차로</p>
          <h1>{intersectionName}</h1>
        </div>
        <div className="panel-actions">
          <button className="refresh-button" type="button" onClick={onRefresh} disabled={isLoading || !hasSelection}>
            <span aria-hidden="true">↻</span> {isLoading ? "조회 중" : "새로고침"}
          </button>
          <button className="collapse-panel-button" type="button" onClick={onCollapse} aria-label="신호 정보 패널 내리기">
            <span aria-hidden="true">⌄</span> 지도 보기
          </button>
        </div>
      </div>

      <h2>보행 신호</h2>
      {statusText ? <p className={`notice ${error ? "error" : ""}`}>{statusText}</p> : null}
      {data && data.signals.length > 0 && !isTransitionPending ? <div className="signal-list">{data.signals.map((signal) => <SignalCard key={signal.direction} signal={signal} sourceTimestamp={data.sourceTimestamp} />)}</div> : null}

      <div className="metadata">
        <p>마지막 갱신 <strong>{data ? formatDateTime(data.fetchedAt) : "아직 없음"}</strong></p>
        {data?.sourceTimestamp ? <p>원본 수신 시각 <strong>{formatDateTime(data.sourceTimestamp)}</strong></p> : null}
        {data?.signals.some((signal) => signal.remainingSeconds !== null) ? <p>신호 전환 시 자동으로 최신 정보를 확인합니다.</p> : null}
      </div>
      <p className="safety-notice">실제 횡단 시에는 현장 신호등을 확인하세요.</p>
    </section>
  );
}
