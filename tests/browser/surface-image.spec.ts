import { setPresentation, openPlaced } from "./presentation";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test.setTimeout(60_000);

async function openScene(page: Page, environmentTargets = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__testScene = scene;");
    await route.fulfill({ response, body: source });
  });
  const world = terrainFixtures().mixed;
  world.start = { x: 3, z: 7 };
  if (!environmentTargets) world.terrain!.tiles[3 * 12 + 4].surface = "rough";
  world.objects = [
    { id: "standing", asset: world.assets[0].id, x: 3, z: environmentTargets ? 4 : 3, rotation: 0, scale: 1 },
    { id: "attached", asset: world.assets[1].id, x: 7, z: 5, rotation: 0, scale: 3 },
    ...(environmentTargets ? [{ id: "stone-picture", asset: world.assets[2].id, x: 2, z: 6, rotation: 0, scale: 1 }] : []),
  ];
  await page.addInitScript(world => {
    if (localStorage.getItem("surface-test-ready")) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ef7148";
    context.fillRect(8, 8, 112, 112);
    context.fillStyle = "#344ddd";
    context.fillRect(16, 16, 48, 48);
    world.assets[0].image = canvas.toDataURL();
    world.assets[1].image = canvas.toDataURL();
    world.assets[2].image = canvas.toDataURL();
    world.assets[1].placement = "surface";
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("surface-test-ready", "1");
  }, world);
  await page.goto(".");
  await page.locator(".live-preview canvas").waitFor();
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).__testScene?.getObjectByName("surface-image"))).toBe(true);
  return errors;
}

async function surfaceState(page: Page) {
  return page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    const picture = scene.getObjectByName("surface-image");
    const pos = picture.geometry.attributes.position;
    const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i) as number);
    const grass = scene.getObjectByName("grassland");
    return { count: pos.count, minY: Math.min(...ys), maxY: Math.max(...ys),
      position: picture.parent.position.toArray(), scale: picture.parent.scale.toArray(),
      trees: !!scene.getObjectByName("generated-trunks"), grass: !!scene.getObjectByName("grass-tufts"),
      ribbons: scene.getObjectByName("grass-tufts")?.count ?? 0,
      windTime: grass.userData.grassTime.value, windStrength: grass.userData.grassMotion.value };

  });
}

async function grassSurfaceState(page: Page) {
  return page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    if (!scene) return { textured: 0, total: 0, matrices: [] };
    const base = scene.getObjectByName("grass-tufts");
    const group = scene.getObjectByName("grassland");
    const meshes = group.children.filter((child: any) => child.name === "grass-tufts" || child.name === "grass-surface-image");
    const matrices = meshes.flatMap((mesh: any) => Array.from({ length: mesh.count }, (_, i) =>
      Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16)).join(","))).sort();
    const image = meshes.find((mesh: any) => mesh.name === "grass-surface-image");
    const circle = scene.children.find((child: any) => child.userData.asset === "circle");
    return { textured: image?.count ?? 0, total: meshes.reduce((sum: number, mesh: any) => sum + mesh.count, 0), matrices,
      texture: image?.material.map?.image?.src,
      sameGeometry: !image || Array.from(image.geometry.attributes.position.array).join(",") === Array.from(base.geometry.attributes.position.array).join(","),
      ground: !!circle?.getObjectByName("surface-image"),
      time: group.userData.grassTime.value, strength: group.userData.grassMotion.value };
  });
}

test("surface attachment uses existing grass or bare ground without planting anything", async ({ page }, testInfo) => {
  const errors = await openScene(page);
  const before = await grassSurfaceState(page);
  await openPlaced(page, "standing");
  const dialog = page.getByRole("dialog");
  await setPresentation(page, "placement", "surface");
  await expect(dialog.getByRole("button", { name: "풀로 심기", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "바람에 흔들리기", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBeGreaterThan(0);
  const attached = await grassSurfaceState(page);
  expect(attached.total).toBe(before.total);
  expect(attached.matrices).toEqual(before.matrices);
  expect(attached.sameGeometry).toBe(true);
  expect(attached.ground).toBe(true);
  await expect.poll(async () => (await grassSurfaceState(page)).time).toBeGreaterThan(attached.time!);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("whistle.world.v2")!).assets[0].placement)).toBe("surface");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("whistle.world.v2")!).assets[0]);
  expect(attached.texture).toBe(saved.image);
  await page.getByRole("button", { name: "번짐", exact: true }).click();
  await page.locator('[data-cell="39"]').click({ position: { x: 2, y: 2 } });
  await expect.poll(async () => (await grassSurfaceState(page)).ground).toBe(true);
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(attached.textured);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(attached.textured);
  expect((await grassSurfaceState(page)).matrices).toEqual(before.matrices);
  const coatingOpacity = () => page.evaluate(() => {
    const mesh = (globalThis as any).__testScene.getObjectByName("grass-surface-image");
    return mesh.material.userData.surfaceProjection.opacity.value as number;
  });
  const opacity = await coatingOpacity();
  await expect.poll(async () => Math.abs(await coatingOpacity() - opacity), { timeout: 12_000 }).toBeGreaterThan(.2);
  expect(await page.evaluate(() => (globalThis as any).__testScene.getObjectByName("grass-surface-image").material.opacity)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("grass-surface-play.png") });
  await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
  await page.reload();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(attached.textured);
  expect((await grassSurfaceState(page)).texture).toBe(saved.image);
  expect(errors).toEqual([]);
});

test("surface images follow slopes through terrain edits, undo, play and reload", async ({ page }, testInfo) => {
  const errors = await openScene(page);
  const before = await surfaceState(page);
  expect(before.count).toBeGreaterThan(0);
  expect(before.maxY - before.minY).toBeGreaterThan(.1);
  expect(before.position).toEqual([0, 0, 0]);
  expect(before.scale).toEqual([1, 1, 1]);
  expect(before.trees).toBe(true);
  expect(before.grass).toBe(true);
  expect(before.ribbons).toBeGreaterThan(0);
  await expect.poll(async () => (await surfaceState(page)).windTime).toBeGreaterThan(before.windTime);
  await page.screenshot({ path: testInfo.outputPath("abstract-editor.png") });
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="67"]').click({ position: { x: 2, y: 2 } });
  await expect.poll(async () => (await surfaceState(page)).maxY).toBeGreaterThan(before.maxY);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await surfaceState(page)).maxY).toBeCloseTo(before.maxY);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await expect.poll(async () => (await surfaceState(page)).count).toBe(before.count);
  expect((await surfaceState(page)).position).toEqual([0, 0, 0]);
  await page.screenshot({ path: testInfo.outputPath("abstract-play.png") });
  await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
  await page.reload();
  await page.locator(".live-preview canvas").waitFor();
  await expect.poll(async () => (await surfaceState(page)).count).toBe(before.count);
  expect(errors).toEqual([]);
});

test("white ground, textured trunks and stones retain their geometry and water reflects at low resolution", async ({ page }, testInfo) => {
  const errors = await openScene(page, true);
  const inspect = () => page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    const ground = scene.getObjectByName("continuous-ground");
    const trees: any[] = [], stones: any[] = [];
    scene.traverse((object: any) => {
      if (object.name === "generated-trunks") trees.push(object);
      if (["scattered-stones", "stones-surface-image"].includes(object.name)) stones.push(object);
    });
    const tree = trees.find(tree => tree.userData.cell === 51);
    const water = scene.getObjectByName("generated-water");
    return { treeCount: trees.length, treeVertices: tree.geometry.attributes.position.count,
      treeTexture: tree.material.map?.image?.src, projection: !!tree.material.userData.surfaceProjection,
      stones: stones.reduce((sum, mesh) => sum + mesh.count, 0), texturedStones: stones.filter(mesh => !!mesh.material.map).reduce((sum, mesh) => sum + mesh.count, 0),
      stoneShapes: [...new Set(stones.filter(mesh => mesh.count).map(mesh => mesh.geometry.userData.stoneShape))].sort(),
      stoneMaps: stones.filter(mesh => !!mesh.material.map).map(mesh => mesh.material.map.image?.src),
      undercoat: !!scene.getObjectByName("grass-understory"),
      groundMin: Math.min(...ground.geometry.attributes.color.array),
      reflection: water.material.uniforms.hasReflection.value,
      reflectionSize: water.material.uniforms.reflectionMap.value?.image.width,
      groundImages: scene.children.filter((child: any) => child.getObjectByName("surface-image")).length };
  });
  const before = await inspect();
  expect(before.undercoat).toBe(false);
  expect(before.groundMin).toBeCloseTo(1, 5);
  expect(before.stones).toBeGreaterThan(60);
  expect(before.stoneShapes).toEqual(["pebble", "weathered"]);
  expect(before.treeCount).toBeGreaterThan(0);
  await expect.poll(async () => (await inspect()).reflection).toBe(1);
  expect((await inspect()).reflectionSize).toBe(256);
  await openPlaced(page, "standing");
  await setPresentation(page, "placement", "surface");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await openPlaced(page, "stone-picture");
  await setPresentation(page, "placement", "surface");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await inspect()).texturedStones).toBeGreaterThan(0);
  await expect.poll(async () => (await inspect()).stoneMaps.every(src => !!src)).toBe(true);
  const applied = await inspect();
  expect(applied.treeTexture).toMatch(/^data:image/);
  expect(applied.projection).toBe(true);
  expect(applied.treeVertices).toBe(before.treeVertices);
  expect(applied.treeCount).toBe(before.treeCount);
  expect(applied.stones).toBe(before.stones);
  expect(applied.stoneShapes).toEqual(before.stoneShapes);
  expect(applied.stoneMaps).toContain(applied.treeTexture);
  expect(applied.groundImages).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("environment-surfaces.png") });
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await page.screenshot({ path: testInfo.outputPath("trunks-ground-play.png") });
  expect(errors).toEqual([]);
});

test("three placements without visibility controls remain usable on mobile with reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openScene(page);
  await openPlaced(page, "standing");
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".asset-presentation-controls button")).toHaveCount(1);
  await expect(dialog.locator("[data-placement]")).toBeVisible();
  await expect(dialog.getByRole("group", { name: "움직임", exact: true })).toHaveCount(0);
  await setPresentation(page, "placement", "surface");
  await page.screenshot({ path: testInfo.outputPath("surface-options-mobile.png") });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBeGreaterThan(0);
  expect((await grassSurfaceState(page)).strength).toBe(0);
  await openPlaced(page, "standing");
  await setPresentation(page, "placement", "upright");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("whistle.world.v2")!).assets[0].placement)).toBe("upright");
  await page.reload();
  await openPlaced(page, "standing");
  await expect(dialog.locator("[data-placement]")).toHaveAttribute("data-placement", "upright");
  expect(errors).toEqual([]);
});

test("opaque water hides changing ground and surface decals regardless of their color", async ({ page }) => {
  await page.goto(".");
  const result = await page.evaluate(async () => {
    const root = "/whistle/";
    const THREE = await import(root + "node_modules/three/build/three.module.js");
    const { makeWaterSurface } = await import(root + "components/whistle/WaterSurface.ts");
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
    const target = new THREE.WebGLRenderTarget(32, 32);
    renderer.setRenderTarget(target);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 10);
    camera.position.set(0, 3, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
    const geometry = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
    const water = makeWaterSurface(geometry, 0, { value: 0 });
    geometry.setAttribute("waterDepth", new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(.6), 1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.name = "whistle-sun"; sun.position.set(-1, 2, 1);
    const moon = new THREE.DirectionalLight(0xffffff, .22); moon.name = "whistle-moon"; moon.position.set(1, 2, -1);
    scene.background = water.material.uniforms.skyTint.value.clone().set("#ffffff");
    scene.add(sun, moon);
    const bedMaterial = new THREE.MeshBasicMaterial({ color: "red", transparent: true, depthWrite: false });
    const bed = new THREE.Mesh(geometry, bedMaterial);
    bed.position.y = -.3; bed.renderOrder = 1;
    scene.add(water, bed);
    const sample = (color: string, visible: boolean) => {
      bedMaterial.color.set(color); water.visible = visible;
      renderer.render(scene, camera);
      const pixels = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 16, 16, 1, 1, pixels);
      return Array.from(pixels);
    };
    const result = { night: [] as number[], wetRed: sample("red", true), wetBlue: sample("blue", true),
      dryRed: sample("red", false), dryBlue: sample("blue", false),
      depthWrite: water.material.depthWrite, transparent: water.material.transparent };
    sun.intensity = 0; scene.background.set("#11151c"); result.night = sample("red", true);
    geometry.dispose(); water.material.dispose(); bedMaterial.dispose(); target.dispose(); renderer.dispose();
    return result;
  });
  expect(result.wetRed).toEqual(result.wetBlue);
  expect(result.dryRed).not.toEqual(result.dryBlue);
  expect(result.wetRed[3]).toBe(255);
  expect(result.night.reduce((sum, v) => sum + v, 0)).toBeLessThan(result.wetRed.reduce((sum, v) => sum + v, 0));
  expect(result.depthWrite).toBe(true);
  expect(result.transparent).toBe(false);
});
