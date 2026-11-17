"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { lazy, Suspense, type ComponentProps } from "react";
import { useLanguage, SceneLoading } from "@/components/whistle/Language";

import {
  starterWorld,
  createSimulation,
  stepSimulation,
  uid,
  type World,
  type Asset,
  type Player,
  type Event,
  type Simulation,
} from "@/lib/world";
import { isHole, type TerrainTool } from "@/lib/tile";
import { downloadWorld } from "@/lib/sharing";
import { createTerrainWorld } from "@/lib/create-world";
import { useWorldDocument } from "@/components/whistle/useWorldDocument";
import { useGameAudio } from "@/components/whistle/useGameAudio";
import { editSound } from "@/lib/audio/game-parameters";
import { useWorldPersistence } from "@/components/whistle/useWorldPersistence";
import { useLiveWorldPublisher } from "@/components/whistle/useLiveWorldPublisher";
import { EditorToolbar } from "@/components/whistle/EditorToolbar";
import { EditorPalette } from "@/components/whistle/EditorPalette";
import { EditorBoard } from "@/components/whistle/EditorBoard";
import { PlayControls } from "@/components/whistle/PlayControls";
import {
  tileAt,
  type Surface,
} from "@/lib/terrain";
import {
  Dialog,
  AssetMaker,
  ShareDialog,
} from "@/components/whistle/Dialogs";
const LazyScene = lazy(() => import("@/components/whistle/Scene"));
function Scene(props: ComponentProps<typeof LazyScene>) {
  return <Suspense fallback={<SceneLoading />}><LazyScene {...props} /></Suspense>;
}
export default function Home() {
  const { t } = useLanguage();
  const initialWorld = useMemo(starterWorld, []);
  const [selected, setSelected] = useState<string | null>(null),
    [placingAsset, setPlacingAsset] = useState<string | null>(null),
    [contentType, setContentType] = useState<"image" | "text">("image"),
    [placingStart, setPlacingStart] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>(() =>
      createSimulation(initialWorld),
    ),
    [playing, setPlaying] = useState(false),
    [log, setLog] = useState<Event[]>([]),
    [toast, setToast] = useState(""),
    [showMaker, setShowMaker] = useState(false),
    [editingAsset, setEditingAsset] = useState<Asset | undefined>(),
    [share, setShare] = useState(false),
    [newDialog, setNewDialog] = useState(false),
    [playKey, setPlayKey] = useState(0);
  const makeButton = useRef<HTMLButtonElement>(null);
  const hasPlayed = useRef(false);
  useLayoutEffect(() => {
    if (!playing && !hasPlayed.current) return;
    hasPlayed.current = true;
    const overflow = document.body.style.overflow;
    if (playing) document.body.style.overflow = "hidden";
    window.scrollTo({top: 0, left: 0, behavior: "instant"});
    if (!playing) makeButton.current?.focus({preventScroll: true});
    const frame = requestAnimationFrame(() => window.scrollTo({top: 0, left: 0, behavior: "instant"}));
    return () => {
      cancelAnimationFrame(frame);
      if (playing) document.body.style.overflow = overflow;
    };
  }, [playing]);
  const [movementMode, setMovementMode] = useState<"walk" | "crouch">("walk");
  const [surface, setSurface] = useState<Surface>("soft"),
    [terrainTool, setTerrainTool] = useState<TerrainTool>("surface");
  const simulationRef = useRef(simulation),
    player = useRef<Player>({ ...initialWorld.start, yaw: 0 }),
    controls = useRef(new Set<string>()),
    padPressedAt = useRef(new Map<string, number>()),
    file = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  simulationRef.current = simulation;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const audio = useGameAudio(notify);
  const resetSimulation = useCallback((w: World) => {
    audio.reset();
    const next = createSimulation(w);
    simulationRef.current = next;
    setSimulation(next);
    setLog([]);
    player.current = { ...w.start, yaw: 0 };
  }, [audio]);
  const {
    world, getWorld, deriveWorld, feedback, canUndo, canRedo,
    commit: updateWorld, edit: change, load: loadDocument,
    undo: undoDocument, redo: redoDocument, paint: paintDocument, endStroke,
  } = useWorldDocument(initialWorld, resetSimulation);
  const derivation = useMemo(
    () => deriveWorld(world, simulation.actors),
    [deriveWorld, world, simulation.actors],
  );
  const symbols = world.assets.filter(asset => asset.image || asset.text?.trim());
  const activeAsset = symbols.find(asset => asset.id === placingAsset)?.id ?? null;
  const createSymbol = (type: "image" | "text") => {
    setPlacingStart(false); setSelected(null); setEditingAsset(undefined);
    setContentType(type); setShowMaker(true);
  };
  const editSymbol = (asset: Asset, objectId: string | null = null) => {
    setPlacingStart(false); setSelected(objectId);
    const shared = objectId && world.objects.some(object => object.id !== objectId && object.asset === asset.id);
    setEditingAsset({ ...asset, id: shared ? uid() : asset.id });
    setContentType(asset.text !== undefined ? "text" : "image");
    setShowMaker(true);
  };
  const openSymbolAt = (i: number) => {
    const object = world.objects.find(object => object.x === i % world.size && object.z === Math.floor(i / world.size));
    const asset = world.assets.find(asset => asset.id === object?.asset);
    if (object && asset && (asset.image || asset.text?.trim())) editSymbol(asset, object.id);
  };
  const handleLoad = useCallback((incoming: World, beforeUpgrade: World) => {
    audio.stop();
    loadDocument(incoming, beforeUpgrade);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
    setPlaying(false);
  }, [audio, loadDocument]);
  const handleImport = useCallback((imported: World) => {
    updateWorld(imported);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
  }, [updateWorld]);
  const { ready, saveStatus, resumeAutosave, importFile: loadFile } = useWorldPersistence({
    world, onLoad: handleLoad, onImport: handleImport, notify,
  });
  useLiveWorldPublisher(world, ready);
  const reset = useCallback((w: World = getWorld()) => {
    resetSimulation(w);
  }, [getWorld, resetSimulation]);
  const undo = () => {
    if (undoDocument()) setSelected(null);
  };
  const redo = () => {
    if (redoDocument()) setSelected(null);
  };
  const step = useCallback(() => {
    if (player.current.falling) return;
    const next = stepSimulation(
      getWorld(),
      simulationRef.current,
      player.current,
    );
    simulationRef.current = next;
    setSimulation(next);
    if (next.events.length) {
      setLog((prev) => [...next.events, ...prev].slice(0, 12));
      next.events.filter((e) => e.action === "sound").forEach((event) => audio.event(event, player.current));
    }
  }, [audio, getWorld]);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(step, 700);
    return () => clearInterval(interval);
  }, [playing, step]);
  const enter = () => {
    reset();
    audio.play();
    setPlaying(true);
    setPlayKey((k) => k + 1);
    controls.current.clear();
    setMovementMode("walk");
  };
  const exit = () => {
    audio.stop();
    setPlaying(false);
    controls.current.clear();
    setMovementMode("walk");
    reset();
  };
  useEffect(() => {
    if (!playing) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [playing]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const clickedCell = (x: number, z: number) => {
    const existing = world.objects.find((o) => o.x === x && o.z === z);
    if (placingStart) {
      if (!tileAt(world, x, z) || isHole(tileAt(world, x, z))) {
        notify("시작점에는 바닥이 필요해요.");
        return;
      }
      if (
        existing &&
        world.assets.find((a) => a.id === existing.asset)?.solid
      ) {
        notify("시작점이 막혀 있습니다.");
        return;
      }
      change((w) => {
        w.start = { x, z };
      });
      setPlacingStart(false);
      return;
    }
  };
  const paint = (cells: number[], erase: boolean) => {
    if (placingStart) {
      const i = cells[cells.length - 1];
      clickedCell(i % world.size, Math.floor(i / world.size));
      return;
    }
    const before = getWorld();
    paintDocument(cells, erase, { layer: activeAsset ? "symbols" : "tiles", assetId: activeAsset ?? undefined, surface, terrainTool });
    const after = getWorld();
    if (before !== after) {
      const sound = editSound(before, after, cells, deriveWorld(after));
      if (sound) audio.edit(sound);
    }
  };
  const saveAsset = (asset: Asset) => {
    if (!asset.image || (contentType === "text" && !asset.text?.trim())) return;
    change(w => {
      const index = w.assets.findIndex(a => a.id === asset.id);
      if (index >= 0) w.assets[index] = asset;
      else w.assets.push(asset);
      const object = w.objects.find(o => o.id === selected);
      if (object) { object.asset = asset.id; object.scale = asset.defaultScale ?? 1; }
      else if (editingAsset) {
        for (const placed of w.objects) if (placed.asset === asset.id) placed.scale = asset.defaultScale ?? 1;
      }
    });
    setShowMaker(false); setEditingAsset(undefined); setSelected(null); setPlacingAsset(asset.id);
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      await loadFile(f);
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const newWorld = () => {
    const next = createTerrainWorld();
    updateWorld(next);
    resumeAutosave();
    setSelected(null); setPlacingAsset(null); setPlacingStart(false);
    setNewDialog(false);
  };
  return (
    <main className={`studio ${playing ? "playing" : ""}`}>
      <EditorToolbar
        playing={playing}
        saveStatus={saveStatus}
        makeButton={makeButton}
        onEnter={enter}
        onExit={exit}
        onNew={() => setNewDialog(true)}
        onImport={() => file.current?.click()}
        onShare={() => setShare(true)}
      />
      {playing && (
        <section className="play-shell">
          <Scene
            key={playKey}
            world={world}
            simulation={simulation}
            derivation={derivation}
            mode="play"
            onPlayer={(p) => (player.current = p)}
            onAudioFrame={audio.movement}
            controls={controls}
            onControlsReset={() => setMovementMode("walk")}
          />
          <button className="play-return" aria-label={t("만들기로 돌아가기")} onClick={exit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
          </button>
          <div className="crosshair" />
          <PlayControls
            controls={controls}
            padPressedAt={padPressedAt}
            player={player}
            movementMode={movementMode}
            onMovementModeChange={setMovementMode}
          />
          <span className="sr-only" aria-live="polite">
            {log[0]?.message}
          </span>
        </section>
      )}
        <div className="workspace" hidden={playing}>
          <EditorPalette
            weather={world.weather} timeOfDay={world.timeOfDay} surface={surface} terrainTool={terrainTool} placingStart={placingStart}
            symbols={symbols} selectedSymbol={activeAsset ?? undefined}
            onSelectSurface={next => { setPlacingStart(false); setPlacingAsset(null); setSurface(next); setTerrainTool("surface"); }}
            onSelectTerrainTool={next => { setPlacingStart(false); setPlacingAsset(null); setTerrainTool(next); }}
            onTimeOfDayChange={timeOfDay => change(w => { w.timeOfDay = timeOfDay; })}
            onWeatherChange={weather => change(w => { w.weather = weather; })}
            onCreateSymbol={createSymbol}
            onSelectSymbol={id => { setPlacingStart(false); setPlacingAsset(activeAsset === id ? null : id); }}
            onEditSymbol={id => { const asset = world.assets.find(asset => asset.id === id); if (asset) editSymbol(asset); }}
            onToggleStart={() => { setPlacingAsset(null); setPlacingStart(!placingStart); }}
          />
          <EditorBoard
            world={world}
            actors={simulation.actors}
            derivation={derivation}
            feedback={feedback}
            placingAsset={activeAsset}
            onOpenSymbol={openSymbolAt}
            placingStart={placingStart}
            canHold={!placingStart}
            canUndo={canUndo}
            canRedo={canRedo}
            onPaint={paint}
            onEnd={endStroke}
            onUndo={undo}
            onRedo={redo}
          />
          <aside className="preview-panel" aria-label={t("배치 결과")}>
            <div className="live-preview">
              {!playing && <Scene
                world={world}
                simulation={simulation}
                derivation={derivation}
                mode="overview"
                feedback={feedback}
              />}
              <button onClick={enter} aria-label={t("세계에 들어가기")}>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </aside>
        </div>
      <input
        ref={file}
        type="file"
        accept=".json,.whistle.json,application/json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {showMaker && (
        <AssetMaker
          asset={editingAsset}
          contentType={contentType}
          onSave={saveAsset}
          onClose={() => {
            setShowMaker(false);
            setEditingAsset(undefined); setSelected(null);
          }}
        />
      )}
      {share && (
        <ShareDialog
          world={world}
          onClose={() => setShare(false)}
          onToast={notify}
        />
      )}
      {newDialog && (
        <Dialog title={t("다시 시작")} onClose={() => setNewDialog(false)}>
          <p>{t("지금 만든 세계를 지우고 새로 시작할까요?")}</p>
          <div className="new-actions">
            <button onClick={() => downloadWorld(world)}>
              {t("현재 파일 저장")}
            </button>
            <button className="primary" onClick={newWorld}>
              {t("다시 시작")}
            </button>
          </div>
        </Dialog>
      )}
      {saveStatus.includes("부족") && (
        <div className="save-error" role="alert">
          {t("저장 공간 부족")}{" "}
          <button onClick={() => downloadWorld(world)}>{t("파일 저장")}</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
    </main>
  );
}
