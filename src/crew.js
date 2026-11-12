const COLORS = ['#ffdf58', '#ff7b72', '#7c83ff', '#46dfb0', '#ff9f43', '#f472d0', '#75e6ff', '#c4f26b'];

function colorFor(id, players) {
  const index = players.findIndex(player => player.id === id);
  return COLORS[(index < 0 ? 0 : index) % COLORS.length];
}

export class CrewOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.ghosts = new Map();
    this.lastTime = 0;
  }

  start(getScene) {
    const frame = time => {
      this.draw(time);
      this.getScene = getScene;
      requestAnimationFrame(frame);
    };
    this.getScene = getScene;
    requestAnimationFrame(frame);
  }

  syncCanvas() {
    const gameCanvas = document.getElementById('game-canvas');
    if (this.canvas.width !== gameCanvas.width || this.canvas.height !== gameCanvas.height) {
      this.canvas.width = gameCanvas.width;
      this.canvas.height = gameCanvas.height;
      this.canvas.style.width = gameCanvas.style.width;
      this.canvas.style.height = gameCanvas.style.height;
      this.context.imageSmoothingEnabled = false;
    }
  }

  draw(time) {
    this.syncCanvas();
    const context = this.context;
    const scene = this.getScene();
    const game = window.__surfPartyState?.();
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.dataset.crewCount = '0';
    this.canvas.dataset.arrowCount = '0';
    if (!scene.visible || !game || game.sessionState === 'MENU') return;

    const local = scene.players.find(player => player.id === scene.localId);
    if (!local) return;
    const dt = Math.min(0.1, (time - this.lastTime) / 1000 || 0.016);
    this.lastTime = time;
    const blend = 1 - Math.exp(-dt * 14);
    const activeIds = new Set();
    let arrows = 0;
    let crew = 1;

    for (const player of scene.players) {
      if (player.id === scene.localId || !player.stats || player.stats.sessionState === 'MENU') continue;
      activeIds.add(player.id);
      const target = {
        x: game.screenX + player.stats.worldX - game.worldX,
        y: game.screenY + player.stats.worldY - game.worldY,
      };
      if (!this.ghosts.has(player.id)) this.ghosts.set(player.id, target);
      const ghost = this.ghosts.get(player.id);
      ghost.x += (target.x - ghost.x) * blend;
      ghost.y += (target.y - ghost.y) * blend;
      const color = colorFor(player.id, scene.players);
      const onScreen = ghost.x > 42 && ghost.x < this.canvas.width - 42 && ghost.y > 76 && ghost.y < this.canvas.height - 42;
      if (onScreen) {
        const closeToLocal = Math.hypot(ghost.x - game.screenX, ghost.y - game.screenY) < 70;
        const tagLift = closeToLocal ? 24 * (crew - 1) : 0;
        this.drawSurfer(player, ghost.x, ghost.y, time, color);
        this.drawTag(player.name, ghost.x, ghost.y - 47 - tagLift, color);
      } else {
        arrows += 1;
        this.drawArrow(player, ghost, game, color);
      }
      crew += 1;
    }
    for (const id of this.ghosts.keys()) if (!activeIds.has(id)) this.ghosts.delete(id);

    this.drawTag(local.name, game.screenX, game.screenY - 47, colorFor(local.id, scene.players), '', true);
    this.canvas.dataset.crewCount = String(crew);
    this.canvas.dataset.arrowCount = String(arrows);
  }

  drawSurfer(player, x, y, time, color) {
    const context = this.context;
    const playerImage = document.getElementById('player64');
    const boardImage = document.getElementById('surfboard64');
    const pose = Math.max(0, Math.min(12, player.stats.pose - 1));
    const character = Math.max(0, Math.min(6, player.stats.character - 1));
    const frame = Math.floor(time / 125) % 3;
    context.save();
    context.globalAlpha = player.stats.over ? 0.45 : 0.82;
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(x, y + 23, 28, 9, 0, 0, Math.PI * 2);
    context.stroke();
    context.drawImage(boardImage, pose * 64, frame * 64, 64, 64, Math.round(x - 32), Math.round(y - 32), 64, 64);
    context.drawImage(playerImage, pose * 64, character * 64, 64, 64, Math.round(x - 32), Math.round(y - 32), 64, 64);
    context.restore();
  }

  drawArrow(player, ghost, game, color) {
    const dx = ghost.x - game.screenX;
    const dy = ghost.y - game.screenY;
    const angle = Math.atan2(dy, dx);
    const marginX = 48;
    const marginTop = 82;
    const marginBottom = 48;
    const xScale = dx > 0 ? (this.canvas.width - marginX - game.screenX) / dx : dx < 0 ? (marginX - game.screenX) / dx : Infinity;
    const yScale = dy > 0 ? (this.canvas.height - marginBottom - game.screenY) / dy : dy < 0 ? (marginTop - game.screenY) / dy : Infinity;
    const scale = Math.max(0, Math.min(xScale, yScale));
    const x = game.screenX + dx * scale;
    const y = game.screenY + dy * scale;
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = color;
    context.strokeStyle = 'rgba(0, 39, 52, .65)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(22, 0);
    context.lineTo(-12, -13);
    context.lineTo(-5, 0);
    context.lineTo(-12, 13);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
    const distance = Math.max(1, Math.round(Math.hypot(dx, dy) / 10));
    this.drawTag(player.name, x, y + 31, color, `${distance} m`);
  }

  drawTag(name, x, y, color, subtitle = '', local = false) {
    const context = this.context;
    context.save();
    context.font = '700 11px system-ui, sans-serif';
    const width = Math.min(150, Math.ceil(context.measureText(name).width) + 16);
    const height = subtitle ? 34 : 21;
    const left = Math.max(4, Math.min(this.canvas.width - width - 4, x - width / 2));
    const top = Math.max(4, Math.min(this.canvas.height - height - 4, y - height / 2));
    context.fillStyle = color;
    context.strokeStyle = local ? '#ffffff' : 'rgba(0, 39, 52, .55)';
    context.lineWidth = local ? 2 : 1;
    context.beginPath();
    context.roundRect(left, top, width, height, 5);
    context.fill();
    context.stroke();
    context.fillStyle = '#092f42';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const textX = left + width / 2;
    if (subtitle) {
      context.fillText(name, textX, top + 10, width - 10);
      context.font = '700 9px system-ui, sans-serif';
      context.fillText(subtitle, textX, top + 25, width - 10);
    } else {
      context.fillText(name, textX, top + height / 2 + 0.5, width - 10);
    }
    context.restore();
  }
}
