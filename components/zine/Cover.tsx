import { useEffect, useRef } from "react";
import { terrainSample } from "@/lib/terrain";
import type { Leaf } from "./pages";

// A print of the edited world. Both the terrain and the walk use grid coordinates.
export function Cover({ leaf }: { leaf: Leaf }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { world, trail } = leaf;
    const size = world.size,
      px = 560 / size;
    const pos = (n: number) => (n + 0.5) * px;
    ctx.fillStyle = "#e5e5cb";
    ctx.fillRect(0, 0, 560, 560);
    // Ink density follows the same blended surface weights as the 3D terrain.
    const wash = document.createElement("canvas");
    wash.width = wash.height = 112;
    const paint = wash.getContext("2d")!;
    const ink = paint.createImageData(112, 112);
    const colors = [
      [226, 228, 204],
      [102, 126, 100],
      [131, 174, 174],
      [179, 168, 143],
    ];
    for (let i = 0; i < 112 * 112; i++) {
      const u = i % 112,
        v = Math.floor(i / 112);
      const { weights, coverage } = terrainSample(
        world,
        ((u + 0.5) * size) / 112 - 0.5,
        ((v + 0.5) * size) / 112 - 0.5,
      );
      const amounts = [
        weights.plain,
        weights.soft,
        weights.slick,
        weights.rough,
      ];
      for (let channel = 0; channel < 3; channel++) {
        ink.data[i * 4 + channel] =
          colors.reduce((sum, c, k) => sum + c[channel] * amounts[k], 0) *
            coverage +
          48 * (1 - coverage);
      }
      ink.data[i * 4 + 3] = 255;
    }
    paint.putImageData(ink, 0, 0);
    ctx.drawImage(wash, 0, 0, 560, 560);
    ctx.lineWidth = 0.6;
    for (let n = 0; n <= size; n++) {
      ctx.strokeStyle = "#aab49a";
      ctx.strokeRect(n * px, 0, 0, 560);
      ctx.strokeRect(0, n * px, 560, 0);
    }
    // Draw a family of engraved east–west profiles through the actual height field.
    for (let row = 0; row < 115; row++) {
      const z = (row * size) / 113 - 0.5;
      ctx.beginPath();
      for (let col = 0; col <= 150; col++) {
        const x = (col * size) / 150 - 0.5;
        const s = terrainSample(world, x, z);
        const y = pos(z) - s.height * 16;
        if (!col) ctx.moveTo(pos(x), y);
        else ctx.lineTo(pos(x), y);
      }
      ctx.strokeStyle = "#526d59";
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    for (let i = 0; i < size * size; i++) {
      const tile = world.terrain?.tiles[i];
      if (!tile) continue;
      const x = (i % size) * px,
        y = Math.floor(i / size) * px;
      if (tile.surface === "plain" || tile.hole) continue;
      ctx.strokeStyle = "#405c4f";
      ctx.lineWidth = 1.45;
      for (let j = 0; j < 11; j++) {
        const a = x + (((i * 61 + j * 29) % 97) / 97) * px,
          b = y + (((i * 33 + j * 41) % 89) / 89) * px;
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(
          a + (tile.surface === "slick" ? 6 : 2),
          b - (tile.surface === "soft" ? 5 : 1),
        );
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#203f32";
    for (const o of world.objects) {
      ctx.beginPath();
      ctx.arc(pos(o.x), pos(o.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (trail) {
      ctx.beginPath();
      let pen = false;
      for (const point of trail) {
        if (!point) {
          pen = false;
          continue;
        }
        const [x, z] = point;
        if (!pen) ctx.moveTo(pos(x), pos(z));
        else ctx.lineTo(pos(x), pos(z));
        pen = true;
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#c6492b";
      ctx.stroke();
      const start = trail[0],
        end = trail.at(-1);
      if (start) {
        ctx.beginPath();
        ctx.arc(pos(start[0]), pos(start[1]), 6, 0, 2 * Math.PI);
        ctx.fillStyle = "#f7f5eb";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (end) {
        ctx.beginPath();
        ctx.arc(pos(end[0]), pos(end[1]), 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#c6492b";
        ctx.fill();
      }
    }
  }, [leaf.world, leaf.trail]);
  return (
    <canvas
      ref={ref}
      width={560}
      height={560}
      className="z-print"
      role="img"
      aria-label={
        leaf.trail ? "지형 위에 표시한 실제 걸음" : "이 면의 지형 판화"
      }
    />
  );
}
