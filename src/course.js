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

export class Course {
  constructor(seed) {
    this.random = randomGenerator(seed);
    this.obstacles = [];
    this.safeLane = 2;
    this.nextY = 500;
    this.row = 0;
    this.nextId = 0;
  }

  ensure(distance) {
    while (this.nextY < distance) this.addRow();
  }

  addRow() {
    const random = this.random;
    const lanes = [-480, -288, -96, 96, 288, 480];
    const row = [];
    const y = this.nextY;
    this.safeLane = Math.max(0, Math.min(lanes.length - 1, this.safeLane + Math.floor(random() * 3) - 1));
    for (let lane = 0; lane < lanes.length; lane += 1) {
      if (lane === this.safeLane || random() > 0.57) continue;
      const dock = random() < 0.22;
      row.push({
        id: this.nextId++,
        type: dock ? 'dock' : 'rock',
        x: lanes[lane] + (random() - 0.5) * 48,
        y: y + (random() - 0.5) * 50,
        pose: dock ? Math.floor(random() * 8) : 10 + Math.floor(random() * 8),
      });
    }

    if (this.row % 3 === 1) {
      const roll = random();
      const type = roll < 0.52 ? 'coin' : roll < 0.78 ? 'boost' : roll < 0.9 ? 'ramp' : 'heart';
      row.push({ id: this.nextId++, type, x: lanes[this.safeLane], y: y + 50, pose: 0 });
    }
    row.sort((a, b) => a.y - b.y);
    this.obstacles.push(...row);
    this.nextY += 165;
    this.row += 1;
  }

  nearby(y, behind = 45, ahead = 55) {
    let low = 0;
    let high = this.obstacles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.obstacles[middle].y < y - behind) low = middle + 1;
      else high = middle;
    }
    const nearby = [];
    for (let index = low; index < this.obstacles.length && this.obstacles[index].y <= y + ahead; index += 1) {
      nearby.push(this.obstacles[index]);
    }
    return nearby;
  }
}

export function generateCourse(seed, distance = 6000) {
  const course = new Course(seed);
  course.ensure(distance);
  return course.obstacles;
}
