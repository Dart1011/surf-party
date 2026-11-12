# Surf Party

The original Microsoft Edge S.U.R.F. game with browser-based multiplayer rooms. One player hosts, friends open an invite link, and up to eight players can surf together and compare live distances.

## Play

Play at **https://dart1011.github.io/surf-party/**.

Create a room, copy the invite link, and send it to your friends. Friends enter a display name and join; the host starts a synchronized run. Players who join during a run can watch the live distances and automatically join the next round.

The multiplayer page runs the original Classic game engine, obstacle generation, physics, camera, artwork, menus, and kraken. It does not use a replacement course, renderer, or movement simulation. Each player controls their own original game; the room synchronizes starts and rematches and relays the distance and lives shown by the original HUD.

The multiplayer engine has one intentional difficulty adjustment: the original game clock increases smoothly by 20% per minute, making the complete game faster while preserving the original movement and enemy behavior. Run time resets for each rematch and does not advance while paused. The separate single-player Classic retains the original constant speed.

Use the original controls:

- Arrow keys or WASD to surf.
- F or double-click to use a speed boost.
- Original touch controls on mobile.
- Tab or the Crew button to show the live multiplayer roster without stopping the game.
- Gamer tags and distinct crew colors appear above surfers; matching directional arrows and distance labels point toward off-screen crew members.

The host must keep their tab open. Closing it ends the room. Lightweight room messages use secure MQTT-over-WebSocket connections through public EMQX and HiveMQ brokers instead of direct peer-to-peer connections, so players on different networks do not need WebRTC or TURN. No account or self-hosted server is required. The room code identifies a public, non-retained relay topic; use a non-sensitive display name and do not put private information in room messages.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To test multiple players, use separate browser profiles or devices.

## Production

```sh
npm run build
npm run preview
```

The production output is in `dist/`. The app is static and can be hosted on GitHub Pages or another static web host. A workflow in `.github/workflows/deploy.yml` deploys it to GitHub Pages after pushes to `main`.

## Classic mode and credits

The untouched single-player version is also available at `classic/index.html` on the deployed site. Its files and original copyright notices are in `public/classic/`.

The original S.U.R.F. game and its artwork are by Microsoft. The game files come from [rbeesley/MicrosoftEdge-SURF](https://github.com/rbeesley/MicrosoftEdge-SURF), which adapted the game to run outside Edge. The multiplayer room and roster code loads that original engine without changing its gameplay code.
