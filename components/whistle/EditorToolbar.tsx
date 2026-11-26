"use client";
import type { RefObject } from "react";
import { useLanguage } from "./Language";

type Props = {
  playing: boolean;
  saveStatus: string;
  onlineCount: number | null;
  multiplayerEnabled: boolean;
  onToggleMultiplayer: () => void;
  connectionStatus: "connecting" | "online" | "offline";
  makeButton: RefObject<HTMLButtonElement | null>;
  /** 만들기만(키오스크): 플레이 탭과 멀티플레이 버튼을 숨긴다 */
  editOnly?: boolean;
  displayBridge?: string;
  onEnter: () => void;
  onExit: () => void;
  onNew: () => void;
  onImport: () => void;
  onSave: () => void;
};

export function EditorToolbar({
  playing, saveStatus, onlineCount, multiplayerEnabled, onToggleMultiplayer, connectionStatus, makeButton, editOnly = false, displayBridge, onEnter, onExit, onNew, onImport, onSave,
}: Props) {
  const { language, setLanguage, t } = useLanguage();
  const presenceLabel = !multiplayerEnabled ? t("혼자 플레이") : onlineCount === null
    ? t(connectionStatus === "connecting" ? "연결 중" : "연결 끊김")
    : `${t("접속 인원 (나 포함)")}: ${onlineCount}`;
  return (
    <header className="topbar" hidden={playing}>
      <div className="brand-lockup">
        <h1>Whistle</h1>
        {!editOnly && <button type="button" className="presence-count" aria-label={t("멀티플레이")}
          aria-pressed={multiplayerEnabled} aria-description={presenceLabel} title={presenceLabel} onClick={onToggleMultiplayer}>
          <span className="presence-mark" aria-hidden="true" />
          {multiplayerEnabled && <span className="presence-number" aria-hidden="true">{onlineCount ?? "—"}</span>}
        </button>}
      </div>
      {!editOnly && <nav className="view-tabs" aria-label={t("화면")}>
        <button
          ref={makeButton}
          className={!playing ? "active" : ""}
          onClick={() => {
            if (playing) onExit();
          }}
        >
          {t("만들기")}
        </button>
        <button
          className={playing ? "active" : ""}
          aria-pressed={playing}
          onClick={() => {
            if (!playing) onEnter();
          }}
        >
          {t("플레이")}
        </button>
      </nav>}
      <div className="header-tools">
        <div className="language-switch" role="group" aria-label={t("언어")}>
          <button
            lang="ko"
            aria-label="한국어"
            aria-pressed={language === "ko"}
            onClick={() => setLanguage("ko")}
          >
            KO
          </button>
          <span aria-hidden="true">/</span>
          <button
            lang="en"
            aria-label="English"
            aria-pressed={language === "en"}
            onClick={() => setLanguage("en")}
          >
            EN
          </button>
        </div>
        <div className="file-actions">
          <a className="exhibition-link" href={`${import.meta.env.BASE_URL}?display=monitors${displayBridge ? `&bridge=${encodeURIComponent(displayBridge)}` : ""}`} target="_blank" rel="noopener">{language === "ko" ? "전시 화면" : "Exhibition"}</a>
          <button onClick={onNew}>{t("다시 시작")}</button>
          <button onClick={onImport}>
            {t("불러오기")}
          </button>
          <button
            onClick={onSave}
            aria-description={t(saveStatus)}
          >
            {t("파일 저장")}
          </button>
        </div>
      </div>
    </header>
  );
}
