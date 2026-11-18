import { createTrackingFilter, INVALID_HOLD_MS } from "./tracking-filter";
import { useCallback, useEffect, useState } from "react";
import { parseBridgeMessage, TRACKING_TIMEOUT_MS, type PositionMessage, type RangeMessage } from "../lib/uwb/protocol";
import { solvePosition, type BridgeConfig } from "../lib/uwb/solver";
import { calibrateAtCentre, correctRanges, type RangeCorrection } from "../lib/uwb/range-calibration";

type CorrectionProfile = { calibration: BridgeConfig; tagId: string; corrections: RangeCorrection[] };

export function useDevicePosition(enabled: boolean, calibration: BridgeConfig | null = null) {
  const [request, setRequest] = useState<{ url: string; tagId: string } | null>(null);
  const [profile, setProfile] = useState<CorrectionProfile | null>(null);
  const activeProfile = profile?.calibration === calibration && profile?.tagId === request?.tagId ? profile : null;
  const [capture, setCapture] = useState<{ calibration: BridgeConfig; request: typeof request } | null>(null);
  const capturing = !!capture && capture.calibration === calibration && capture.request === request;
  const [correctionError, setCorrectionError] = useState("");
  const [position, setPosition] = useState<{ value: PositionMessage; calibration: BridgeConfig | null; profile: CorrectionProfile | null } | null>(null);
  const [ranges, setRanges] = useState<RangeMessage | null>(null);
  const [status, setStatus] = useState("PC 수신기에 연결하세요.");
  const connect = useCallback((url: string, tagId: string) => {
    setPosition(null);
    setRanges(null);
    setRequest({ url, tagId });
  }, []);
  const disconnect = useCallback(() => {
    setCapture(null);
    setRequest(null); setPosition(null); setRanges(null); setStatus("연결 종료 · 오디오 정지");
  }, []);

  useEffect(() => {
    setPosition(null);
    setRanges(null);
    if (!enabled || !request) return;
    let socket: WebSocket;
    try {
      const url = new URL(request.url);
      if (!["ws:", "wss:"].includes(url.protocol)) throw new Error();
      socket = new WebSocket(url);
    } catch { setStatus("WebSocket 주소를 확인하세요."); return; }
    let disposed = false;
    let lastReceived = 0;
    let lastSequence = -1;
    let rangesOnly = false;
    let previous: PositionMessage | null = null;
    let previousTime = 0;
    const frames: RangeMessage[] = [];
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    setStatus("PC 수신기에 연결 중");
    const tracking = createTrackingFilter();
    let invalidTimer: ReturnType<typeof setTimeout> | undefined;
    let lastValid = -Infinity;
    const cancelHold = () => { clearTimeout(invalidTimer); invalidTimer = undefined; };
    const clear = (message: string) => { cancelHold(); tracking.reset(); lastValid = -Infinity; previous = null; setPosition(null); setRanges(null); setStatus(message); };
    socket.onopen = () => {
      if (disposed) return;
      setStatus(`태그 ${request.tagId} 데이터 대기`);
      if (capturing && calibration) captureTimer = setTimeout(() => {
        if (disposed) return;
        try {
          if (!lastReceived || performance.now() - lastReceived > TRACKING_TIMEOUT_MS) throw new Error("거리 수신이 끊겼습니다. 다시 연결한 뒤 보정하세요.");
          setProfile({ calibration, tagId: request.tagId, corrections: calibrateAtCentre(frames, calibration) });
          setCorrectionError("");
        } catch (e) { setCorrectionError((e as Error).message); }
        setCapture(null);
      }, 5000);
    };
    socket.onmessage = (event) => {
      if (disposed) return;
      try {
        if (typeof event.data !== "string") throw new Error();
        const message = parseBridgeMessage(event.data);
        if (message.tagId !== request.tagId || message.seq <= lastSequence) return;
        lastSequence = message.seq;
        lastReceived = performance.now();
        rangesOnly = message.type === "ranges";
        if (message.type === "ranges") {
          cancelHold(); tracking.reset(); lastValid = -Infinity;
          setRanges(message);
          if (capturing) {
            if (frames.length < 2000) frames.push(message);
            setPosition(null);
            setStatus("중앙 보정 측정 중 · 5초간 태그를 움직이지 마세요.");
            return;
          }
          if (!calibration) {
            setPosition(null);
            setStatus(`태그 ${message.tagId} 거리 수신 중 · 유효 앵커 ${message.ranges.length}개 · 좌표 계산 안 함`);
            return;
          }
          try {
            const point = solvePosition(activeProfile ? correctRanges(message.ranges, activeProfile.corrections) : message.ranges, calibration);
            const now = performance.now();
            const value: PositionMessage = { ...point, type: "position", tagId: message.tagId,
              seq: message.seq, receivedAt: message.receivedAt, heightSource: "fixed" };
            if (previous && now - previousTime < TRACKING_TIMEOUT_MS && calibration.smoothingMs) {
              const alpha = 1 - Math.exp(-(now - previousTime) / calibration.smoothingMs);
              value.x = previous.x + alpha * (value.x - previous.x);
              value.z = previous.z + alpha * (value.z - previous.z);
            }
            previous = value; previousTime = now;
            setPosition({ value, calibration, profile: activeProfile });
            setStatus(`태그 ${message.tagId} 위치 수신 중 · 앵커 ${point.anchors}개 · 태그 높이 고정`);
          } catch (error) {
            previous = null; setPosition(null);
            setStatus(`거리 수신 중 · ${(error as Error).message} · 오디오 정지`);
          }
          return;
        }
        setRanges(null);
        if (calibration) {
          clear("페이지의 배치를 사용하려면 PC 수신기를 --ranges-only로 실행하세요.");
          return;
        }
        if (message.type === "invalid") {
          const reason = `${message.error} · 오디오 정지`;
          const remaining = INVALID_HOLD_MS - (performance.now() - lastValid);
          if (remaining <= 0) clear(reason);
          else invalidTimer ??= setTimeout(() => clear(reason), remaining);
          return;
        }
        cancelHold();
        lastValid = performance.now();
        const filtered = tracking.update(message, lastValid);
        if (filtered) setPosition({ value: filtered, calibration, profile: activeProfile });
        setStatus(`태그 ${message.tagId} 수신 중 · ${message.heightSource === "fixed" ? "높이 고정" : "높이 UWB 계산"}`);
      } catch { clear("수신 데이터 오류 · 오디오 정지"); }
    };
    socket.onerror = () => { if (!disposed) { lastReceived = 0; clear("PC 수신기 연결 실패 · 오디오 정지"); } };
    socket.onclose = () => { if (!disposed) { lastReceived = 0; clear("PC 수신기 연결 끊김 · 오디오 정지"); } };
    const timer = window.setInterval(() => {
      if (lastReceived && performance.now() - lastReceived > TRACKING_TIMEOUT_MS) {
        lastReceived = 0;
        clear(rangesOnly ? "1초 동안 거리 수신 없음" : "1초 동안 위치 수신 없음 · 오디오 정지");
      }
    }, 100);
    const connectionTimeout = window.setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    }, 5000);
    return () => {
      disposed = true;
      cancelHold();
      window.clearInterval(timer); window.clearTimeout(connectionTimeout);
      clearTimeout(captureTimer);
      socket.close();
    };
  }, [enabled, request, calibration, activeProfile, capturing]);

  return { position: enabled && request && !capturing && position?.calibration === calibration && position.profile === activeProfile ? position.value : null,
    ranges: enabled && request ? ranges : null, calibrated: !!calibration,
    corrections: activeProfile?.corrections ?? null, capturing, correctionError,
    calibrate: () => { if (calibration && request) { setCorrectionError(""); setCapture({ calibration, request }); } },
    clearCorrection: () => { setProfile(null); setCapture(null); setCorrectionError(""); },
    status, connect, disconnect, connected: !!request };
}
