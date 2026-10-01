// Racing game — a fixed-speed 3D driver.
//
// Steering is a horizontal drag: the further you drag from where you
// pressed, the harder the car turns, and releasing lets the wheel spring
// back to center. Arrow keys do the same on a desktop keyboard. The car
// never speeds up or slows down; the whole game is keeping it between the
// barriers while traffic comes the other way.

import * as THREE from 'three';

// ---------- DOM ----------
const canvas = document.getElementById('game');
const hudEl = document.getElementById('hud');
const distanceEl = document.getElementById('distance');
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
const SPEED = 24;              // fixed forward speed, never changes
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
  let dragging = false;
  let pointerId = null;
  let dragStartX = 0;
  let dragInput = 0;
  const keys = { left: false, right: false };

  // Full lock at about a third of the narrower viewport of drag room.
  const dragScale = () => Math.max(180, Math.min(window.innerWidth, 480) * 0.32);

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing' || dragging) return;
    dragging = true;
    pointerId = e.pointerId;
    dragStartX = e.clientX;
    dragInput = 0;
    // Capture so a drag that leaves the canvas keeps steering. Can throw if
    // the pointer went inactive between down and capture — never worth
    // breaking the drag over.
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragInput = THREE.MathUtils.clamp((e.clientX - dragStartX) / dragScale(), -1, 1);
  });
  const endDrag = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    dragInput = 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  // ---------- Game state ----------
  let state = 'ready'; // ready | playing | over
  let steer = 0;       // smoothed steering, -1 (left) .. 1 (right)
  let playerX = 0;
  let distance = 0;
  let worldSpeed = 8;  // the actually-applied scroll speed, eased toward target
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
    spawnTimer = 2.2;
    state = 'playing';
    startEl.classList.add('hidden');
    overEl.classList.replace('flex', 'hidden');
    hudEl.classList.remove('hidden');
  }

  startBtn.addEventListener('click', begin);
  restartBtn.addEventListener('click', begin);

  function crash() {
    state = 'over';
    hudEl.classList.add('hidden');
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
    // The world eases between an idle crawl on the start screen, full speed
    // in a run, and a halt after a crash.
    const targetSpeed = state === 'playing' ? SPEED : state === 'ready' ? 8 : 0;
    worldSpeed += (targetSpeed - worldSpeed) * Math.min(1, dt * 2.5);

    // Steering: drag position or arrow keys set the target; the wheel
    // eases toward it and springs back to center when released.
    let input = 0;
    if (state === 'playing') {
      if (dragging) input = dragInput;
      else input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    }
    steer += (input - steer) * Math.min(1, dt * 9);

    if (state === 'playing') {
      playerX = THREE.MathUtils.clamp(playerX + steer * STEER_RATE * dt, -EDGE, EDGE);
      distance += SPEED * dt;
      distanceEl.textContent = fmtM(distance);
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnCar();
        // Traffic thickens the further you drive; speed stays fixed.
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
      // player at the difference of the two speeds.
      c.g.position.z += (worldSpeed - c.speed) * dt;
      if (c.g.position.z > DESPAWN_Z) {
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
