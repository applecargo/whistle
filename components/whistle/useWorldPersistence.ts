"use client";
import { userErrorMessage } from "./Language";
import { useCallback, useEffect, useRef, useState } from "react";
import { abstractWorld, validateWorld, type World } from "@/lib/world";
import { upgradeTerrain } from "@/lib/terrain";
import { createTerrainWorld } from "@/lib/create-world";

const STORAGE = "whistle.world.v2";

type Options = {
  world: World;
  onLoad: (world: World, beforeUpgrade: World) => void;
  onImport: (world: World) => void;
  notify: (message: string) => void;
};

export function useWorldPersistence({ world, onLoad, onImport, notify }: Options) {
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("준비 중");
  const autosaveAllowed = useRef(false);
  const resumeAutosave = useCallback(() => {
    if (new URLSearchParams(location.hash.slice(1)).has("world")) {
      window.history.replaceState(null, "", location.pathname + location.search);
    }
    autosaveAllowed.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      autosaveAllowed.current = false;
      setReady(false);
      try {
        let incoming: World | undefined;
        const stored = localStorage.getItem(STORAGE);
        if (stored !== null) incoming = validateWorld(JSON.parse(stored));
        else {
          const previous = localStorage.getItem("whistle.world.v1");
          if (previous !== null) incoming = abstractWorld(validateWorld(JSON.parse(previous)));
        }
        if (!incoming) incoming = createTerrainWorld();
        const beforeUpgrade = incoming;
        incoming = upgradeTerrain(incoming);
        if (!active) return;
        onLoad(incoming, beforeUpgrade);
        resumeAutosave();
      } catch {
        if (active) {
          setSaveStatus("불러오기에 실패해 자동 저장이 중지되었습니다.");
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [onLoad, resumeAutosave]);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("저장 중");
    const timeout = setTimeout(() => {
      if (!autosaveAllowed.current) return;
      try {
        localStorage.setItem(STORAGE, JSON.stringify(world));
        setSaveStatus("이 브라우저에 저장됨");
      } catch {
        setSaveStatus("저장 공간이 부족합니다.");
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [world, ready]);

  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const imported = upgradeTerrain(validateWorld(JSON.parse(await file.text())));
      onImport(imported);
      resumeAutosave();
    } catch (e) {
      notify(userErrorMessage(e, "파일을 읽을 수 없습니다."));
    }
  }, [notify, onImport, resumeAutosave]);

  return { ready, saveStatus, resumeAutosave, importFile };
}
