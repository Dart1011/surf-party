import { FINISH_DISTANCE, WORLD_EDGE, generateCourse } from './course.js';
import { sanitizeInput } from './protocol.js';

export const RACE_DURATION = 90;
const EMPTY_INPUT = sanitizeInput();
const round = value => Math.round(value * 10) / 10;

export class Race {
  constructor(players, seed) {
    this.seed = seed;
    this.course = generateCourse(seed);
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
      finished: false,
      finishTime: null,
      out: false,
      disconnected: false,
    }]));
    for (const id of this.players.keys()) this.inputs.set(id, { ...EMPTY_INPUT });
  }

  setInput(id, input) {
    if (!this.players.has(id)) return;
    const previous = this.inputs.get(id) || EMPTY_INPUT;
    const next = sanitizeInput(input);
    const player = this.players.get(id);
    if (next.boost && !previous.boost && player.boosts > 0 && !player.finished && !player.out && player.crashTime <= 0) {
      player.boosts -= 1;
      player.boostTime = 2.2;
      this.events.push({ type: 'boost', id });
    }
    this.inputs.set(id, next);
  }

  disconnect(id) {
    const player = this.players.get(id);
    if (!player || player.finished) return;
    player.disconnected = true;
    player.out = true;
    this.inputs.set(id, { ...EMPTY_INPUT });
  }

  update(dt) {
    if (this.ended) return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.time += dt;
    let completed = 0;

    for (const player of this.players.values()) {
      if (player.finished || player.out) {
        completed += 1;
        continue;
      }
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
        player.speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - player.speed));
        const steering = Number(input.right) - Number(input.left);
        player.vx += Math.max(-850 * dt, Math.min(850 * dt, steering * 285 - player.vx));
      }

      player.x += player.vx * dt;
      player.y += player.speed * dt;
      if (Math.abs(player.x) > WORLD_EDGE) {
        player.x = Math.sign(player.x) * WORLD_EDGE;
        player.vx *= -0.45;
      }

      if (player.crashTime <= 0) this.checkCollisions(player);
      if (player.y >= FINISH_DISTANCE && !player.out) {
        player.y = FINISH_DISTANCE;
        player.finished = true;
        player.finishTime = this.time;
        player.speed = 0;
        this.events.push({ type: 'finish', id: player.id });
        completed += 1;
      }
    }

    if (this.time >= RACE_DURATION) this.ended = true;
    if (completed === this.players.size) this.ended = true;
  }

  checkCollisions(player) {
    for (const obstacle of this.course) {
      const dy = obstacle.y - player.y;
      if (dy > 55) break;
      if (dy < -45 || this.collected.has(obstacle.id)) continue;
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
        player.out = true;
        player.speed = 0;
        this.events.push({ type: 'out', id: player.id });
      }
    }
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  standings() {
    return [...this.players.values()].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.out !== b.out) return a.out ? 1 : -1;
      return b.y - a.y || b.coins - a.coins;
    });
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
    };
  }
}
