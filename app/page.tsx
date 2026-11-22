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
import { isGap, type TerrainTool } from "@/lib/tile";
import { downloadWorld } from "@/lib/sharing";
import { createTerrainWorld } from "@/lib/create-world";
import { useWorldDocument } from "@/components/whistle/useWorldDocument";
import { SoundMaker } from "@/components/whistle/SoundMaker";
import { contentKind, contentLimitMessage, MAX_CONTENT_COUNT, MAX_LIBRARY_SIZE, validateContentCounts } from "@/lib/content-limits";
import { useGameAudio } from "@/components/whistle/useGameAudio";
import { editSound } from "@/lib/audio/game-parameters";
import { useWorldPersistence } from "@/components/whistle/useWorldPersistence";
import { browserWorldStore } from "@/lib/browser-world";
import { useLiveWorldPublisher } from "@/components/whistle/useLiveWorldPublisher";
import { EditorToolbar } from "@/components/whistle/EditorToolbar";
import { EditorPalette } from "@/components/whistle/EditorPalette";
import { EditorBoard } from "@/components/whistle/EditorBoard";
import { PlayControls } from "@/components/whistle/PlayControls";
import { usePortalRoom, type PortalVisit } from "@/components/whistle/usePortalRoom";
import { usePortalTransition } from "@/components/whistle/usePortalTransition";
import { HOME_PORTAL, placePortals, portalReturnPosition, type WorldPortal } from "@/lib/portals";
import type { MeetingSession } from "@/components/whistle/MeetingLab";
import { MeetingOverlay, meetingVisuals } from "@/components/whistle/MeetingTools";
import { createMeetingWorld, fixMeetingStart, offlineMeetingWorld, meetingOwner, connectionCandidates, meetingReturnPosition, authoredMaterialCount, MEETING_MATERIAL_LIMIT, MEETING_MATERIAL_MESSAGE } from "@/lib/meeting";
import { useMeetingWhistle } from "@/components/whistle/useMeetingWhistle";
import { portalWorld } from "@/lib/portal-protocol";
import {
  tileAt,
  floorHeight,
  type Surface,
} from "@/lib/terrain";
import {
  Dialog,
  AssetMaker,
} from "@/components/whistle/Dialogs";
const LazyScene = lazy(() => import("@/components/whistle/Scene"));
function Scene(props: ComponentProps<typeof LazyScene>) {
  return <Suspense fallback={<SceneLoading />}><LazyScene {...props} /></Suspense>;
}
export default function Home({meeting}:{meeting?:MeetingSession} = {}) {
  const { t } = useLanguage();
  const initialWorld = useMemo(() => meeting?.view.ownWorld ?? starterWorld(), []);
  const initialPlayer = useMemo(() => meeting?.presence.peers.find(p=>p.id===meeting.view.id)?.player ?? {...initialWorld.start,yaw:0}, []);
  const receivedMaterials = useRef(new Set(meeting?.view.received ?? []));
  const browserStorage = useMemo(() => meeting ? browserWorldStore(meeting.key,meeting.view.id) : undefined,[meeting?.key,meeting?.view.id]);
  const [selected, setSelected] = useState<string | null>(null),
    [placingAsset, setPlacingAsset] = useState<string | null>(null),
    [contentType, setContentType] = useState<"image" | "text" | "sound">("image"),
    [placingStart, setPlacingStart] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>(() =>
      createSimulation(initialWorld),
    ),
    [playing, setPlaying] = useState(false),
    [log, setLog] = useState<Event[]>([]),
    [toast, setToast] = useState(""),
    [showMaker, setShowMaker] = useState(false),
    [editingAsset, setEditingAsset] = useState<Asset | undefined>(),
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
  const [visit, setVisit] = useState<PortalVisit | null>(null);
  const [portalLoading, setPortalLoading] = useState("");
  const portalTransition = usePortalTransition();
  const [spawn, setSpawn] = useState<Player>(initialPlayer);
  const home = useRef<{ player: Player; simulation: Simulation; portal?: WorldPortal } | null>(null);
  const travel = useRef(0), travelBusy = useRef(false);
  useEffect(() => () => { travel.current++; }, []);
  const [surface, setSurface] = useState<Surface>("soft"),
    [terrainTool, setTerrainTool] = useState<TerrainTool>("surface");
  const simulationRef = useRef(simulation),
    player = useRef<Player>(initialPlayer),
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
  const audio = useGameAudio();
  const whistle = useMeetingWhistle(meeting, playing, player, notify);
  const meetingReset = useRef(meeting?.view.reset.id);
  useLayoutEffect(() => {
    if(!meeting)return;
    const reset=meeting.view.reset;
    if(reset.id!==meetingReset.current){
      meetingReset.current=reset.id;player.current={...reset.player};setSpawn({...reset.player});
      controls.current.clear();setMovementMode("walk");setPlayKey(k=>k+1);
    }else if(meeting.status!=="online"){
      const owner=meetingOwner(Math.round(player.current.x),Math.round(player.current.z));
      const gate=connectionCandidates(0,owner)[0];
      if(gate){const next=meetingReturnPosition(gate,player.current.yaw,"disconnect");player.current=next;setSpawn(next);controls.current.clear();setPlayKey(k=>k+1);}
    }
  },[meeting?.view.reset,meeting?.status]);
  const resetSimulation = useCallback((w: World) => {
    audio.reset();
    const next = createSimulation(w);
    simulationRef.current = next;
    setSimulation(next);
    setLog([]);
    if (!meeting) player.current = { ...w.start, yaw: 0 };
  }, [audio, !!meeting]);
  const {
    world, getWorld, deriveWorld, feedback, canUndo, canRedo,
    commit: updateWorld, edit: change, load: loadDocument,
    undo: undoDocument, redo: redoDocument, paint: paintDocument, endStroke, receiveAssets,
  } = useWorldDocument(initialWorld, resetSimulation);
  const sharedIds = useMemo(() => new Set([
    ...(meeting?.view.materials.map(a => a.id) ?? []),...world.assets.filter(a=>a.received).map(a=>a.id),
  ]), [meeting?.view.materials,world.assets]);
  const ownActors = visit && home.current ? home.current.simulation.actors : simulation.actors;
  const derivation = useMemo(
    () => deriveWorld(world, ownActors),
    [deriveWorld, world, ownActors],
  );
  const meetingWorld = useMemo(()=>meeting ? meeting.status==="online"?meeting.view.world:offlineMeetingWorld(meeting.view):undefined,[meeting?.view.world,meeting?.status]);
  const activeWorld = meetingWorld ?? visit?.world ?? world;
  const activeSimulation = useMemo(() => meeting ? createSimulation(activeWorld) : simulation, [!!meeting, activeWorld, simulation]);
  const activeWorldRef = useRef(activeWorld);
  activeWorldRef.current = activeWorld;
  const activeDerivation = useMemo(() => visit || meeting ? deriveWorld(activeWorld, activeSimulation.actors) : derivation,
    [visit, !!meeting, deriveWorld, activeWorld, activeSimulation.actors, derivation]);
  const symbols = world.assets.filter(asset => asset.image || asset.text?.trim() || asset.sound);
  const nextSoundName = String(Math.max(0, ...world.assets.filter(a => a.sound && /^[1-9]\d{0,5}$/.test(a.name)).map(a => Number(a.name))) + 1);
  const activeAsset = symbols.find(asset => asset.id === placingAsset)?.id ?? null;
  const createSymbol = (type: "image" | "text" | "sound") => {
    if (world.assets.length >= MAX_LIBRARY_SIZE) { notify("재료 목록이 가득 찼습니다. 사용하지 않는 재료를 삭제해 주세요."); return; }
    if (meeting && authoredMaterialCount(world, sharedIds) >= MEETING_MATERIAL_LIMIT) {
      notify(MEETING_MATERIAL_MESSAGE); return;
    }
    if (!meeting && world.assets.filter(asset => contentKind(asset) === type).length >= MAX_CONTENT_COUNT) {
      notify(contentLimitMessage[type]); return;
    }
    setPlacingStart(false); setSelected(null); setEditingAsset(undefined);
    setContentType(type); setShowMaker(true);
  };
  const editSymbol = (asset: Asset, objectId: string | null = null) => {
    setPlacingStart(false); setSelected(objectId);
    const shared = !meeting && objectId && world.objects.some(object => object.id !== objectId && object.asset === asset.id);
    setEditingAsset({ ...asset, id: shared ? uid() : asset.id, ...(shared && asset.sound ? { name: "" } : {}) });
    setContentType(asset.sound ? "sound" : asset.text !== undefined ? "text" : "image");
    setShowMaker(true);
  };
  const openSymbolAt = (i: number, objectId?: string) => {
    const object = world.objects.filter(object => object.x === i % world.size && object.z === Math.floor(i / world.size) && (!objectId || object.id === objectId)).at(-1);
    const asset = world.assets.find(asset => asset.id === object?.asset);
    if (object && asset && (asset.image || asset.text?.trim() || asset.sound)) editSymbol(asset, object.id);
  };
  const handleLoad = useCallback((incoming: World, beforeUpgrade: World) => {
    audio.stop();
    loadDocument(incoming, beforeUpgrade);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
    setPlaying(false);
  }, [audio, loadDocument]);
  const handleImport = useCallback((imported: World) => {
    if(meeting && imported.size!==12){notify("연결 테스트에서는 12×12 맵을 사용합니다.");return;}
    if (meeting && authoredMaterialCount(imported, sharedIds) > MEETING_MATERIAL_LIMIT) { notify(MEETING_MATERIAL_MESSAGE); return; }
    updateWorld(meeting ? fixMeetingStart(imported) : imported);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
  }, [updateWorld, !!meeting, notify, sharedIds]);
  const { ready, loading, saveStatus, resumeAutosave, importFile: loadFile } = useWorldPersistence({
    world, onLoad: handleLoad, onImport: handleImport, notify, libraryLimit: meeting ? MAX_LIBRARY_SIZE : MAX_CONTENT_COUNT,
    storage:browserStorage,fallbackWorld:meeting?initialWorld:undefined,
  });
  useEffect(() => {
    if(!ready)return;
    const incoming = meeting?.view.materials.filter(a => !receivedMaterials.current.has(a.id)) ?? [];
    if (!incoming.length) return;
    for (const asset of receiveAssets(incoming)) receivedMaterials.current.add(asset.id);
  }, [meeting?.view.materials, receiveAssets, ready]);
  useLiveWorldPublisher(world, ready && !meeting);
  const room = usePortalRoom(world, ready && !meeting);
  useEffect(() => {
    if(!meeting || !ready || meeting.status!=="online")return;
    const send=()=>meeting.send({type:"publish",world:portalWorld(getWorld()),received:[...receivedMaterials.current]});
    const timer=setTimeout(send,100);
    window.addEventListener("pagehide",send);
    return()=>{clearTimeout(timer);window.removeEventListener("pagehide",send);};
  },[world,ready,meeting?.send,meeting?.status,getWorld]);
  const portals = useMemo(() => meeting ? [] : placePortals(world, room.peers, derivation), [world, room.peers, derivation, !!meeting]);
  const activePortals = useMemo(() => visit
    ? placePortals(activeWorld, [{ id: HOME_PORTAL, label: t("내 세계") }], activeDerivation)
    : portals, [visit, activeWorld, activeDerivation, portals, t]);
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
    if(meeting)return;
    if (player.current.falling || travelBusy.current) return;
    const next = stepSimulation(
      activeWorldRef.current,
      simulationRef.current,
      player.current,
    );
    simulationRef.current = next;
    setSimulation(next);
    if (next.events.length) {
      setLog((prev) => [...next.events, ...prev].slice(0, 12));
      next.events.filter((e) => e.action === "sound").forEach((event) => audio.event(event, player.current));
    }
  }, [audio, getWorld, !!meeting]);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(step, 700);
    return () => clearInterval(interval);
  }, [playing, step]);
  const enter = () => {
    if(meeting){
      if(meeting.status!=="online")return;
      const p=player.current;
      const next=floorHeight(activeWorld,p.x,p.z,activeDerivation.structures)!==null?{...p,falling:false}:{...activeWorld.start,yaw:0};
      setSpawn(next);player.current=next;audio.play();whistle.start();setPlaying(true);setPlayKey(k=>k+1);
      controls.current.clear();setMovementMode("walk");
      meeting.position({...next,grounded:true},true);return;
    }
    reset();
    setSpawn({ ...getWorld().start, yaw: 0 });
    audio.play();
    setPlaying(true);
    setPlayKey((k) => k + 1);
    controls.current.clear();
    setMovementMode("walk");
  };
  const finishTravel = async (ticket: number) => {
    if (ticket !== travel.current) return;
    await portalTransition.reveal();
    if (ticket !== travel.current) return;
    controls.current.clear();
    travelBusy.current = false;
    setPortalLoading("");
    audio.fade(1, .3);
  };
  const returnHome = async (stepBack = false) => {
    if (travelBusy.current) return;
    const saved = home.current;
    if (!saved) return;
    const ticket = ++travel.current;
    travelBusy.current = true; setPortalLoading(HOME_PORTAL);
    controls.current.clear();
    audio.fade(0, .2);
    try {
      await portalTransition.cover();
      if (ticket !== travel.current) return;
      const rendered = portalTransition.expectScene();
      audio.reset();
      simulationRef.current = saved.simulation;
      setSimulation(saved.simulation);
      player.current = stepBack
        ? portalReturnPosition({ ...world, objects: saved.simulation.actors.filter(actor => !actor.removed) }, saved.player, saved.portal, derivation, portals)
        : { ...saved.player, falling: false };
      setSpawn(player.current);
      setVisit(null);
      home.current = null;
      setMovementMode("walk"); setLog([]);
      setPlayKey(key => key + 1);
      audio.play();
      await rendered;
    } catch (error) {
      if (ticket === travel.current) notify((error as Error).message);
    } finally { await finishTravel(ticket); }
  };
  const visitPeer = async (id: string, at?: Player) => {
    if (id === HOME_PORTAL) { await returnHome(); return; }
    if (travelBusy.current || visit) return;
    travelBusy.current = true;
    const ticket = ++travel.current;
    setPortalLoading(id);
    controls.current.clear();
    audio.fade(0, .2);
    const saved = { simulation: simulationRef.current, player: { ...(at ?? (playing ? player.current : { ...getWorld().start, yaw: 0 })) }, portal: portals.find(portal => portal.id === id) };
    try {
      const [destination] = await Promise.all([room.visit(id), portalTransition.cover()]);
      if (ticket !== travel.current) return;
      const rendered = portalTransition.expectScene();
      home.current = saved;
      resetSimulation(destination.world);
      setVisit(destination);
      setSpawn({ ...destination.world.start, yaw: 0 });
      setPlaying(true); setLog([]);
      controls.current.clear(); setMovementMode("walk");
      setPlayKey(key => key + 1);
      audio.play();
      await rendered;
    } catch (error) {
      if (ticket === travel.current) notify((error as Error).message);
    } finally {
      await finishTravel(ticket);
    }
  };
  const exit = () => {
    if(meeting){
      meeting.position({...player.current,grounded:!!player.current.grounded},false);
      audio.stop();setPlaying(false);controls.current.clear();setMovementMode("walk");return;
    }
    if (travelBusy.current) return;
    if (visit) { void returnHome(true); return; }
    travel.current++; travelBusy.current = false; setPortalLoading("");
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
  }, [playing, visit]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const clickedCell = (x: number, z: number) => {
    const existing = world.objects.find((o) => o.x === x && o.z === z);
    if (placingStart) {
      if(meeting)return;
      if (!tileAt(world, x, z) || isGap(tileAt(world, x, z))) {
        notify("시작점에는 바닥이 필요합니다.");
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
    const kind = contentKind(before.assets.find(a => a.id === activeAsset));
    if (!erase && kind) {
      const count = before.objects.filter(o => contentKind(before.assets.find(a => a.id === o.asset)) === kind).length;
      const added = cells.filter(i => !before.objects.some(o => o.asset === activeAsset && o.x === i % before.size && o.z === Math.floor(i / before.size))).length;
      if (count + added > MAX_CONTENT_COUNT) notify(contentLimitMessage[kind]);
    }
    paintDocument(cells, erase, { layer: activeAsset ? "symbols" : "tiles", assetId: activeAsset ?? undefined, surface, terrainTool });
    const after = getWorld();
    if (before !== after) {
      const sound = editSound(before, after, cells, deriveWorld(after));
      if (sound) audio.edit(sound);
    }
  };
  const saveAsset = (asset: Asset) => {
    if (!world.assets.some(a=>a.id===asset.id) && world.assets.length >= MAX_LIBRARY_SIZE) { notify("재료 목록이 가득 찼습니다. 사용하지 않는 재료를 삭제해 주세요."); return; }
    if (meeting && !world.assets.some(a => a.id === asset.id) && authoredMaterialCount(world, sharedIds) >= MEETING_MATERIAL_LIMIT) {
      notify(MEETING_MATERIAL_MESSAGE); return;
    }
    if ((!asset.image && !asset.sound) || (contentType === "text" && !asset.text?.trim())) return;
    if (asset.sound) {
      asset = { ...asset, name: asset.name.trim().slice(0, 12) || nextSoundName };
    }
    change(w => {
      const index = w.assets.findIndex(a => a.id === asset.id);
      if (index >= 0) w.assets[index] = { ...asset, glyphColor: w.assets[index].glyphColor, ...(w.assets[index].received?{received:true}:{}) };
      else w.assets.push({ ...asset, glyphColor: undefined });
      const object = w.objects.find(o => o.id === selected);
      if (object) { object.asset = asset.id; object.scale = asset.defaultScale ?? 1; }
      else if (editingAsset) {
        for (const placed of w.objects) if (placed.asset === asset.id) placed.scale = asset.defaultScale ?? 1;
      }
      validateContentCounts(w, meeting ? MAX_LIBRARY_SIZE : MAX_CONTENT_COUNT);
    });
    setShowMaker(false); setEditingAsset(undefined); setSelected(null); setPlacingAsset(asset.id);
  };
  const saveFile = () => {
    try { downloadWorld(world); }
    catch { notify("저장할 수 없습니다."); }
  };
  const deleteSymbol = () => {
    if (!editingAsset) return;
    change(w => {
      if (selected) w.objects = w.objects.filter(o => o.id !== selected);
      else {
        w.objects = w.objects.filter(o => o.asset !== editingAsset.id);
        w.assets = w.assets.filter(a => a.id !== editingAsset.id);
        w.rules = w.rules.filter(r => ![r.subject, r.source, r.replacement].includes(editingAsset.id));
      }
    });
    setShowMaker(false); setEditingAsset(undefined); setSelected(null); setPlacingAsset(null);
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
    const next = meeting ? createMeetingWorld() : createTerrainWorld();
    if (meeting) next.assets.push(...world.assets.filter(a => sharedIds.has(a.id)));
    updateWorld(next);
    resumeAutosave();
    setSelected(null); setPlacingAsset(null); setPlacingStart(false);
    setNewDialog(false);
  };
  if(meeting && loading)return <SceneLoading />;
  return (
    <main className={`studio ${playing ? "playing" : ""}`} data-visited-world={visit?.peer.id ?? ""} data-portal-status={room.status}
      data-meeting-id={meeting?.view.id} data-meeting-slot={meeting?.view.slot} data-meeting-status={meeting?.status} data-meeting-joined={meeting?.view.joined.length}>
      <EditorToolbar
        playing={playing}
        saveStatus={saveStatus}
        onlineCount={meeting ? meeting.status==="online" ? meeting.presence.onlineCount ?? meeting.presence.peers.filter(p=>p.online).length : null : room.count}
        connectionStatus={meeting?.status ?? room.status}
        makeButton={makeButton}
        onEnter={enter}
        onExit={exit}
        onNew={() => setNewDialog(true)}
        onImport={() => file.current?.click()}
        onSave={saveFile}
        onNewTab={meeting ? ()=>window.open(location.href,"_blank","noopener") : undefined}
      />
      {playing && (
        <section className="play-shell">
          <Scene
            key={playKey}
            world={activeWorld}
            simulation={activeSimulation}
            derivation={activeDerivation}
            mode="play"
            onPlayer={(p) => {player.current = p;meeting?.position({...p,grounded:!!p.grounded},true);}}
            onAudioFrame={frame => audio.movement(frame, activeWorld, activeSimulation.actors, activeDerivation.environment)}
            controls={controls}
            onControlsReset={() => setMovementMode("walk")}
            portals={activePortals}
            onPortal={(id, at) => void visitPeer(id, at)}
            initialPlayer={spawn}
            suspended={!!portalLoading || !!meeting && meeting.status!=="online"}
            meeting={meeting ? meetingVisuals(meeting) : undefined}
            onReady={portalTransition.ready}
          />
          <button className="play-return" data-visiting={!!visit} disabled={!!portalLoading} aria-label={t(visit ? "내 세계로 돌아가기" : "만들기로 돌아가기")} onClick={exit}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{visit ? <>
              <circle className="visit-dot" cx="4" cy="12" r="2.5" />
              <circle className="visit-dot" cx="12" cy="12" r="2.5" />
              <circle className="visit-dot" cx="20" cy="12" r="2.5" />
            </> : <><circle className="return-outline" cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="8" /></>}</svg>
          </button>
          {visit && <div className="portal-visit-status sr-only" role="status">
            <span>{visit.peer.label} · {visit.world.title || t("이름 없는 세계")}</span>
            <small>{t(room.peers.some(peer => peer.id === visit.peer.id) ? "방문 중" : "접속 종료 · 방문 중인 세계 유지")}</small>
          </div>}
          {meeting && <button className="meeting-whistle" aria-label="휘슬" disabled={!whistle.enabled}
            onKeyDown={event => { if (event.repeat) event.preventDefault(); }} onClick={whistle.blow}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M4 11h8l7-4v6l-7 2a4 4 0 1 1-8-4Z" /><circle cx="8" cy="15" r="1.5" />
              <path d="m18 3 1-2M22 6l2-1" />
            </svg>
          </button>}
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
            sharedSymbolIds={sharedIds}
            materialCount={meeting ? authoredMaterialCount(world, sharedIds) : undefined}
            materialLimit={meeting ? MEETING_MATERIAL_LIMIT : undefined}
            startLocked={!!meeting}
            extraTools={meeting && meeting.view.pendingMaterials > 0 ? <small role="status">보관 공간이 부족해 재료 {meeting.view.pendingMaterials}개가 대기 중입니다.</small> : undefined}
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
            actors={ownActors}
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
            portals={portals}
            overlay={meeting && <MeetingOverlay meeting={meeting} />}
          />
          <aside className="preview-panel" aria-label={t("배치 결과")}>
            <div className="live-preview">
              {!playing && <Scene
                world={world}
                simulation={simulation}
                derivation={derivation}
                mode="overview"
                feedback={feedback}
                portals={portals}
                meeting={meeting ? meetingVisuals(meeting,true) : undefined}
              />}
              <button onClick={enter} aria-label={t("들어가기")}>
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
      {showMaker && contentType === "sound" && <SoundMaker
        asset={editingAsset} defaultName={nextSoundName} onSave={saveAsset}
        placement={!!selected}
        onDelete={editingAsset ? deleteSymbol : undefined}
        onClose={() => { setShowMaker(false); setEditingAsset(undefined); setSelected(null); }}
      />}
      {showMaker && contentType !== "sound" && (
        <AssetMaker
          asset={editingAsset}
          contentType={contentType}
          onSave={saveAsset}
          placement={!!selected}
          onDelete={editingAsset ? deleteSymbol : undefined}
          onClose={() => {
            setShowMaker(false);
            setEditingAsset(undefined); setSelected(null);
          }}
        />
      )}
      {newDialog && (
        <Dialog title={t("다시 시작")} onClose={() => setNewDialog(false)}>
          <p>{t("현재 작업이 삭제됩니다.")}</p>
          <div className="new-actions">
            <button onClick={saveFile}>
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
          {t("저장 공간이 부족합니다.")}{" "}
          <button onClick={saveFile}>{t("파일 저장")}</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
      {room.error && <span className="sr-only" role="status">{t(room.error)}</span>}
      {meeting?.error && <div className="toast" role="status">{meeting.error}</div>}
      <div ref={portalTransition.veil} className="portal-transition" data-phase="idle" aria-hidden="true" />
    </main>
  );
}
