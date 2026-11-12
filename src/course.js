export const FINISH_DISTANCE = 6000;
export const WORLD_EDGE = 550;

export function seedFromString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function generateCourse(seed) {
  const random = randomGenerator(seed);
  const lanes = [-480, -288, -96, 96, 288, 480];
  const obstacles = [];
  let safeLane = 2;
  let id = 0;

  for (let y = 500, row = 0; y < FINISH_DISTANCE - 250; y += 165, row += 1) {
    safeLane = Math.max(0, Math.min(lanes.length - 1, safeLane + Math.floor(random() * 3) - 1));
    for (let lane = 0; lane < lanes.length; lane += 1) {
      if (lane === safeLane || random() > 0.57) continue;
      const dock = random() < 0.22;
      obstacles.push({
        id: id++,
        type: dock ? 'dock' : 'rock',
        x: lanes[lane] + (random() - 0.5) * 48,
        y: y + (random() - 0.5) * 50,
        pose: dock ? Math.floor(random() * 8) : 10 + Math.floor(random() * 8),
      });
    }

    if (row % 3 === 1) {
      const roll = random();
      const type = roll < 0.52 ? 'coin' : roll < 0.78 ? 'boost' : roll < 0.9 ? 'ramp' : 'heart';
      obstacles.push({ id: id++, type, x: lanes[safeLane], y: y + 50, pose: 0 });
    }
  }

  return obstacles.sort((a, b) => a.y - b.y);
}
