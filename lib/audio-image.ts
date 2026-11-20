/**
 * 오디오 에셋용 3D/2D 썸네일 이미지 생성기
 * - 512x512 캔버스에 세련된 사운드 카드 및 웨이브폼 그래픽 렌더링
 * - 3D 씬(Scene.tsx)의 Billboard Plane 및 2D 팔레트에 텍스처로 자동 매핑
 */
export function audioImage(title: string, filter?: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // 1. 배경 카드 (모던 다크 그라디언트)
  const bgGrad = ctx.createLinearGradient(0, 0, 512, 512);
  bgGrad.addColorStop(0, "#1e1e24");
  bgGrad.addColorStop(1, "#121216");
  ctx.fillStyle = bgGrad;

  // 둥근 모서리 사각형
  ctx.beginPath();
  ctx.roundRect(32, 32, 448, 448, 40);
  ctx.fill();

  // 은은한 테두리
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.stroke();

  // 2. 중앙 오디오 웨이브폼 바 그래픽
  const bars = [
    36, 58, 92, 140, 190, 160, 210, 240, 180, 230,
    195, 150, 185, 220, 170, 130, 95, 64, 42, 28,
  ];
  const barWidth = 12;
  const barGap = 6;
  const totalWidth = bars.length * barWidth + (bars.length - 1) * barGap;
  const startX = (512 - totalWidth) / 2;
  const centerY = 240;

  for (let i = 0; i < bars.length; i++) {
    const height = bars[i];
    const x = startX + i * (barWidth + barGap);
    const y = centerY - height / 2;

    const barGrad = ctx.createLinearGradient(0, y, 0, y + height);
    barGrad.addColorStop(0, "#60a5fa"); // 밝은 블루
    barGrad.addColorStop(1, "#a855f7"); // 퍼플

    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, height, 6);
    ctx.fill();
  }

  // 3. 스피커 / 음표 심볼 아이콘
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(256, 100, 20, 0, Math.PI * 2);
  ctx.fill();

  // 4. 필터 태그 (Bypass가 아닌 경우)
  if (filter && filter !== "bypass") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.roundRect(196, 360, 120, 32, 16);
    ctx.fill();

    ctx.fillStyle = "#93c5fd";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const filterLabel =
      filter === "underwater" ? "수중 필터" :
      filter === "radio" ? "라디오" :
      filter === "reverb" ? "공간 울림" : filter;
    ctx.fillText(filterLabel, 256, 376);
  }

  // 5. 하단 텍스트 (사운드 이름)
  const cleanTitle = (title.trim() || "오디오").replace(/\.[^.]+$/, "");
  ctx.fillStyle = "#f3f4f6";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let displayText = cleanTitle;
  if (ctx.measureText(displayText).width > 400) {
    while (ctx.measureText(displayText + "…").width > 390 && displayText.length > 0) {
      displayText = displayText.slice(0, -1);
    }
    displayText += "…";
  }

  ctx.fillText(displayText, 256, 420);

  return canvas.toDataURL("image/png");
}
