// 3D 렌더링 품질. 기본값은 원래 설정 그대로이고, 주소에 `?quality=low`를 붙이면 가벼운 설정을 쓴다.
//
// 화면은 최종적으로 세로 약 540줄의 픽셀 그래픽으로 보이지만(PixelGraphics),
// 그 전 단계는 화면 해상도 × 기기 배율(최대 2배)로, MSAA 4배를 켠 채 장면을 두 번(색 + 마스크) 그린다.
// low는 이 중간 단계를 가볍게 한다: 기기 배율 1, MSAA 끔, 그림자 가장자리 부드럽게 하기 끔.
export type RenderQuality = {
  name: "default" | "low";
  /** renderer.setPixelRatio에 넣는 값 */
  pixelRatio: number;
  /** 중간 렌더 타깃의 MSAA 샘플 수 */
  samples: number;
  /** PCFSoftShadowMap(부드러운 그림자) 사용 여부. 아니면 PCFShadowMap */
  softShadows: boolean;
};

export function renderQuality(): RenderQuality {
  const query = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("quality");
  const deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  if (query === "low") return { name: "low", pixelRatio: 1, samples: 0, softShadows: false };
  return { name: "default", pixelRatio: Math.min(deviceRatio, 2), samples: 4, softShadows: true };
}
