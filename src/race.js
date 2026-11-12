import { Course, WORLD_EDGE } from './course.js';
import { sanitizeInput } from './protocol.js';

const EMPTY_INPUT = sanitizeInput();
const round = value => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class Race {
  constructor(players, seed) {
    this.seed = seed;
    this.course = new Course(seed);
    this.course.ensure(1600);
    this.time = 0;
    this.ended = false;
    this.collected = new Set();
    this.events = [];
    this.inputs = new Map();
    this.players = new Map(players.map((player, index) => [player.id, {
      id: player.id,
      name: player.name,
      character: player.character,
      x: (index - (players.length - 1) / 2) * 72,
      y: 0,
      vx: 0,
      speed: 0,
      lives: 3,
      boosts: 1,
      coins: 0,
      boostTime: 0,
      crashTime: 0,
      immuneTime: 0,
      airTime: 0,
      out: false,
      grabbedByEnemy: false,
      disconnected: false,
    }]));
    this.enemies = new Map([...this.players.values()].map(player => [player.id, {
      targetId: player.id,
      x: player.x,
      y: player.y - 360,
      speed: 0,
      active: false,
      grabbed: false,
      stunTime: 0,
      hitObstacles: new Set(),
    }]));
    for (const id of this.players.keys()) this.inputs.set(id, { ...EMPTY_INPUT });
  }

  setInput(id, input) {
    if (!this.players.has(id)) return;
    const previous = this.inputs.get(id) || EMPTY_INPUT;
    const next = sanitizeInput(input);
    const player = this.players.get(id);
    if (next.boost && !previous.boost && player.boosts > 0 && !player.out && player.crashTime <= 0) {
      player.boosts -= 1;
      player.boostTime = 2.2;
      this.events.push({ type: 'boost', id });
    }
    this.inputs.set(id, next);
  }

  disconnect(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.disconnected = true;
    player.out = true;
    const enemy = this.enemies.get(id);
    if (enemy) enemy.active = false;
    this.inputs.set(id, { ...EMPTY_INPUT });
  }

  update(dt) {
    if (this.ended) return;
    dt = clamp(dt, 0, 0.05);
    this.time += dt;
    const farthest = Math.max(0, ...[...this.players.values()].map(player => player.y));
    this.course.ensure(farthest + 1400);

    for (const player of this.players.values()) {
      if (player.out) continue;
      const input = this.inputs.get(player.id) || EMPTY_INPUT;
      player.immuneTime = Math.max(0, player.immuneTime - dt);
      player.boostTime = Math.max(0, player.boostTime - dt);
      player.airTime = Math.max(0, player.airTime - dt);

      if (player.crashTime > 0) {
        player.crashTime = Math.max(0, player.crashTime - dt);
        player.speed = Math.max(0, player.speed - 300 * dt);
        player.vx *= Math.max(0, 1 - 8 * dt);
        player.immuneTime = Math.max(player.immuneTime, 1.2);
      } else {
        const targetSpeed = Math.max(85, 180 + Math.min(35, this.time * 0.5) + (input.up ? 30 : 0) - (input.down ? 65 : 0) + (player.boostTime > 0 ? 135 : 0));
        const acceleration = targetSpeed > player.speed ? 105 : 260;
        player.speed += clamp(targetSpeed - player.speed, -acceleration * dt, acceleration * dt);
        const steering = Number(input.right) - Number(input.left);
        player.vx += clamp(steering * 285 - player.vx, -850 * dt, 850 * dt);
      }

      player.x += player.vx * dt;
      player.y += player.speed * dt;
      if (Math.abs(player.x) > WORLD_EDGE) {
        player.x = Math.sign(player.x) * WORLD_EDGE;
        player.vx *= -0.45;
      }

      if (player.crashTime <= 0) this.checkCollisions(player);
    }

    this.updateEnemies(dt);
    if ([...this.players.values()].every(player => player.out)) this.ended = true;
  }

  checkCollisions(player) {
    for (const obstacle of this.course.nearby(player.y)) {
      if (this.collected.has(obstacle.id)) continue;
      const dy = obstacle.y - player.y;
      const collectible = ['boost', 'heart', 'coin', 'ramp'].includes(obstacle.type);
      const radius = obstacle.type === 'dock' ? 47 : collectible ? 34 : 35;
      if (Math.abs(obstacle.x - player.x) > radius || Math.abs(dy) > 34) continue;

      if (collectible) {
        this.collected.add(obstacle.id);
        if (obstacle.type === 'boost') player.boosts = Math.min(3, player.boosts + 1);
        if (obstacle.type === 'heart') player.lives = Math.min(3, player.lives + 1);
        if (obstacle.type === 'coin') player.coins += 1;
        if (obstacle.type === 'ramp') {
          player.airTime = 1.15;
          player.boostTime = Math.max(player.boostTime, 0.8);
        }
        this.events.push({ type: obstacle.type, id: player.id, obstacle: obstacle.id });
        continue;
      }

      if (player.immuneTime > 0 || player.airTime > 0) continue;
      player.lives -= 1;
      player.crashTime = 0.9;
      player.immuneTime = 2.5;
      player.speed = 40;
      player.boostTime = 0;
      this.events.push({ type: 'crash', id: player.id });
      if (player.lives <= 0) {
        player.lives = 0;
        player.out = true;
        player.speed = 0;
        this.events.push({ type: 'out', id: player.id });
        break;
      }
    }
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies.values()) {
      const player = this.players.get(enemy.targetId);
      if (!player || player.disconnected) {
        enemy.active = false;
        continue;
      }
      if (player.out) {
        if (!enemy.grabbed) enemy.active = false;
        continue;
      }
      if (!enemy.active) {
        if (player.y < 750) continue;
        enemy.active = true;
        enemy.x = player.x;
        enemy.y = player.y - 360;
        this.events.push({ type: 'kraken-warning', id: player.id });
      }
      if (enemy.stunTime > 0) {
        enemy.stunTime = Math.max(0, enemy.stunTime - dt);
        continue;
      }

      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      const catchup = clamp((dy - 400) * 0.18, 0, 70);
      enemy.speed = Math.min(360, 168 + this.time * 1.65) + catchup;
      if (distance > 0) {
        enemy.x += dx / distance * enemy.speed * dt;
        enemy.y += dy / distance * enemy.speed * dt;
      }

      const hit = this.course.nearby(enemy.y, 40, 40).find(obstacle =>
        !enemy.hitObstacles.has(obstacle.id) &&
        ['rock', 'dock', 'ramp'].includes(obstacle.type) &&
        Math.abs(obstacle.x - enemy.x) < 48 &&
        Math.abs(obstacle.y - enemy.y) < 38
      );
      if (hit) {
        enemy.hitObstacles.add(hit.id);
        enemy.stunTime = 1.2;
        this.events.push({ type: 'kraken-crash', id: player.id });
        continue;
      }

      if (Math.abs(player.x - enemy.x) < 44 && Math.abs(player.y - enemy.y) < 48) {
        player.lives = 0;
        player.out = true;
        player.grabbedByEnemy = true;
        player.speed = 0;
        enemy.grabbed = true;
        this.events.push({ type: 'kraken', id: player.id });
      }
    }
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  standings() {
    return [...this.players.values()].sort((a, b) => b.y - a.y || b.coins - a.coins);
  }

  snapshot() {
    return {
      time: round(this.time),
      ended: this.ended,
      collected: [...this.collected],
      players: [...this.players.values()].map(player => ({
        ...player,
        x: round(player.x),
        y: round(player.y),
        vx: round(player.vx),
        speed: round(player.speed),
        boostTime: round(player.boostTime),
        crashTime: round(player.crashTime),
        immuneTime: round(player.immuneTime),
        airTime: round(player.airTime),
      })),
      enemies: [...this.enemies.values()].map(enemy => ({
        targetId: enemy.targetId,
        x: round(enemy.x),
        y: round(enemy.y),
        speed: round(enemy.speed),
        active: enemy.active,
        grabbed: enemy.grabbed,
        stunTime: round(enemy.stunTime),
      })),
    };
  }
}
