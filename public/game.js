// Racing game — a 3D driver with a thumb pad.
//
// The pad at the bottom-right of the screen is the touchscreen control:
// drag it left and right to steer, up to speed up and down to slow down.
// Releasing holds the speed you set and lets the wheel spring back to
// center. Arrow keys do the same on a desktop keyboard, with up/down
// nudging the speed. The whole game is keeping it between the barriers
// while traffic comes the other way.

import * as THREE from 'three';

// ---------- DOM ----------
const canvas = document.getElementById('game');
const hudEl = document.getElementById('hud');
const distanceEl = document.getElementById('distance');
const speedEl = document.getElementById('speed');
const padEl = document.getElementById('pad');
const padThumb = document.getElementById('pad-thumb');
const startEl = document.getElementById('start');
const startMsg = document.getElementById('start-msg');
const startBtn = document.getElementById('start-btn');
const overEl = document.getElementById('over');
const overDistanceEl = document.getElementById('over-distance');
const overBestEl = document.getElementById('over-best');
const boardEl = document.getElementById('board');
const signinHint = document.getElementById('signin-hint');
const restartBtn = document.getElementById('restart-btn');

// ---------- Tuning (meters, seconds) ----------
const SPEED_MIN = 10;          // slowest the car will go
const SPEED_MAX = 38;          // fastest the car will go
const CRUISE_SPEED = (SPEED_MIN + SPEED_MAX) / 2; // 24 m/s, the starting speed
const KEY_SPEED_RATE = 16;     // keyboard up/down speed change, m/s per second
const STEER_RATE = 11;         // lateral speed at full lock
const ROAD_HALF = 4.5;         // road runs from -4.5 to +4.5
const EDGE = ROAD_HALF - 0.85; // furthest the car's center may go
const LANES = [-3, 0, 3];      // traffic lane centers
const SPAWN_Z = -140;          // traffic appears at the fog line
const DESPAWN_Z = 18;          // traffic vanishes behind the camera
const SCROLL_SPAN = 285;       // recycled roadside props cover this span
const TRAFFIC_POOL = 10;

// Traffic keeps driving forward but slower than the player, so the closing
// speed stays readable. Three paint jobs, all muted, player keeps violet.
const TRAFFIC_COLORS = [0x52525b, 0x71717a, 0xd97706];

// The iframe forwards the platform token on every fetch it makes; grab it
// the same way the scaffold does so run saving works inside the shell.
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const authHeaders = () => (TOKEN ? { 'x-usernode-token': TOKEN } : {});

const fmtM = (n) => `${Math.round(n)} m`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// WebGL is unavailable in a few older WebViews. Degrade to a message on the
// start screen instead of throwing — a console error would fail the page
// check, and the game genuinely cannot run there.
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {}

if (!renderer) {
  startMsg.textContent = 'This browser could not start WebGL, so the game cannot run here.';
  startBtn.disabled = true;
  startBtn.classList.add('opacity-50');
} else {
  boot();
}

function boot() {
  // ---------- Renderer / scene ----------
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x09090b);
  scene.fog = new THREE.Fog(0x09090b, 40, 150);

  const camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 400
  );
  camera.position.set(0, 4.4, 9.5);

  scene.add(new THREE.HemisphereLight(0xc7c9e8, 0x27272a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  // ---------- Static ground, road, edge lines ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshLambertMaterial({ color: 0x18181b })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -150);
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 340),
    new THREE.MeshLambertMaterial({ color: 0x27272a })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -155);
  scene.add(road);

  function addBox(w, h, d, color, x, y, z, parent) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    m.position.set(x, y, z);
    (parent || scene).add(m);
    return m;
  }

  addBox(0.14, 0.02, 340, 0xd4d4d8, -4.3, 0.02, -155); // left edge line
  addBox(0.14, 0.02, 340, 0xd4d4d8, 4.3, 0.02, -155);  // right edge line

  // ---------- Scrolling lane dashes ----------
  // One group holds both divider lines; sliding the group by one dash
  // spacing and wrapping is a seamless infinite road.
  const dashes = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    addBox(0.16, 0.02, 2.6, 0xa1a1aa, -1.5, 0.02, 15 - i * 7, dashes);
    addBox(0.16, 0.02, 2.6, 0xa1a1aa, 1.5, 0.02, 15 - i * 7, dashes);
  }
  scene.add(dashes);

  // ---------- Barriers along both road edges ----------
  const barrierL = new THREE.Group();
  const barrierR = new THREE.Group();
  for (let i = 0; i < 70; i++) {
    const color = i % 2 === 0 ? 0xd4d4d8 : 0x52525b;
    addBox(0.4, 0.7, 3.3, color, -4.95, 0.35, 15 - i * 4, barrierL);
    addBox(0.4, 0.7, 3.3, color, 4.95, 0.35, 15 - i * 4, barrierR);
  }
  scene.add(barrierL, barrierR);

  // ---------- Roadside trees, recycled individually ----------
  const props = [];
  for (let i = 0; i < 26; i++) {
    const tree = new THREE.Group();
    addBox(0.35, 1.2, 0.35, 0x57534e, 0, 0.6, 0, tree);
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 2.8, 7),
      new THREE.MeshLambertMaterial({ color: 0x2f5d46 })
    );
    crown.position.y = 2.4;
    tree.add(crown);
    tree.position.set(propX(), 0, 15 - Math.random() * SCROLL_SPAN);
    scene.add(tree);
    props.push(tree);
  }

  function propX() {
    // Somewhere off-road on either side, clear of the barriers.
    const side = Math.random() < 0.5 ? -1 : 1;
    return side * (8.5 + Math.random() * 22);
  }

  // ---------- Cars ----------
  function buildCar(bodyColor) {
    const g = new THREE.Group();
    addBox(1.8, 0.65, 4.0, bodyColor, 0, 0.55, 0, g);         // body
    addBox(1.55, 0.5, 1.9, 0x1c1917, 0, 1.12, 0.25, g);       // cabin
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
    for (const [wx, wz] of [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      g.add(wheel);
    }
    scene.add(g);
    return g;
  }

  const player = buildCar(0x7c3aed);

  const traffic = [];
  for (let i = 0; i < TRAFFIC_POOL; i++) {
    const g = buildCar(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
    g.visible = false;
    traffic.push({ g, active: false, speed: 8, lane: 1 });
  }

  // Spawn ahead in a lane that is not already blocked near the fog line, so
  // a wall of three cars across the road can never appear at once.
  function spawnCar() {
    const car = traffic.find((c) => !c.active);
    if (!car) return;
    const free = LANES.filter((lane) => !traffic.some((c) =>
      c.active && c.lane === lane && Math.abs(c.g.position.z - SPAWN_Z) < 26
    ));
    if (!free.length) return;
    car.lane = free[Math.floor(Math.random() * free.length)];
    car.speed = 7 + Math.random() * 5;
    car.g.position.set(car.lane, 0, SPAWN_Z);
    car.g.visible = true;
    car.active = true;
  }

  // ---------- Input ----------
  // The thumb pad is the touchscreen control: horizontal offset from the
  // press point steers, vertical offset sets the speed. Releasing holds
  // the speed and springs the wheel back to center. Arrow keys do the
  // same on a keyboard; up/down nudge the speed while held.
  let padDragging = false;
  let padPointerId = null;
  let padStartX = 0;
  let padStartY = 0;
  let steerInput = 0;
  let throttleInput = 0;
  const keys = { left: false, right: false, up: false, down: false };

  // How far the knob travels from the press point before the input reads
  // as full lock / full throttle.
  const padTravel = () => Math.max(28, padEl.clientWidth / 2 - 26);

  function moveThumb(dx, dy) {
    const travel = padTravel();
    const x = THREE.MathUtils.clamp(dx, -travel, travel);
    const y = THREE.MathUtils.clamp(dy, -travel, travel);
    padThumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  padEl.addEventListener('pointerdown', (e) => {
    if (state !== 'playing' || padDragging) return;
    padDragging = true;
    padPointerId = e.pointerId;
    padStartX = e.clientX;
    padStartY = e.clientY;
    steerInput = 0;
    throttleInput = 0;
    // Capture so a drag that leaves the pad keeps steering. Can throw if
    // the pointer went inactive between down and capture — never worth
    // breaking the drag over.
    try { padEl.setPointerCapture(e.pointerId); } catch {}
  });
  padEl.addEventListener('pointermove', (e) => {
    if (!padDragging || e.pointerId !== padPointerId) return;
    const dx = e.clientX - padStartX;
    const dy = e.clientY - padStartY;
    steerInput = THREE.MathUtils.clamp(dx / padTravel(), -1, 1);
    // Screen up is negative clientY, so flip the sign: dragging up means
    // throttle up.
    throttleInput = THREE.MathUtils.clamp(-dy / padTravel(), -1, 1);
    moveThumb(dx, dy);
  });
  const endPad = (e) => {
    if (!padDragging || e.pointerId !== padPointerId) return;
    padDragging = false;
    steerInput = 0;
    throttleInput = 0;
    moveThumb(0, 0);
  };
  padEl.addEventListener('pointerup', endPad);
  padEl.addEventListener('pointercancel', endPad);
  padEl.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
    if (e.key === 'ArrowUp') keys.up = true;
    if (e.key === 'ArrowDown') keys.down = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
    if (e.key === 'ArrowUp') keys.up = false;
    if (e.key === 'ArrowDown') keys.down = false;
  });

  // ---------- Game state ----------
  let state = 'ready'; // ready | playing | over
  let steer = 0;       // smoothed steering, -1 (left) .. 1 (right)
  let playerX = 0;
  let distance = 0;
  let runSpeed = CRUISE_SPEED; // the speed the player has set this run
  let worldSpeed = 8;  // the actually-applied scroll speed, eased toward runSpeed
  let spawnTimer = 2.2;
  let best = Number(localStorage.getItem('racing.best') || 0);

  function begin() {
    for (const c of traffic) {
      c.active = false;
      c.g.visible = false;
    }
    playerX = 0;
    steer = 0;
    distance = 0;
    runSpeed = CRUISE_SPEED;
    spawnTimer = 2.2;
    state = 'playing';
    startEl.classList.add('hidden');
    overEl.classList.replace('flex', 'hidden');
    hudEl.classList.remove('hidden');
    padEl.classList.remove('hidden');
  }

  startBtn.addEventListener('click', begin);
  restartBtn.addEventListener('click', begin);

  function crash() {
    state = 'over';
    hudEl.classList.add('hidden');
    padEl.classList.add('hidden');
    const d = Math.floor(distance);
    overDistanceEl.textContent = fmtM(d);
    if (d > best) {
      best = d;
      localStorage.setItem('racing.best', String(best));
    }
    overBestEl.textContent = fmtM(best);
    boardEl.innerHTML = '<p class="text-zinc-500 text-sm">Saving run…</p>';
    signinHint.classList.add('hidden');
    overEl.classList.replace('hidden', 'flex');
    saveRun(d);
  }

  async function saveRun(d) {
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ distance: d }),
      });
      if (res.status === 401) {
        // Opened outside the shell (or the token expired): the run played
        // fine, it just cannot be saved.
        boardEl.innerHTML = '';
        signinHint.classList.remove('hidden');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (Number.isFinite(data.best) && data.best > best) {
        best = data.best;
        localStorage.setItem('racing.best', String(best));
        overBestEl.textContent = fmtM(best);
      }
      renderBoard(data.top);
    } catch {
      boardEl.innerHTML = '<p class="text-zinc-500 text-sm">Could not load top runs.</p>';
    }
  }

  function renderBoard(top) {
    if (!top || !top.length) {
      boardEl.innerHTML = '<p class="text-zinc-600 text-sm">No runs yet</p>';
      return;
    }
    boardEl.innerHTML = top.map((r, i) =>
      `<div class="flex justify-between px-3 py-1 rounded ${i === 0 ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-400'}">` +
      `<span>${i + 1}. ${escapeHtml(r.username)}</span>` +
      `<span class="font-mono">${fmtM(r.distance)}</span></div>`
    ).join('');
  }

  // ---------- Per-frame update ----------
  function step(dt) {
    // While a run is on, the pad's vertical offset sets the speed directly
    // and the arrow keys nudge it; releasing the pad holds what you set.
    if (state === 'playing') {
      if (padDragging) {
        // Cruise sits at the pad's center; full travel spans min..max.
        runSpeed = CRUISE_SPEED + throttleInput * (SPEED_MAX - SPEED_MIN) / 2;
      } else {
        if (keys.up) runSpeed = Math.min(SPEED_MAX, runSpeed + KEY_SPEED_RATE * dt);
        if (keys.down) runSpeed = Math.max(SPEED_MIN, runSpeed - KEY_SPEED_RATE * dt);
      }
    }

    // The world eases between an idle crawl on the start screen, the
    // player's chosen speed in a run, and a halt after a crash.
    const targetSpeed = state === 'playing' ? runSpeed : state === 'ready' ? 8 : 0;
    worldSpeed += (targetSpeed - worldSpeed) * Math.min(1, dt * 2.5);

    // Steering: pad position or arrow keys set the target; the wheel
    // eases toward it and springs back to center when released.
    let input = 0;
    if (state === 'playing') {
      if (padDragging) input = steerInput;
      else input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    }
    steer += (input - steer) * Math.min(1, dt * 9);

    if (state === 'playing') {
      playerX = THREE.MathUtils.clamp(playerX + steer * STEER_RATE * dt, -EDGE, EDGE);
      distance += worldSpeed * dt;
      distanceEl.textContent = fmtM(distance);
      speedEl.textContent = `${Math.round(worldSpeed * 3.6)} km/h`;
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnCar();
        // Traffic thickens the further you drive.
        spawnTimer = Math.max(0.8, 1.7 - distance / 2500);
      }
    }

    player.position.x = playerX;
    player.rotation.y = -steer * 0.28; // nose points where you steer
    player.rotation.z = -steer * 0.16; // body leans into the turn

    // Scroll the road dressing; wrap each layer by its own spacing so the
    // pattern never shows a seam.
    dashes.position.z += worldSpeed * dt;
    if (dashes.position.z >= 7) dashes.position.z -= 7;
    for (const barrier of [barrierL, barrierR]) {
      barrier.position.z += worldSpeed * dt;
      if (barrier.position.z >= 4) barrier.position.z -= 4;
    }
    for (const tree of props) {
      tree.position.z += worldSpeed * dt;
      if (tree.position.z > 20) {
        tree.position.z -= SCROLL_SPAN;
        tree.position.x = propX();
      }
    }

    for (const c of traffic) {
      if (!c.active) continue;
      // Traffic drives the same way but slower, so it drifts toward the
      // player at the difference of the two speeds. Slowing below a car's
      // own speed makes it pull away instead — recycle it once it falls
      // back behind the fog line so it never clogs the pool.
      c.g.position.z += (worldSpeed - c.speed) * dt;
      if (c.g.position.z > DESPAWN_Z || c.g.position.z < SPAWN_Z - 40) {
        c.active = false;
        c.g.visible = false;
        continue;
      }
      if (state === 'playing'
          && Math.abs(c.g.position.z) < 2.3
          && Math.abs(c.g.position.x - playerX) < 1.45) {
        crash();
      }
    }

    // The camera eases toward the car's lane so steering reads in the frame.
    camera.position.x += (playerX * 0.5 - camera.position.x) * Math.min(1, dt * 4);
    camera.lookAt(camera.position.x, 1.1, -14);
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden) return; // paused while the shell hides the app
    step(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}
