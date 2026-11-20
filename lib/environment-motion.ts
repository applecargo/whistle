export type EnvironmentalFlight = {
  mode: "bounce" | "glide" | "float";
  y: number; vy: number; vx: number; vz: number; origin: number; elapsed: number;
};
export function environmentalFlight(mode: EnvironmentalFlight["mode"], y: number, vx = 0, vz = 0, vy = 0): EnvironmentalFlight {
  return { mode, y, origin: y, vy: mode === "bounce" ? (vy > 0 ? vy : 5.6) : vy, vx, vz, elapsed: 0 };
}
export function stepEnvironmentalFlight(
  flight: EnvironmentalFlight, dt: number, floor: number | null,
  conditions: { lift: number; liftCeiling: number; glideHeld: boolean; crouching: boolean },
) {
  const next = { ...flight, elapsed: flight.elapsed + dt };
  const lifting = floor === null && conditions.lift > .12 && !conditions.crouching;
  if (lifting) {
    next.mode = "float";
    const target = conditions.liftCeiling;
    const velocity = Math.max(-1.2, Math.min(1.5, (target - next.y) * 2.8));
    next.vy += (velocity - next.vy) * (1 - Math.exp(-5 * dt));
    next.elapsed = 0;
  } else {
    next.vy -= 10 * dt;
    if (next.mode === "glide" && conditions.glideHeld && !conditions.crouching)
      next.vy = Math.max(-.7, next.vy);
  }
  next.y += next.vy * dt;
  const landed = floor !== null && next.vy <= 0 && next.y <= floor;
  if (landed) next.y = floor!;
  const missed = !lifting && floor === null && (next.y < next.origin - 4 || next.elapsed > 6);
  const yawDelta = lifting ? dt * Math.PI * 2 / 90 : 0;
  return { flight: next, landed, missed, yawDelta };
}

export function environmentalDrift(
  conditions: { windX: number; windZ: number; flowX: number; flowZ: number },
  seconds: number, airborne: boolean, crouching: boolean,
) {
  const gust = Math.max(0, Math.sin(seconds * .63)) ** 6;
  const wind = (airborne ? .55 : .25) * (1 + gust * 1.5) * (crouching ? .2 : 1);
  return {
    x: conditions.windX * wind + (airborne ? 0 : conditions.flowX),
    z: conditions.windZ * wind + (airborne ? 0 : conditions.flowZ),
  };
}
