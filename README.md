# Racing game

A 3D racing game on Homeroom. The car drives at a fixed, constant speed;
you steer by dragging left and right anywhere on the screen (arrow keys on
a desktop). Dodge oncoming traffic, stay between the barriers, and see how
far you get.

## How it works

- `public/game.js` runs the whole game as an ES module on
  [Three.js](https://threejs.org), an npm dependency served by the app
  server at `/vendor/three.module.js` (mapped to bare `three` via an
  importmap in `public/index.html`).
- Steering is a horizontal drag: distance dragged maps to steering angle,
  the body yaws and leans with it, and releasing springs the wheel back
  to center. The car is clamped between the roadside barriers.
- Traffic cars spawn ahead in a random lane (never all three at once) and
  drive the same way at a slower speed, so they drift toward you. Traffic
  thickens the further you drive; speed never changes.
- Hitting a car ends the run: the game-over screen shows your distance,
  your best, and the top runs.

## Scores

Finished runs POST to `/api/scores`, which stores them in the `scores`
table and answers with your personal best and the top five runs (best
distance per username). Staging previews seed three obviously fake demo
drivers so the leaderboard is never empty there.
