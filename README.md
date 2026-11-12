# Surf Party

A browser-based multiplayer endless surfing game built around the style and sprites of Microsoft Edge S.U.R.F. One player hosts, friends open an invite link, and up to eight players surf together.

## Play

Play at **https://dart1011.github.io/surf-party/**.

Create a room, copy the invite link, and send it to your friends. Friends enter a display name and join; the host starts the run. Players who join during a run spectate and automatically join the next round.

- Steer with the arrow keys or A/D.
- Adjust speed with Up/Down or W/S.
- Use Space or F for a boost. Double-click also boosts.
- Touch controls are included on mobile.
- You have three lives. Rocks and docks cost one life; hearts restore up to three.
- A kraken begins chasing each surfer after 75 meters. It can crash into obstacles, but if it catches you, your run ends immediately.
- There is no finish line or time limit. The course continues generating until every surfer wipes out; distance determines the standings.

The host must keep their tab open. Closing it ends the room. Gameplay uses encrypted browser-to-browser WebRTC connections; PeerJS's public cloud service is used only for connection signaling. The host runs the authoritative endless simulation and sends live snapshots to the other players. No account or game server is required, but restrictive networks that block WebRTC can prevent a connection.

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

The original single-player version is preserved at `classic/` on the deployed site. Its files and original copyright notices are in `public/classic/`.

The original S.U.R.F. game and its artwork are by Microsoft. The preserved Classic files come from [rbeesley/MicrosoftEdge-SURF](https://github.com/rbeesley/MicrosoftEdge-SURF), which adapted the game to run outside Edge. Surf Party's multiplayer interface, room system, race simulation, and renderer are separate from the original game bundle.
