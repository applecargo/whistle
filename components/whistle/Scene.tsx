"use client";
import { contentImage } from "../../lib/text-image.ts";
import { environmentPresentation } from "../../lib/environment-presentation";
import { makeContentPresentation } from "./ContentPresentation";
import { useLanguage } from "./Language";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Asset, World, Simulation, Player } from "@/lib/world";
import { softenEdges } from "./Atmosphere";
import { createTerrainCache } from "./TerrainGround";
import { makeTerrain } from "./TerrainScene";
import { makeSurfaceImage } from "./SurfaceImage";
import { makeWaterReflection } from "./WaterReflection";
import { applyPixelMaterials, makePixelRenderer } from "./PixelGraphics";
import { renderQuality } from "@/lib/render-quality";
import { horizonTone } from "./PixelPalette";
import { addSymbolVisuals, makeSymbolExperience } from "./SymbolExperience";
import { floorHeight, tileAt, terrainSample, ladderAt, LEVEL, SURFACES } from "@/lib/terrain";
import type { PlayerAudioFrame } from "@/lib/audio/game-parameters";
import type { WorldDerivation } from "@/lib/world-derivation";
import { environmentAt } from "@/lib/environment";
import { environmentalFlight, stepEnvironmentalFlight, type EnvironmentalFlight } from "@/lib/environment-motion";
import { makeWeather } from "./WeatherScene";
import { WEATHER } from "@/lib/weather";
import { createPortalScene } from "./PortalScene";
import { createMeetingScene, type MeetingVisuals } from "./MeetingScene";
import type { WorldPortal } from "@/lib/portals";
import { daylightAt } from "@/lib/daylight";
import {
  playerEyeHeight,
  launchJump,
  resolveJump,
  JUMP_BUFFER_SECONDS,
  COYOTE_SECONDS,
  blocksAirStep,
  jumpFrame,
  movementProfile,
  followHeading,
  movementKey,
  fallFrame,
  blocksWalkingStep,
  blocksVoidStep,
} from "@/lib/navigation";
import {
  feedbackRegions,
  type PlacementFeedback,
} from "@/lib/placement-feedback";
import { createObservationCamera } from "./ObservationCamera";
import type { RoomMapping } from "@/lib/uwb-position";
import { defaultRoom } from "@/lib/uwb-position";
import { cameraOffset, type DisplayMount, type VisitorPose } from "@/lib/display-proximity";
import { createSectorSurface } from "./SectorSurface";
import type { Sector, TrailSegment } from "@/lib/exhibition";

const EYE_HEIGHT = 1.35;
const START_PITCH = -.45;
type Props = {
  world: World;
  simulation: Pick<Simulation, "actors">;
  derivation: WorldDerivation;
  mode: "overview" | "play" | "sector" | "observation";
  mapping?: RoomMapping;
  sector?: Sector;
  visitor?: MutableRefObject<VisitorPose | null>;
  mount?: DisplayMount;
  trail?: MutableRefObject<TrailSegment[]>;
  onPlayer?: (p: Player) => void;
  onAudioFrame?: (frame: PlayerAudioFrame) => void;
  onControlsReset?: () => void;
  controls?: MutableRefObject<Set<string>>;
  stick?: MutableRefObject<{ x: number; y: number }>;
  className?: string;
  feedback?: PlacementFeedback | null;
  clock?: () => Date;
  trackedPosition?: { x: number; y: number; z: number } | null;
  portals?: WorldPortal[];
  onPortal?: (id: string, player: Player) => void;
  initialPlayer?: Player;
  suspended?: boolean;
  onReady?: (success: boolean) => void;
  meeting?: MeetingVisuals;
};
const NO_PORTALS: WorldPortal[] = [];
const deviceTime = () => new Date();
function material(color: string) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
  });
}
function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  parent: THREE.Group,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function makeObject(asset: Asset): THREE.Group {
  const g = new THREE.Group();

  if (!asset.image) return g;
  const texture = new THREE.TextureLoader().load(contentImage(asset)!);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = asset.text ? 16 : 1;
  const picture = mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    g,
    0,
    0.8,
  );
  picture.castShadow = false;
  addSymbolVisuals(g, picture as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, asset);
  return g;
}
function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.userData.dispose?.();
    if (m instanceof THREE.InstancedMesh) m.dispose();
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of materials) {
        const standard = mat as THREE.MeshStandardMaterial;
        standard.map?.dispose();
        standard.bumpMap?.dispose();
        mat.dispose();
      }
    }
  });
}
export default function Scene({
  world,
  simulation,
  derivation,
  mode, sector, trail, mount, visitor, mapping = defaultRoom,
  onPlayer,
  onAudioFrame,
  onControlsReset,
  controls,
  stick,
  className = "",
  feedback = null,
  clock = deviceTime,
  trackedPosition = null,
  portals = NO_PORTALS,
  onPortal,
  initialPlayer,
  suspended = false,
  onReady,
  meeting,
}: Props) {
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;
  const { t } = useLanguage();
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;
  const portalRef = useRef({ portals, onPortal, suspended });
  portalRef.current = { portals, onPortal, suspended };
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const spawnRef = useRef(initialPlayer);
  spawnRef.current = initialPlayer;
  const trackedRef = useRef(trackedPosition);
  trackedRef.current = trackedPosition;
  const audioCallback = useRef(onAudioFrame);
  audioCallback.current = onAudioFrame;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const resetControls = useRef(onControlsReset);
  resetControls.current = onControlsReset;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const host = useRef<HTMLDivElement>(null),
    fallVeil = useRef<HTMLDivElement>(null),
    actors = useRef(simulation.actors),
    callback = useRef(onPlayer),
    models = useRef(new Map<string, THREE.Group>()),
    worldRef = useRef(world),
    [failed, setFailed] = useState(false);
  actors.current = simulation.actors;
  callback.current = onPlayer;
  worldRef.current = world;
  const derivationRef = useRef(derivation);
  derivationRef.current = derivation;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      setFailed(true);
      readyRef.current?.(false);
      return;
    }
    const scene = new THREE.Scene();
    const waterReflection = makeWaterReflection();
    const weatherScene = makeWeather(world.size);
    scene.add(weatherScene.group);
    const weatherSky = new THREE.Color();
    let lastTimeOfDay = worldRef.current.timeOfDay ?? "auto";
    let targetDay = daylightAt(clockRef.current(), lastTimeOfDay);
    const currentDay = { ...targetDay };
    const graphicsDaylight = { value: currentDay.daylight };
    let lastClockSample = -Infinity;
    const sky = new THREE.Color("#000000");
    const mistColor = new THREE.Color();
    scene.background = sky;
    const baseFog = mode === "play" ? 0.055 : 0.018;
    const atmosphere = new THREE.FogExp2(sky, baseFog * currentDay.fog);
    scene.fog = atmosphere;
    const quality = renderQuality();
    renderer.setPixelRatio(mode === "observation" ? Math.min(1, quality.pixelRatio) : quality.pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor("#000000");
    const fragment = sector ? createSectorSurface(world.size, sector) : null;
    const pixelRenderer = fragment ? null : makePixelRenderer(renderer, graphicsDaylight, quality.samples);
    el.appendChild(renderer.domElement);
    const ambient = new THREE.HemisphereLight(
      "#ffffff",
      "#111111",
      currentDay.ambient,
    );
    scene.add(ambient);
    const sun = new THREE.DirectionalLight("#ffffff", currentDay.sun);
    sun.name = "whistle-sun";
    sun.position.set(currentDay.sunX, currentDay.sunY, currentDay.sunZ);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const moon = new THREE.DirectionalLight("#dbe4f3", currentDay.moon);
    moon.name = "whistle-moon";
    moon.position.set(10, 16, -10);
    scene.add(moon);

    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      material("#000000"),
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.name = "world-horizon";
    horizon.position.y = -18.01;
    horizon.receiveShadow = true;
    horizon.visible = !fragment && !world.terrain?.floating;
    softenEdges(horizon, world.size);
    scene.add(horizon);
    let structures = derivationRef.current.structures;
    const terrainCache = createTerrainCache();
    let terrain = makeTerrain(world, structures, derivationRef.current.environment, terrainCache);
    terrain.group.getObjectByName("terrain-bank")!.visible = mode === "play";
    applyPixelMaterials(terrain.group, graphicsDaylight, world.terrain?.floating);
    softenEdges(terrain.group, world.size);
    fragment?.apply(terrain.group);
    scene.add(terrain.group);
    let terrainSignature = derivationRef.current.key;
    const observation = mode === "observation" ? createObservationCamera() : null;
    const camera =
      mode === "play" || observation
        ? new THREE.PerspectiveCamera(observation ? 40 : 66, 1, 0.08, 300)
        : new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 400);
    if (mode === "overview") {
      camera.position.set(16, 34, 22);
      camera.lookAt(0, 0, 0);
    }
    const restOrbit = new THREE.Spherical().setFromVector3(new THREE.Vector3(20, 24, 25));
    const currentOrbit = restOrbit.clone();
    let sectorYaw = 0, sectorTilt = 0;
    if (fragment) {
      camera.position.copy(fragment.center).add(new THREE.Vector3(20, 24, 25));
      camera.lookAt(fragment.center);
      weatherScene.group.visible = false;
    }
    const toScene = (n: number) => n * 2 - world.size + 1;
    let trackingMarker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | undefined;
    const updateTrackingMarker = () => {
      const position = trackedRef.current;
      if (position && !trackingMarker) {
        trackingMarker = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12),
          new THREE.MeshBasicMaterial({ color: "#e34d35", depthTest: false, fog: false, toneMapped: false }));
        trackingMarker.name = "uwb-position";
        trackingMarker.renderOrder = 100;
        scene.add(trackingMarker);
      }
      if (trackingMarker) {
        trackingMarker.visible = !!position;
        if (position) trackingMarker.position.set(toScene(position.x), position.y + 0.5, toScene(position.z));
      }
    };
    const pulses = new THREE.Group();
    scene.add(pulses);
    let pulseId = 0,
      pulseStart = 0;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const previewOrbit = mode === "overview" ? new OrbitControls(camera, renderer.domElement) : null;
    if (previewOrbit) {
      previewOrbit.enablePan = false;
      previewOrbit.enableZoom = false;
      previewOrbit.enableDamping = !reducedMotion;
      previewOrbit.dampingFactor = .1;
      previewOrbit.rotateSpeed = .65;
      previewOrbit.minPolarAngle = .2;
      previewOrbit.maxPolarAngle = Math.PI * .32;
      renderer.domElement.tabIndex = 0;
      previewOrbit.addEventListener("start", () => { renderer.domElement.dataset.dragging = "true"; });
      previewOrbit.addEventListener("end", () => { delete renderer.domElement.dataset.dragging; });
    }
    const rotatePreview = (event: KeyboardEvent) => {
      if (!previewOrbit || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const offset = camera.position.clone().sub(previewOrbit.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === "ArrowLeft") spherical.theta -= .15;
      if (event.key === "ArrowRight") spherical.theta += .15;
      if (event.key === "ArrowUp") spherical.phi -= .1;
      if (event.key === "ArrowDown") spherical.phi += .1;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, previewOrbit.minPolarAngle, previewOrbit.maxPolarAngle);
      camera.position.copy(previewOrbit.target).add(offset.setFromSpherical(spherical));
      previewOrbit.update();
    };
    renderer.domElement.addEventListener("keydown", rotatePreview);
    const clearPulses = () => {
      disposeGroup(pulses);
      pulses.clear();
    };
    const player: Player = { ...world.start, yaw: 0, ...spawnRef.current, falling: false };
    const portalScene = createPortalScene(world.size);
    scene.add(portalScene.group);
    const meetingScene = createMeetingScene(world.size);
    scene.add(meetingScene.group);
    const symbolExperience = makeSymbolExperience();
    const contentPresentation = makeContentPresentation();
    let pointerStart: {id: number; x: number; y: number; time: number; moved: boolean} | null = null;
    let falling: { originY: number; elapsed: number } | null = null;
    let jump: ReturnType<typeof launchJump> | null = null;
    let air: EnvironmentalFlight | null = null;
    let jumpBuffer = 0;
    let groundAge = 0;
    let lastGround = floorHeight(world, player.x, player.z, structures) ?? 0;
    let respawnFade = 0;
    let audioReport = 0;
    let pitch = player.pitch ?? START_PITCH,
      targetPitch = pitch,
      targetYaw = player.yaw,
      stepRemaining = 0,
      eyeY = playerEyeHeight(
        floorHeight(world, player.x, player.z, structures) ?? 0,
        environmentAt(terrain.environment, player.x, player.z).water,
        EYE_HEIGHT,
      ),
      velocity = 0,
      frame = 0,
      last = performance.now(),
      report = 0,
      drag = false,
      lastX = 0,
      lastY = 0;
    const keys = new Set<string>();
    models.current = new Map();
    let previousActors: typeof actors.current | undefined,
      previousAssets: typeof world.assets | undefined,
      previousTerrain: typeof world.terrain;
    const fadingMist: {mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; opacity: number; started: number}[] = [];
    const updateModels = () => {
      if (
        previousActors === actors.current &&
        previousAssets === worldRef.current.assets &&
        previousTerrain === worldRef.current.terrain
      )
        return;
      previousActors = actors.current;
      previousAssets = worldRef.current.assets;
      previousTerrain = worldRef.current.terrain;
      const nextDerivation = derivationRef.current;
      if (nextDerivation.key !== terrainSignature) {
        horizon.visible = !fragment && !worldRef.current.terrain?.floating;
        terrainSignature = nextDerivation.key;
        structures = nextDerivation.structures;
        for (const fog of fadingMist) {scene.remove(fog.mesh);disposeGroup(fog.mesh);}
        fadingMist.length=0;
        const oldMist: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]=[];
        terrain.group.traverse(o=>{if(o.name==="generated-fog") oldMist.push(o as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>);});
        for(const mesh of oldMist) {
          mesh.removeFromParent();scene.add(mesh);
          fadingMist.push({mesh,opacity:mesh.material.opacity,started:performance.now()});
        }
        scene.remove(terrain.group);
        disposeGroup(terrain.group);
        terrain = makeTerrain(worldRef.current, structures, nextDerivation.environment, terrainCache);
        terrain.group.getObjectByName("terrain-bank")!.visible = mode === "play";
        applyPixelMaterials(terrain.group, graphicsDaylight, worldRef.current.terrain?.floating);
        softenEdges(terrain.group, world.size);
        fragment?.apply(terrain.group);
        scene.add(terrain.group);
      }
      const treeImages = terrain.setSurfaceImages(actors.current, worldRef.current.assets);
      const presentationAssets = new Map<string, typeof world.assets[number]>();
      for (const a of actors.current) {
        const source = worldRef.current.assets.find((s) => s.id === a.asset);
        if (!source || (!source.image && !source.text?.trim())) continue;
        const asset = { ...source, ...environmentPresentation(worldRef.current, a, terrain.environment) };
        presentationAssets.set(a.id, asset);
        const signature = JSON.stringify(asset) + (asset.placement === "surface" || asset.placement === "field"
          ? JSON.stringify([terrainSignature, a.x, a.z, a.scale, a.rotation, treeImages.has(a.id)]) : "");
        let model = models.current.get(a.id);
        if (
          model &&
          model.userData.signature !== signature
        ) {
          scene.remove(model);
          disposeGroup(model);
          models.current.delete(a.id);
          model = undefined;
        }
        if (!model) {
          model = (asset.placement === "surface" || asset.placement === "field") && !(a.site && floorHeight(worldRef.current, a.x, a.z, structures) === null)
            ? makeSurfaceImage(asset, a, worldRef.current, terrain.group, treeImages.has(a.id))
            : makeObject(asset);
          softenEdges(model, world.size);
          fragment?.apply(model);
          model.userData.asset = a.asset;
          model.userData.placementId = a.id;
          model.userData.environmentPresentation = true;
          model.userData.presentation = { placement: asset.placement ?? "upright", display: asset.display };
          model.userData.signature = signature;
          models.current.set(a.id, model);
          scene.add(model);
        }
        model.visible = !a.removed;
        if (model.userData.surface) continue;
        model.position.set(
          toScene(a.x),
          Math.max(floorHeight(worldRef.current, a.x, a.z, structures) ?? a.site?.height ?? 0, environmentAt(terrain.environment, a.x, a.z).water ?? -Infinity),
          toScene(a.z),
        );
        model.scale.setScalar(a.scale);
        model.rotation.y = (-a.rotation * Math.PI) / 180;
        model.visible = !a.removed;
        const mark = model.getObjectByName("mark"),
          spark = model.getObjectByName("spark");
        if (mark) mark.visible = a.marks.length > 0;
        if (spark) {
          spark.visible = a.marks.length > 0;
          spark.rotation.y = performance.now() * 0.001;
        }
      }
      const ids = new Set(actors.current.filter(a => { const asset = worldRef.current.assets.find(asset => asset.id === a.asset); return asset?.image || asset?.text?.trim(); }).map(a => a.id));
      for (const [id, m] of models.current) {
        if (!ids.has(id)) {
          scene.remove(m);
          disposeGroup(m);
          models.current.delete(id);
        }
      }
      contentPresentation.sync(actors.current, presentationAssets, models.current, terrain.group);
    };
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      if (pixelRenderer) pixelRenderer.resize(w, h);
      else renderer.setSize(w, h, false);
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
      else {
        const size = fragment ? Math.max(fragment.span * .65625, fragment.span * .78 * h / w) : world.size * 1.22;
        camera.left = (-size * w) / h;
        camera.right = (size * w) / h;
        camera.top = size;
        camera.bottom = -size;
      }
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const blocked = (x: number, z: number) =>
      (!!(jump || air) && blocksVoidStep(worldRef.current, player, { x, z }, structures)) ||
      ((!jump && !air) && blocksWalkingStep(worldRef.current, player, {x, z}, structures)) ||
      (jump || air
        ? blocksAirStep(air ? air.y : jumpFrame(jump!.origin, jump!.elapsed).y,
            floorHeight(worldRef.current, x, z, structures))
        : false) ||
      terrain.environment.trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < .18) ||
      actors.current.some(
        (a) =>
          !a.removed &&
          symbolExperience.blocksMovement(a.id) &&
          worldRef.current.assets.find((s) => s.id === a.asset)?.solid &&
          Math.hypot(x - a.x, z - a.z) < 0.43 * a.scale + 0.13,
      );
    const keydown = (e: KeyboardEvent) => {
      if (
        mode !== "play" ||
        falling !== null ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            e.target.closest("input, textarea, select")))
      )
        return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        keys.add("jump-held");
        if (!e.repeat) jumpBuffer = JUMP_BUFFER_SECONDS;
        return;
      }
      const key = movementKey(e);
      if (key) {
        e.preventDefault();
        if (!e.repeat) keys.add(key);
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") keys.delete("jump-held");
      const key = movementKey(e);
      if (key) keys.delete(key);
    };
    const clear = () => {
      keys.clear();
      controls?.current.clear();
      if (stick) stick.current = { x: 0, y: 0 };
      resetControls.current?.();
      jumpBuffer = 0;
      stepRemaining = 0;
      velocity = 0;
      drag = false;
      pointerStart = null;
      symbolExperience.pause();
    };
    const focusInput = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest("input, textarea, select"))) clear();
    };
    const down = (e: PointerEvent) => {
      if (mode !== "play" || falling || pointerStart || e.button !== 0) return;
      pointerStart = {id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),moved:false};
      drag = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || !pointerStart || pointerStart.id !== e.pointerId) return;
      if (Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y) > 8) pointerStart.moved = true;
      if (!pointerStart.moved) return;
      targetYaw =
        player.yaw +
        THREE.MathUtils.clamp(
          targetYaw + (e.clientX - lastX) * 0.002 - player.yaw,
          -Math.PI / 6,
          Math.PI / 6,
        );
      targetPitch = THREE.MathUtils.clamp(
        targetPitch - (e.clientY - lastY) * 0.0015,
        -0.7,
        1.45,
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (!pointerStart || pointerStart.id !== e.pointerId) return;
      if (e.type === "pointerup" && !pointerStart.moved &&
          Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y) <= 8 &&
          performance.now()-pointerStart.time < 450 && !falling)
        symbolExperience.tap(e.clientX,e.clientY,renderer.domElement.getBoundingClientRect());
      pointerStart = null;
      drag = false;
    };
    if (mode === "play") {
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
      window.addEventListener("blur", clear);
      document.addEventListener("visibilitychange", clear);
      window.addEventListener("focusin", focusInput);
      renderer.domElement.addEventListener("pointerdown", down);
      renderer.domElement.addEventListener("pointermove", move);
      renderer.domElement.addEventListener("pointerup", up);
      renderer.domElement.addEventListener("pointercancel", up);
    }
    let rendered = false;
    const render = (time: number) => {
      const elapsed = Math.max(0, (time - last) / 1000);
      if (observation && elapsed < 1 / 30 - .001) {
        frame = requestAnimationFrame(render);
        return;
      }
      if ((fragment || observation) && mount && visitor) {
        const target = cameraOffset(mount, visitor.current, Date.now());
        const blend = 1 - Math.exp(-Math.min(elapsed, .2) / (target.tilt === 0 ? 1.2 : .45));
        sectorYaw += (target.yaw - sectorYaw) * blend;
        sectorTilt += (target.tilt - sectorTilt) * blend;
        if (fragment) {
          currentOrbit.theta = restOrbit.theta + sectorYaw;
          currentOrbit.phi = restOrbit.phi - sectorTilt;
          camera.position.setFromSpherical(currentOrbit).add(fragment.center);
          camera.lookAt(fragment.center);
        } else if (observation && camera instanceof THREE.PerspectiveCamera) {
          renderer.domElement.dataset.subject = observation.update(camera, worldRef.current, derivationRef.current,
            actors.current, mount, mappingRef.current, sectorYaw, sectorTilt, elapsed);
        }
        renderer.domElement.dataset.sectorYaw = (sectorYaw * 180 / Math.PI).toFixed(2);
      }
      const dt = Math.min(elapsed, 0.05);
      last = time;

      const timeOfDay = worldRef.current.timeOfDay ?? "auto";
      const changedTimeOfDay = timeOfDay !== lastTimeOfDay;
      if (changedTimeOfDay || time - lastClockSample >= 1000) {
        targetDay = daylightAt(clockRef.current(), timeOfDay);
        lastTimeOfDay = timeOfDay;
        lastClockSample = time;
      }
      const blend = changedTimeOfDay && reducedMotion ? 1 : 1 - Math.exp(-dt * (timeOfDay === "auto" ? .8 : 2.4));
      for (const key of [
        "daylight",
        "ambient",
        "sun",
        "moon",
        "sunX",
        "sunY",
        "sunZ",
        "fog",
      ] as const)
        currentDay[key] += (targetDay[key] - currentDay[key]) * blend;
      const weather = worldRef.current.weather ?? "clear";
      graphicsDaylight.value = currentDay.daylight;
      const climate = WEATHER[weather];
      weatherSky.set(climate.sky);
      const skyLight = weatherSky.r * .2126 + weatherSky.g * .7152 + weatherSky.b * .0722;
      sky.setScalar(.002 + skyLight * currentDay.daylight * .48);
      atmosphere.color.setScalar(horizonTone(currentDay.daylight)).convertSRGBToLinear();
      atmosphere.density = baseFog * currentDay.fog * climate.fog;
      mistColor.copy(sky).multiplyScalar(.88).addScalar(.072);
      ambient.intensity = (.5 + currentDay.daylight * .22) * climate.ambient;
      sun.intensity = currentDay.sun * climate.sun * 1.3;
      sun.position.set(currentDay.sunX, currentDay.sunY, currentDay.sunZ);
      moon.intensity = currentDay.moon * 3;
      updateModels();
      updateTrackingMarker();
      portalScene.sync(portalRef.current.portals, player);
      previewOrbit?.update();
      terrain.update(time, camera, mistColor, reducedMotion, weather, currentDay.daylight);
      if (mode === "overview") {
        const reaction = feedbackRef.current;
        if (reaction && reaction.id !== pulseId) {
          clearPulses();
          pulseId = reaction.id;
          pulseStart = time;
          for (const region of feedbackRegions(reaction.cells, world.size)) {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.98, 1, 64),
              new THREE.MeshBasicMaterial({
                color: 0x111111,
                transparent: true,
                opacity: 0.65,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide,
              }),
            );
            const top = Math.max(
              ...region.indices.map((i) => {
                const x = i % world.size,
                  z = Math.floor(i / world.size);
                return Math.max(
                  floorHeight(worldRef.current, x, z, structures) ?? 0,
                  terrain.environment.cells[i].water ?? -Infinity,
                );
              }),
            );
            ring.position.set(toScene(region.x), top + 0.06, toScene(region.z));
            ring.rotation.x = -Math.PI / 2;
            ring.userData.radius = region.radius * 2;
            ring.renderOrder = 10;
            pulses.add(ring);
          }
        }
        const age = (time - pulseStart) / 1400;
        if (!reaction || age >= 1) {
          if (pulses.children.length) clearPulses();
        } else
          for (const child of pulses.children) {
            const ring = child as THREE.Mesh<
              THREE.RingGeometry,
              THREE.MeshBasicMaterial
            >;
            ring.scale.setScalar(
              ring.userData.radius * (reducedMotion ? 1 : 0.9 + age * 0.3),
            );
            ring.material.opacity = reducedMotion ? 0.5 : 0.7 * (1 - age);
            ring.material.color.setScalar(1);
          }
      }
      for (const a of actors.current) {
        const model = models.current.get(a.id);
        if (!model || a.removed || model.userData.surface) continue;
        const c = environmentAt(terrain.environment, a.x, a.z);
        const base =
          floorHeight(worldRef.current, a.x, a.z, structures) ?? a.site?.height ?? -0.4;
        model.position.y =
          Math.max(base, c.water ?? -Infinity) +
          (c.water !== null && c.water > base
            ? Math.sin(time * 0.0012 + a.x) * 0.035
            : 0);
        model.rotation.z = 0;
        model.rotation.x = 0;
        if (mode !== "play") {
          const picture = model.getObjectByName("symbol-content") as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial> | undefined;
          if (picture) picture.material.opacity = 1;
        }
      }
      if (mode === "play" && !portalRef.current.suspended) {
        let audioFeet: number | null = null;
        if (falling) {
          falling.elapsed += dt;
          const frame = fallFrame(falling.originY, falling.elapsed);
          eyeY = reducedMotion ? falling.originY : frame.y;
          if (fallVeil.current)
            fallVeil.current.style.opacity = String(frame.fade);
          if (frame.done) {
            player.x = worldRef.current.start.x;
            player.z = worldRef.current.start.z;
            player.yaw = targetYaw = 0;
            pitch = targetPitch = START_PITCH;
            const spawn = environmentAt(
              terrain.environment,
              player.x,
              player.z,
            );
            eyeY = playerEyeHeight(
              floorHeight(worldRef.current, player.x, player.z, structures) ?? 0,
              spawn.water,
              EYE_HEIGHT,
            );
            falling = null;
            jump = null;
            air = null;
            groundAge = 0;
            lastGround = floorHeight(worldRef.current, player.x, player.z, structures) ?? 0;
            respawnFade = 1;
            clear();
          }
        } else {
          respawnFade = Math.max(0, respawnFade - dt / 0.35);
          if (fallVeil.current)
            fallVeil.current.style.opacity = String(respawnFade);
          const active = (key: string) =>
            keys.has(key) || controls?.current.has(key);
          const profile = movementProfile(!!active("run"), !!active("crouch"));
          const ground = floorHeight(worldRef.current, player.x, player.z, structures);
          const localEffects = environmentAt(terrain.environment, player.x, player.z);
          if (ground !== null && !jump && !air) {
            lastGround = ground;
            groundAge = 0;
          } else groundAge += dt;
          if (controls?.current.delete("jump")) jumpBuffer = JUMP_BUFFER_SECONDS;
          else jumpBuffer = Math.max(0, jumpBuffer - dt);
          if (jumpBuffer > 0 && !jump && !air && groundAge <= COYOTE_SECONDS) {
            const input = Number(!!(active("forward") || active("w") || active("arrowup")))
              - Number(!!(active("backward") || active("s") || active("arrowdown")))
              || Math.sign(stick?.current.y ?? 0);
            const direction = input || (Math.abs(velocity) > .1 ? Math.sign(velocity) : Math.sign(stepRemaining));
            jump = launchJump(lastGround, player.yaw, direction, 1.5 * profile.speed);
            jumpBuffer = 0;
            groundAge = Infinity;
            stepRemaining = 0;
          }
          if (jump) jump.elapsed += dt;
          const crouching = !!active("crouch");
          if (!air && ground === null && localEffects.lift > .12 && !crouching) {
            const feet = jump ? jumpFrame(jump.origin, jump.elapsed).y : eyeY - profile.eyeHeight;
            if (feet < localEffects.liftCeiling + 1.5) {
              air = environmentalFlight("float", feet, jump?.vx ?? 0, jump?.vz ?? 0);
              jump = null;
            }
          }
          for (const [command, turn] of [
            ["turn-left", -Math.PI / 12],
            ["turn-right", Math.PI / 12],
          ] as const) {
            if (controls?.current.delete(command)) {
              targetYaw =
                player.yaw +
                THREE.MathUtils.clamp(
                  targetYaw + turn - player.yaw,
                  -Math.PI / 6,
                  Math.PI / 6,
                );
            }
          }
          if (controls?.current.delete("step"))
            stepRemaining = Math.min(stepRemaining + 0.35, 0.7);
          if (controls?.current.delete("backstep"))
            stepRemaining = Math.max(stepRemaining - 0.35, -0.7);
          const turn =
            Number(!!(active("right") || active("d") || active("arrowright"))) -
            Number(!!(active("left") || active("a") || active("arrowleft")))
            || (stick?.current.x ?? 0);
          if (turn) {
            targetYaw += turn * dt * 0.55;
          }
          player.yaw = followHeading(player.yaw, targetYaw, dt);
          pitch += (targetPitch - pitch) * (1 - Math.exp(-4 * dt));
          const heldForward =
            active("forward") || active("w") || active("arrowup");
          const backward =
            active("backward") || active("s") || active("arrowdown");
          const forwardInput = Number(!!heldForward) - Number(!!backward) || (stick?.current.y ?? 0);
          let distance = forwardInput * dt * 1.5;
          if (forwardInput) stepRemaining = 0;
          else if (Math.abs(stepRemaining) > 0) {
            distance =
              Math.sign(stepRemaining) *
              Math.min(dt * 1.5, Math.abs(stepRemaining));
            stepRemaining -= distance;
          }
          const airInput = dt > 0 ? distance / (dt * 1.5) : 0;
          const surface =
            tileAt(worldRef.current, player.x, player.z)?.surface ?? "plain";
          const conditions = environmentAt(
            terrain.environment,
            player.x,
            player.z,
          );
          const wet =
            conditions.water !== null &&
            conditions.water >
              (floorHeight(worldRef.current, player.x, player.z, structures) ??
                0);
          const ladder = !jump && !air ? ladderAt(structures,player.x,player.z) : undefined;
          const rise = ladder ? ((tileAt(worldRef.current,ladder.x+ladder.dx,ladder.z+ladder.dz)?.height ?? ladder.height)-ladder.height)*LEVEL : 0;
          const climbSpeed = ladder ? Math.min(1,1.2/Math.max(rise,1))/profile.speed : 1;
          const speed =
            SURFACES.find((s) => s.id === surface)!.speed * (wet ? 0.55 : 1) * profile.speed * climbSpeed;
          const desired = dt ? (distance / dt) * speed : 0;
          velocity = desired;
          distance = velocity * dt;
          if (air) {
            const steering = airInput * 1.2;
            air.vx = Math.sin(player.yaw) * steering;
            air.vz = -Math.cos(player.yaw) * steering;
          }
          const dx = air ? air.vx * dt : jump ? jump.vx * dt : Math.sin(player.yaw) * distance,
            dz = air ? air.vz * dt : jump ? jump.vz * dt : -Math.cos(player.yaw) * distance;
          if (!blocked(player.x + dx, player.z)) player.x += dx;
          if (!blocked(player.x, player.z + dz)) player.z += dz;
          const floor = floorHeight(
            worldRef.current,
            player.x,
            player.z,
            structures,
          );
          let feet = floor;
          if (air) {
            const effects = environmentAt(terrain.environment, player.x, player.z);
            const result = stepEnvironmentalFlight(air, dt, floor, {
              lift: effects.lift, liftCeiling: effects.liftCeiling,
              crouching,
            });
            if (!reducedMotion) {
              player.yaw += result.yawDelta;
              targetYaw += result.yawDelta;
            }
            air = result.landed || result.missed ? null : result.flight;
            feet = result.missed ? null : result.flight.y;
          } else if (jump) {
            const landing = resolveJump(jump, floor);
            feet = landing.feet;
            if (landing.landed || landing.missed) jump = null;
          } else if (floor === null && groundAge <= COYOTE_SECONDS) {
            feet = lastGround - 5 * groundAge * groundAge;
          }
          audioFeet = feet;
          if (feet === null) {
            falling = { originY: eyeY, elapsed: 0 };
            clear();
            callback.current?.({ ...player, pitch, falling: true });
          } else {
            const local = environmentAt(
              terrain.environment,
              player.x,
              player.z,
            );
            const targetY = playerEyeHeight(feet, local.water, profile.eyeHeight);
            eyeY += (targetY - eyeY) * (1 - Math.exp(-8 * dt));
          }
        }
        const underfoot = environmentAt(terrain.environment, player.x, player.z);
        const ground = floorHeight(worldRef.current, player.x, player.z, structures);
        const dry = underfoot.water === null || (ground !== null && ground >= underfoot.water);
        if (audioCallback.current) {
          const onGround = !falling && !jump && !air && respawnFade === 0 && ground !== null;
          if (time - audioReport > 80) {
            audioCallback.current({
              x: player.x, y: audioFeet ?? ground ?? eyeY - EYE_HEIGHT, z: player.z,
              size: worldRef.current.size,
              grass: underfoot.grass,
              rough: dry && ground !== null
                ? terrainSample(worldRef.current, player.x, player.z).weights.rough : 0,
              water: dry ? 0 : 1, grounded: onGround, falling: falling !== null, yaw: player.yaw,
              crouch: !!controls?.current.has("crouch"), run: !!controls?.current.has("run"),
            });
            audioReport = time;
          }
        }
        camera.position.set(toScene(player.x), eyeY, toScene(player.z));
        camera.rotation.order = "YXZ";
        camera.rotation.y = -player.yaw;
        camera.rotation.x = pitch;
        camera.rotation.z = 0;
        if (time - report > 80) {
          renderer.domElement.dataset.motion = air?.mode ?? (jump ? "jump" : falling ? "fall" : underfoot.water !== null ? "swim" : "walk");
          renderer.domElement.dataset.playerX = String(player.x);
          renderer.domElement.dataset.playerZ = String(player.z);
          renderer.domElement.dataset.playerYaw = String(player.yaw);
          callback.current?.({ ...player, pitch, falling: falling !== null,
            grounded: !falling && !jump && !air && respawnFade === 0 && ground !== null });
          report = time;
        }
        if (!falling && !jump && !air && respawnFade === 0) {
          const entered = portalScene.enter(player, Math.max(ground ?? 0, underfoot.water ?? -Infinity));
          if (entered) { clear(); portalRef.current.onPortal?.(entered, { ...player, pitch }); }
        }
      }
      if (mode === "play" && portalRef.current.suspended) {
        clear();
        camera.position.set(toScene(player.x), eyeY, toScene(player.z));
        camera.rotation.order = "YXZ";
        camera.rotation.set(pitch, -player.yaw, 0);
      }
      if (mode === "play") symbolExperience.update({
        world: worldRef.current, actors: actors.current, models: models.current, camera,
        environment: terrain.environment, structures, terrain: terrain.group, player,
        feet: floorHeight(worldRef.current,player.x,player.z,structures) ?? eyeY - EYE_HEIGHT,
        grounded: !falling && !jump && !air && respawnFade === 0,
        dt: document.hidden ? 0 : dt, time, reducedMotion, daylight: currentDay.daylight,
      });
      meetingScene.sync(meetingRef.current, worldRef.current, camera, time);
      contentPresentation.update(camera, worldRef.current.size, time, mode !== "play", reducedMotion);
      weatherScene.update(time, worldRef.current.weather ?? "clear", camera, currentDay.daylight, mode === "overview");
      for(let i=fadingMist.length-1;i>=0;i--) {
        const fog=fadingMist[i],fade=Math.min(1,(time-fog.started)/650);
        fog.mesh.material.opacity=fog.opacity*(1-fade);
        fog.mesh.quaternion.copy(camera.quaternion);
        fog.mesh.material.color.copy(sky);
        if(fade>=1) {scene.remove(fog.mesh);disposeGroup(fog.mesh);fadingMist.splice(i,1);}
      }
      waterReflection.update(renderer, scene, camera, terrain.group, time);
      if (pixelRenderer) pixelRenderer.render(scene, camera);
      else {
        if (trail) fragment?.paint(trail.current, Date.now());
        renderer.render(scene, camera);
      }
      if (!rendered) {
        rendered = true;
        renderer.domElement.dataset.ready = "true";
        readyRef.current?.(true);
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
      readyRef.current?.(false);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("focusin", focusInput);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      clear();
      previewOrbit?.dispose();
      renderer.domElement.removeEventListener("keydown", rotatePreview);
      waterReflection.dispose();
      pixelRenderer?.dispose();
      fragment?.dispose();
      disposeGroup(scene);
      renderer.dispose();
      renderer.domElement.remove();
      models.current.clear();
    };
  }, [world.size, world.sky, world.start.x, world.start.z, mode, sector, trail, mount, visitor]);
  return (
    <div
      className={`scene ${className}`}
      ref={host}
      role="img"
      aria-label={sector ?? t(
        mode === "play" ? "플레이 화면" : mode === "observation" ? "오브제 관찰 화면" : "3D 미리보기",
      )}
    >
      <div ref={fallVeil} className="fall-veil" aria-hidden="true" />
      {failed && (
        <div className="scene-error">
          {t("3D 화면을 시작할 수 없습니다.")}
        </div>
      )}
    </div>
  );
}
