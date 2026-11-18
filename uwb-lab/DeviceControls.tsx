import { useState } from "react";
import type { useDevicePosition } from "./useDevicePosition";

export default function DeviceControls({ device }: { device: ReturnType<typeof useDevicePosition> }) {
  const [url, setUrl] = useState("ws://127.0.0.1:5194");
  const [tagId, setTagId] = useState("0");
  return <fieldset><legend>PC 수신기 연결</legend>
    <label>수신기 주소<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
    <label>관객 태그 ID<input value={tagId} maxLength={32} onChange={(event) => setTagId(event.target.value)} /></label>
    <button onClick={() => device.connect(url, tagId)} disabled={!url || !/^[a-zA-Z0-9_-]{1,32}$/.test(tagId)}>연결 / 다시 연결</button>
    <button onClick={device.disconnect} disabled={!device.connected}>연결 종료</button>
    <p id="device-status" role="status">{device.status}</p>
    {device.ranges ? <div id="range-data">
      <table>
        <caption>태그 → 앵커 실측 거리</caption>
        <thead><tr><th>앵커 ID</th><th>원본 거리 (m)</th>{device.corrections ? <th>보정 거리 (m)</th> : null}</tr></thead>
        <tbody>{[...new Set(["0", "1", "2", "3", ...device.ranges.ranges.map((r) => r.anchorId)])].map((id) => {
          const range = device.ranges!.ranges.find((r) => r.anchorId === id);
          const correction = device.corrections?.find((r) => r.anchorId === id);
          const corrected = range && correction ? range.distance - correction.offset : null;
          return <tr key={id}><th scope="row">{id}</th><td>{range ? range.distance.toFixed(2) : "미수신"}</td>
            {device.corrections ? <td>{corrected !== null && corrected > 0 ? corrected.toFixed(2) : "유효 거리 없음"}</td> : null}</tr>;
        })}</tbody>
      </table>
      <p>최근 수신: {new Date(device.ranges.receivedAt).toLocaleTimeString("ko-KR")} · 수신 번호 {device.ranges.seq}</p>
      <p>{device.calibrated ? "입력한 앵커 배치로 위치 계산 중 · 오디오 시작 버튼으로 소리를 켜세요." : "거리 확인 모드 · 아래에서 실제 앵커 배치를 적용하면 위치와 오디오를 연결할 수 있습니다."}</p>
    </div> : null}
    {device.calibrated ? <div>
      <button disabled={!device.ranges || device.capturing} onClick={device.calibrate}>중앙 거리 보정 · 5초</button>
      <button disabled={!device.corrections && !device.capturing} onClick={device.clearCorrection}>거리 보정 해제</button>
      <p id="correction-status" role="status">{device.correctionError || (device.capturing ? "5초간 측정 중 · 태그를 정중앙, 입력한 태그 높이에 고정하세요."
        : device.corrections ? "중앙 기준 임시 보정 적용됨 · 다른 위치에서 정확도를 확인하세요." : "거리 보정 없음")}</p>
      {device.corrections ? <p id="correction-offsets">원본에서 빼는 값: {device.corrections.map((r) => `A${r.anchorId} ${r.offset.toFixed(3)}m`).join(" · ")}</p> : null}
      <p>태그를 사각형 정중앙에 고정한 뒤 보정하세요. 입력한 배치의 중앙 예상 거리를 기준으로 보정하며, 태그·배치가 달라지면 적용하지 않습니다. 새로고침 시 보정은 해제됩니다.</p>
    </div> : null}
    {device.position ? <dl>
      <dt>X / Z (m)</dt><dd>{device.position.x.toFixed(3)} / {device.position.z.toFixed(3)}</dd>
      <dt>보드 높이 (m)</dt><dd>{device.position.boardHeight.toFixed(3)} ({device.position.heightSource === "fixed" ? "고정값" : "UWB 계산"})</dd>
      <dt>거리 오차 RMS (m)</dt><dd>{device.position.residual.toFixed(3)} · 앵커 {device.position.anchors}개</dd>
    </dl> : null}
    <p>PC 프로그램의 실제 장비·가상 장비를 같은 경로로 받습니다. 태그를 바꾼 뒤 다시 연결하세요.</p>
  </fieldset>;
}
