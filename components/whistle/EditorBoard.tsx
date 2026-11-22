"use client";
import { useMemo, type ReactNode } from "react";
import type { Actor, World } from "@/lib/world";
import type { PlacementFeedback } from "@/lib/placement-feedback";
import type { WorldDerivation } from "@/lib/world-derivation";
import { tileAt, SURFACES, LEVEL } from "@/lib/terrain";
import { WATER_INSET } from "@/lib/water";
import { isGap, isHole, isVoid } from "@/lib/tile";
import { PaintGrid } from "./PaintGrid";
import { EnvironmentTile, environmentTileKind } from "./EnvironmentTile";
import { HoleGlyph } from "./HoleGlyph";
import { EnvironmentEffects } from "./EnvironmentEffects";
import { effectRegions } from "@/lib/effect-regions";
import { useEffectFeedback } from "./useEffectFeedback";
import { SoundGlyph } from "./SoundGlyph";
import { soundRangeAt } from "@/lib/audio/sound-range";
import { SiteGlyph } from "./SiteGlyph";
import { useLanguage } from "./Language";
import type { WorldPortal } from "../../lib/portals.ts";

type Props = {
  world: World;
  actors: Actor[];
  derivation: WorldDerivation;
  feedback: PlacementFeedback | null;
  canHold: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onPaint: (cells: number[], erase: boolean) => void;
  onEnd: () => void;
  placingAsset: string | null;
  placingStart: boolean;
  onOpenSymbol: (index: number, objectId?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  portals?: WorldPortal[];
  overlay?: ReactNode;
};

export function EditorBoard({
  world, actors, derivation, feedback, canHold, canUndo, canRedo,
  onPaint, onEnd, placingAsset, placingStart, onOpenSymbol, onUndo, onRedo,
  portals = [],
  overlay,
}: Props) {
  const { t } = useLanguage();
  const { structures, environment } = derivation;
  const regions = useMemo(() => effectRegions(environment), [environment]);
  const effectFeedback = useEffectFeedback(regions, world.size, feedback?.id ?? null);
  const effectCells = new Set(effectFeedback.markers.map(region => region.anchor));
  const environmentLabels = (i: number) => {
    const c = environment.cells[i];
    return [
      c.grass > 0 ? t("풀") : "",
      c.tree ? t("나무") : "",
      c.water !== null ? t("물") : "",
      c.fog > 0.05 ? t("안개") : "",
      Math.hypot(c.windX, c.windZ) > 0.1 ? t("바람") : "",
      c.light < 0.7 ? t("그늘") : "",
      c.dust ? t("먼지") : "",
      c.bounce ? t("튕기기") : "", c.flicker ? t("깜박임") : "",
      c.lift ? t("부유") : "", c.glide ? t("활공") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return (
    <section className="canvas-panel">
      <div className="canvas-area">
        <PaintGrid
          size={world.size}
          overlay={<>
            {overlay}
            <EnvironmentEffects regions={effectFeedback.markers} size={world.size} onAnimationEnd={effectFeedback.finish} />
            <div className="portal-map-layer">{portals.map(portal => <span key={portal.id} className="portal-map-marker" role="img"
              style={{ left: `${(portal.x + .5) / world.size * 100}%`, top: `${(portal.z + .5) / world.size * 100}%` }}
              aria-label={`${portal.label} ${t("포털")}`} data-map-portal={portal.id}>
              <span className="portal-glyph" aria-hidden="true" />
            </span>)}</div>
          </>}
          occupied={(i) =>
            world.objects.some(
              (o) =>
                o.x === i % world.size &&
                o.z === Math.floor(i / world.size) && (!placingAsset || o.asset === placingAsset),
            )
          }
          canHold={canHold}
          onPaint={onPaint}
          onEnd={onEnd}
          onHold={onOpenSymbol}
          cellClass={(i) => {
            const tile = tileAt(
              world,
              i % world.size,
              Math.floor(i / world.size),
            )!;
            const c = environment.cells[i];
            const sound = world.assets.find(a => a.id === placingAsset)?.sound;
            const inSoundRange = sound && world.objects.some(o => o.asset === placingAsset && Math.hypot(o.x - i % world.size, o.z - Math.floor(i / world.size)) < soundRangeAt(environment, o.x, o.z));
            return `${inSoundRange ? "sound-range" : ""} surface-${effectCells.has(i) || environmentTileKind(c) ? "plain" : tile.surface} level-${c.water === null ? tile.height : 0} ${isVoid(tile) ? "tile-empty" : isHole(tile) ? "tile-void" : "tile-ground"} ${effectCells.has(i) ? "has-effect" : ""} ${c.grass ? "has-grass" : ""} ${c.water !== null ? "has-water" : ""} ${c.tree ? "has-tree" : ""} ${c.fog > 0.05 ? "has-fog" : ""}`;
          }}
          label={(i) => {
            const x = i % world.size,
              z = Math.floor(i / world.size),
              tile = tileAt(world, x, z)!;
            const objects = world.objects.filter(
              (o) => o.x === x && o.z === z,
            );
            const water = environment.cells[i].water;
            const height = water === null ? tile.height : Math.round((water + WATER_INSET) / LEVEL);
            return `${String.fromCharCode(65 + x)}${z + 1} ${isVoid(tile) ? t("허공") : isHole(tile) ? t("꺼짐") : `${t("높이")} ${height} ${t(SURFACES.find((s) => s.id === tile.surface)!.name)}`} ${objects.map(object => world.assets.find(a => a.id === object.asset)?.name).filter(Boolean).join(" · ")}${x === world.start.x && z === world.start.z ? " " + t("시작점") : ""} ${environmentLabels(i)}`;
          }}
          renderCell={(i) => {
            const x = i % world.size,
              z = Math.floor(i / world.size),
              tile = tileAt(world, x, z)!;
            const cellActors = actors.filter(
              (a) => a.x === x && a.z === z && !a.removed && world.assets.some(asset => asset.id === a.asset && (asset.image || asset.text?.trim() || asset.sound)),
            );
            const actor = cellActors[0];
            const generated = structures.filter(
              (t) => t.x === x && t.z === z,
            );
            const conditions = environment.cells[i];
            const height = conditions.water === null ? tile.height : Math.round((conditions.water + WATER_INSET) / LEVEL);
            const reaction = feedback?.cells.find((c) => c.index === i);
            return (
              <>
                <span
                  className="environment-light"
                  aria-hidden="true"
                  style={{ opacity: (1 - conditions.light) * 0.2 }}
                />
                {!isVoid(tile) && !effectCells.has(i) && (isHole(tile)
                  ? <HoleGlyph className="result-tile result-hole" />
                  : <EnvironmentTile cell={conditions} />)}
                {height !== 0 && !isGap(tile) && (
                  <span className="tile-height">{height}</span>
                )}
                {!effectCells.has(i) && generated.map((t) => (
                  <span
                    key={t.key}
                    className={`generated generated-${t.kind}`}
                    style={
                      t.kind === "stairs"
                        ? {
                            transform: `rotate(${t.dx ? t.dx * 90 : t.dz === 1 ? 180 : 0}deg)`,
                          }
                        : t.kind === "bridge" && t.dz
                          ? { transform: "rotate(90deg)" }
                          : undefined
                    }
                  >
                    {t.kind === "stairs" && <svg viewBox="0 0 32 32" aria-hidden="true">
                      <path d="M11 8V24M21 8V24M11 12H21M11 16H21M11 20H21"
                        fill="none" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>}
                  </span>
                ))}
                {cellActors.map((placed, layer) => {
                  const asset = world.assets.find(a => a.id === placed.asset)!;
                  const kind = asset.text !== undefined ? "peak" : "cluster";
                  const offset = (layer - (cellActors.length - 1) / 2) * Math.min(4, 12 / cellActors.length);
                  return <span key={placed.id} className="generated-site" data-symbol-site={placed.id}
                    style={{ marginLeft: offset, marginTop: -offset, zIndex: 5 + layer }}
                    onPointerDown={e => { if (!placingStart && !placingAsset) e.stopPropagation(); }}
                    onClick={e => { if (!placingStart && !placingAsset) { e.stopPropagation(); onOpenSymbol(i, placed.id); } }}>
                    {asset.sound ? <SoundGlyph color={asset.glyphColor ?? asset.color} /> : <SiteGlyph kind={kind} filled={!!asset?.image || !!asset?.text?.trim()} color={asset.glyphColor ?? asset.color} />}
                  </span>;
                })}
                {!!actor?.marks.length && (
                  <span className="cell-mark">{actor.marks[0]}</span>
                )}
                {x === world.start.x && z === world.start.z && (
                  <span className="start-marker" />
                )}
                {reaction && (
                  <span
                    key={`reaction-${feedback!.id}`}
                    aria-hidden="true"
                    className={`placement-reaction ${reaction.result ? "result-reaction" : "touch-reaction"} ${reaction.removed ? "removed-reaction" : ""}`}
                  />
                )}
              </>
            );
          }}
        />
      </div>
      <div className="canvas-tools">
        <div className="history-tools">
          <button
            aria-label={t("되돌리기")}
            disabled={!canUndo}
            onClick={onUndo}
          >
            ↶
          </button>
          <button
            aria-label={t("다시 실행")}
            disabled={!canRedo}
            onClick={onRedo}
          >
            ↷
          </button>
        </div>
      </div>
    </section>
  );
}
