import { FINISH_DISTANCE } from './course.js';
import { generateCourse, seedFromString } from './course.js';
import { playerColor } from './protocol.js';

const ASSET_ROOT = `${import.meta.env.BASE_URL}classic/`;
const FILES = ['player64', 'surfboard64', 'objects64', 'docks64', 'interact64', 'ripple96', 'water256', 'island1280'];
const images = {};

export async function loadAssets() {
  await Promise.all(FILES.map(name => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      images[name] = image;
      resolve();
    };
    image.onerror = reject;
    image.src = `${ASSET_ROOT}${name}.png`;
  })));
}

export function drawCharacterPreview(canvas, character, pose = 3) {
  if (!images.player64 || !images.surfboard64) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(images.surfboard64, pose * 64, 0, 64, 64, 0, 0, 64, 64);
  context.drawImage(images.player64, pose * 64, character * 64, 64, 64, 0, 0, 64, 64);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.snapshot = null;
    this.course = [];
    this.collected = new Set();
    this.displayed = new Map();
    this.localId = null;
    this.demoCourse = generateCourse(seedFromString('SURF PARTY'));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.context.imageSmoothingEnabled = false;
  }

  resetRace(seed, localId) {
    this.course = generateCourse(seed);
    this.localId = localId;
    this.snapshot = null;
    this.displayed.clear();
    this.collected.clear();
  }

  setSnapshot(snapshot) {
    this.snapshot = snapshot;
    this.collected = new Set(snapshot.collected);
    for (const player of snapshot.players) {
      if (!this.displayed.has(player.id) || Math.abs(this.displayed.get(player.id).y - player.y) > 700) {
        this.displayed.set(player.id, { ...player });
      }
    }
    const ids = new Set(snapshot.players.map(player => player.id));
    for (const id of this.displayed.keys()) if (!ids.has(id)) this.displayed.delete(id);
  }

  drawIdle(time, players = []) {
    this.drawWater(time * 45, time * 12);
    const surfers = players.length ? players : [{ id: 'demo', name: '', character: 0 }];
    surfers.slice(0, 8).forEach((player, index) => {
      const x = this.width * (index + 1) / (Math.min(surfers.length, 8) + 1);
      const y = this.height * 0.79 + Math.sin(time * 2 + index) * 7;
      this.drawPlayer({ ...player, x, y, screenSpace: true, vx: 0, speed: 0, crashTime: 0, immuneTime: 0, airTime: 0, boostTime: 0 }, time, player.id === this.localId, false);
    });
    this.drawDemoObstacles(time);
  }

  drawDemoObstacles(time) {
    const spacing = 240;
    const offset = time * 45 % spacing;
    for (let index = -1; index < this.height / spacing + 2; index += 1) {
      const obstacle = this.demoCourse[(index + 30) % this.demoCourse.length];
      const y = index * spacing + offset;
      const x = (index * 283 % this.width + this.width) % this.width;
      this.drawObstacle({ ...obstacle, x, y, screenSpace: true }, time);
    }
  }

  drawRace(dt, time) {
    if (!this.snapshot) {
      this.drawWater(time * 40, 0);
      return;
    }
    const blend = 1 - Math.exp(-Math.min(dt, 0.05) * 18);
    for (const target of this.snapshot.players) {
      const player = this.displayed.get(target.id);
      player.x += (target.x - player.x) * blend;
      player.y += (target.y - player.y) * blend;
      player.vx += (target.vx - player.vx) * blend;
      for (const key of ['speed', 'lives', 'boosts', 'coins', 'boostTime', 'crashTime', 'immuneTime', 'airTime', 'finished', 'finishTime', 'out', 'disconnected', 'name', 'character']) {
        player[key] = target[key];
      }
    }
    const local = this.displayed.get(this.localId) || [...this.displayed.values()].sort((a, b) => b.y - a.y)[0];
    if (!local) return;
    this.drawWater(local.y, local.x);
    const originY = this.height * 0.4;
    const toScreen = (x, y) => ({ x: x - local.x + this.width / 2, y: originY + y - local.y });

    for (const obstacle of this.course) {
      if (this.collected.has(obstacle.id)) continue;
      const point = toScreen(obstacle.x, obstacle.y);
      if (point.y < -100 || point.y > this.height + 110 || point.x < -100 || point.x > this.width + 100) continue;
      this.drawObstacle({ ...obstacle, ...point, screenSpace: true }, time);
    }

    this.drawFinish(toScreen(0, FINISH_DISTANCE), time);
    const players = [...this.displayed.values()].sort((a, b) => a.y - b.y);
    for (const player of players) {
      const point = toScreen(player.x, player.y);
      if (point.y < -100 || point.y > this.height + 100) continue;
      this.drawPlayer({ ...player, ...point, screenSpace: true }, time, player.id === this.localId, true);
    }
  }

  drawWater(y, x) {
    const context = this.context;
    context.fillStyle = '#35c4df';
    context.fillRect(0, 0, this.width, this.height);
    if (!images.water256) return;
    const pattern = context.createPattern(images.water256, 'repeat');
    context.save();
    context.translate(-((x % 256) + 256) % 256, ((y % 256) + 256) % 256);
    context.fillStyle = pattern;
    context.fillRect(0, -256, this.width + 256, this.height + 512);
    context.restore();
  }

  drawObstacle(obstacle, time) {
    const context = this.context;
    const { x, y } = obstacle;
    if (obstacle.type === 'rock' || obstacle.type === 'dock') this.drawRipple(x, y + 13, time);
    if (obstacle.type === 'rock') {
      context.drawImage(images.objects64, obstacle.pose * 64, 0, 64, 64, Math.round(x - 32), Math.round(y - 32), 64, 64);
      return;
    }
    if (obstacle.type === 'dock') {
      context.drawImage(images.docks64, obstacle.pose * 64, 0, 64, 64, Math.round(x - 32), Math.round(y - 32), 64, 64);
      return;
    }
    const poses = { ramp: 0, boost: 2, heart: 3, coin: 4 };
    const pose = poses[obstacle.type] ?? 0;
    const frame = Math.floor(time * 7) % 4;
    const bob = obstacle.type === 'ramp' ? 0 : Math.sin(time * 5 + obstacle.id) * 3;
    if (obstacle.type !== 'ramp') {
      context.save();
      context.globalAlpha = 0.25;
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(x, y + 8, 22 + Math.sin(time * 4) * 3, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.drawImage(images.interact64, pose * 64, frame * 64, 64, 64, Math.round(x - 32), Math.round(y - 32 + bob), 64, 64);
  }

  drawRipple(x, y, time) {
    const frame = Math.floor(time * 6) % 3;
    this.context.globalAlpha = 0.65;
    this.context.drawImage(images.ripple96, 0, frame * 32, 96, 32, Math.round(x - 48), Math.round(y - 16), 96, 32);
    this.context.globalAlpha = 1;
  }

  drawPlayer(player, time, local, showName) {
    const context = this.context;
    const { x, y } = player;
    const color = playerColor(player.id);
    const airHeight = player.airTime > 0 ? Math.sin(Math.min(1, player.airTime) * Math.PI) * 34 : 0;
    let pose = 3;
    if (player.crashTime > 0 || player.out) pose = 6;
    else if (player.airTime > 0) pose = 9 + Math.floor(time * 7) % 4;
    else if (player.vx < -100) pose = 1;
    else if (player.vx < -25) pose = 2;
    else if (player.vx > 100) pose = 5;
    else if (player.vx > 25) pose = 4;

    context.save();
    if (player.immuneTime > 0 && Math.floor(time * 12) % 2 === 0) context.globalAlpha = 0.4;
    if (player.boostTime > 0) {
      context.strokeStyle = 'rgba(255,255,255,.8)';
      context.lineWidth = 3;
      for (const offset of [-13, 0, 13]) {
        context.beginPath();
        context.moveTo(x + offset, y - 28);
        context.lineTo(x + offset * 1.3, y - 58 - Math.sin(time * 20 + offset) * 8);
        context.stroke();
      }
    }
    if (local) {
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.ellipse(x, y + 24, 29, 10, 0, 0, Math.PI * 2);
      context.stroke();
    }
    if (airHeight > 0) {
      context.fillStyle = 'rgba(0,60,80,.25)';
      context.beginPath();
      context.ellipse(x, y + 18, 22, 8, 0, 0, Math.PI * 2);
      context.fill();
    }
    const frame = Math.floor(time * 8) % 3;
    const drawY = Math.round(y - 32 - airHeight);
    const drawX = Math.round(x - 32);
    context.drawImage(images.surfboard64, pose * 64, frame * 64, 64, 64, drawX, drawY, 64, 64);
    context.drawImage(images.player64, pose * 64, player.character * 64, 64, 64, drawX, drawY, 64, 64);
    context.restore();

    if (showName && player.name) {
      const label = local ? `YOU · ${player.name}` : player.name;
      context.font = '600 12px system-ui, sans-serif';
      const width = Math.ceil(context.measureText(label).width) + 18;
      const labelY = y - 52 - airHeight;
      context.fillStyle = local ? color : 'rgba(3,43,61,.82)';
      context.beginPath();
      context.roundRect(x - width / 2, labelY - 15, width, 23, 8);
      context.fill();
      context.fillStyle = local ? '#092f42' : '#ffffff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, x, labelY - 3);
    }
  }

  drawFinish(point, time) {
    if (point.y < -1200 || point.y > this.height + 1200) return;
    const context = this.context;
    const left = point.x - 570;
    context.save();
    context.strokeStyle = 'rgba(255,255,255,.8)';
    context.lineWidth = 4;
    context.setLineDash([18, 14]);
    context.beginPath();
    context.moveTo(left, point.y);
    context.lineTo(left + 1140, point.y);
    context.stroke();
    context.setLineDash([]);
    for (const x of [left, left + 1140]) {
      context.drawImage(images.objects64, 22 * 64, 0, 64, 64, x - 32, point.y - 32, 64, 64);
    }
    const islandWidth = 1100;
    const islandHeight = images.island1280.height / images.island1280.width * islandWidth;
    context.drawImage(images.island1280, point.x - islandWidth / 2, point.y + 70, islandWidth, islandHeight);
    context.font = '800 16px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.fillText('FINISH', point.x, point.y - 42 + Math.sin(time * 3) * 2);
    context.restore();
  }
}
