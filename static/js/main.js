/* HORCRUX project page: the viewers, the numbers, and the page chrome. The 3-D engine is viewer.js. */
import {
  THREE, $, $$, reduceMotion, HAND, HAND_L, OBJ, CONTACT, VIOLET, dec, getJSON, clamp, mix3, failed,
  Stage, makeScene, disposeScene, mat, ghost, setColors, geometry, solid, radiusAbout, Orbit, kCamera, poseK, poseFit,
  loadHand, loadMano, canonicalView,
} from './viewer.js?v=20261123c';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const press = (btns, on) => btns.forEach(b => b.setAttribute('aria-pressed', String(!!on(b))));
const WHITE = [1, 1, 1];
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';   // an empty image until the photo arrives

/** run fn once, when the element comes near the viewport */
function whenNear(node, fn) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '700px 0px' });
  io.observe(node);
}

// ------------------------------------------------------------------ tooltip (hover and keyboard focus)
const tipEl = $('#tip');
const tip = {
  show(target, value, label, x, y) {
    tipEl.textContent = ''; tipEl.appendChild(el('b', '', value)); tipEl.appendChild(el('span', '', label)); tipEl.hidden = false;
    const r = target.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    const cx = x === undefined ? r.left + r.width / 2 : x, top = y === undefined ? r.top : y;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - tw - 8, cx - tw / 2)) + 'px';
    tipEl.style.top = Math.max(8, top - th - 10) + 'px';
  },
  hide() { tipEl.hidden = true; },
};
addEventListener('scroll', tip.hide, { passive: true });

// ------------------------------------------------------------------ small controls
/** a row of example thumbnails; returns mark(name) */
function thumbStrip(box, names, onPick, { clip, label } = {}) {
  box.textContent = '';
  const btns = names.map((n, k) => {
    const b = el('button', 'thumb' + (clip && clip(n) ? ' clip' : '')); b.type = 'button'; b.dataset.ex = n;
    const text = label ? label(n, k) : `Example ${k + 1}`;
    b.setAttribute('aria-label', text); b.setAttribute('aria-pressed', 'false'); if (label) b.title = text;
    const im = el('img'); im.src = `static/img/thumbs/${n}.jpg`; im.alt = ''; im.width = 46; im.height = 46; im.loading = 'lazy'; im.draggable = false;
    b.appendChild(im); b.addEventListener('click', () => onPick(n)); box.appendChild(b);
    return b;
  });
  return name => press(btns, b => b.dataset.ex === name);
}
/** a segmented control whose buttons carry data-<attr>; returns mark(value) */
function seg(box, attr, onPick) {
  const btns = $$(`button[data-${attr}]`, box);
  btns.forEach(b => b.addEventListener('click', () => onPick(b.dataset[attr])));
  return v => press(btns, b => b.dataset[attr] === String(v));
}
const seam = (c, s) => mix3(c, WHITE, s / 255 * 0.5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const warm = src => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => r(); im.src = src; });   // an image in the cache

// ------------------------------------------------------------------ the stage under the title: input, then the reconstruction turning
const DWELL = [2000, 7400];         // ms on each step of the tour
const SWING = 1100, TURN = 2600;    // the reconstruction holds the photo's view, then turns to the side and sways about it
const HERO_FILL = 1.12;             // room around the meshes, which also sit a little left and low: the input image holds the top right corner
function initHero(names) {
  const root = $('#hero-stage'), view = $('.stage-view', root), photo = $('.photo', view), stage = new Stage(view);
  const steps = $$('.step', root), playBtn = $('[data-act="play"]', root);
  const v = stage.add({ el: view, scene: null, camera: null });
  let cur = null, at = 0, step = 0, touring = false, timer = 0, token = 0, swung = false, swingT = 0;
  const orbit = new Orbit(() => stage.request(), { idle: { sway: 16, period: 10000, when: () => step > 0 && swung } });   // about the side view
  orbit.bind(view);
  stage.ticks.add(t => orbit.tick(t));
  function swing() {   // from the photo's view round to the side, where the object shows in the grasp
    clearTimeout(swingT);
    if (!cur || orbit.held || swung) return;
    swung = true; orbit.animateTo(cur.novel.yaw, cur.novel.pitch, reduceMotion ? 0 : TURN);
  }
  function go(i) {   // 0: the photo fills the stage; 1: it steps aside, and the meshes turn from its view to the side
    step = i; press(steps, b => +b.dataset.step === i); view.classList.toggle('no-mesh', i === 0);
    clearTimeout(swingT);
    if (cur) { swung = false; orbit.animateTo(0, 0, 900); if (i === 1) swingT = setTimeout(swing, SWING); }
    stage.request();
  }
  /* the tour: input, reconstruction, then the next example. Holding the view pauses it, and it goes on after the release. */
  function schedule(ms) {
    clearTimeout(timer);
    if (!touring) return;
    timer = setTimeout(() => {
      if (cur && stage.visible && !document.hidden && !orbit.held) { if (step < 1) go(step + 1); else show(names[(at + 1) % names.length]); }
      schedule();
    }, ms || DWELL[step]);
  }
  function setTour(on) {
    touring = on && !reduceMotion;
    playBtn.setAttribute('aria-pressed', String(touring)); $('.play-tx', playBtn).textContent = touring ? 'Pause' : 'Play';
    schedule();
  }
  orbit.onGrab = () => {
    clearTimeout(timer); clearTimeout(swingT); swung = true;   // after the release it sways about where it is left
    if (step === 0) { step = 1; press(steps, b => +b.dataset.step === 1); view.classList.remove('no-mesh'); }
  };
  orbit.onRelease = () => schedule(Math.max(DWELL[step], 3600));
  steps.forEach(b => b.addEventListener('click', () => { go(+b.dataset.step); schedule(Math.max(DWELL[step], 3600)); }));
  playBtn.addEventListener('click', () => setTour(!touring));
  $('[data-act="reset"]', root).addEventListener('click', () => {   // back to the photo's view, and it stays there
    clearTimeout(swingT); swung = false; orbit.animateTo(0, 0, 700);
    schedule(Math.max(DWELL[step], 3600));
  });

  const mark = thumbStrip($('[data-thumbs]', root), names, n => show(n));
  async function show(name) {
    const my = ++token; at = names.indexOf(name); mark(name);
    const gone = cur ? (view.classList.add('swap'), sleep(320)) : null;   // the present example fades out first
    try {
      const [d, mano] = await Promise.all([getJSON(`static/data/hero/${name}.json?v=20261123a`), loadMano()]);
      await Promise.all([warm(d.photo), gone]);
      if (my !== token) return;
      const target = new THREE.Vector3(...d.target), cam = new THREE.PerspectiveCamera(24, 1, 0.01, 20), scene = makeScene(cam), hands = d.hands.map(h => dec(h.V)), oV = dec(d.obj.V);
      hands.forEach((V, k) => scene.add(new THREE.Mesh(geometry(V, d.hands[k].side === 'L' ? mano.L : mano.R), mat(hands.length > 1 && d.hands[k].side === 'L' ? HAND_L : HAND))));
      if (d.obj.C) { const m = mat(null, true); m.roughness = 0.7; scene.add(new THREE.Mesh(solid(oV, dec(d.obj.F), dec(d.obj.C)), m)); }
      else scene.add(new THREE.Mesh(solid(oV, dec(d.obj.F)), mat(OBJ, false, 0.42)));
      // in the middle of the stage and filling it, seen from the direction of the photo's camera at yaw 0 (not at its place in the image)
      const radius = radiusAbout(target, [...hands, oV]) * HERO_FILL, toCam = target.clone().negate().normalize();
      disposeScene(v.scene);
      Object.assign(v, { scene, camera: cam, fit: a => { cam.setViewOffset(a * 1000, 1000, 40 * a, -50, a * 1000, 1000); poseFit(cam, target, radius, toCam, orbit.yaw, orbit.pitch, a); } });
      photo.src = d.photo; photo.alt = `Input image: ${hands.length > 1 ? 'two hands' : 'a hand'} holding an object, ${d.dataset}`;
      const first = !cur; cur = d;
      const l = $('.loading', view); if (l) l.remove();
      orbit.anim = null; orbit.yaw = orbit.pitch = 0; swung = false;
      view.classList.add('snap');                                        // placed without a transition, then faded in
      if (reduceMotion) go(1); else if (first) { go(0); setTour(true); } else go(touring ? 0 : 1);
      void view.offsetWidth; view.classList.remove('snap', 'swap');
      schedule();
      getJSON(`static/data/hero/${names[(at + 1) % names.length]}.json?v=20261123a`).then(n => warm(n.photo)).catch(() => {});   // the next one is ready when the tour gets there
    } catch (e) { view.classList.remove('swap'); failed(view, e); }
  }
  show(names[0]);
}

// ------------------------------------------------------------------ method: the figure on the paper's first example, then the fine head on four
const rowLabel = d => `${d.dataset} test frame ${d.row}`;

async function initFlow(name) {   // one example only: no thumbnails, no frame name
  const root = $('#flow'), host = $('.stage-host', root), stage = new Stage(host);
  const pMesh = $('[data-flow="mesh"]', root), pRec = $('[data-flow="recon"]', root);
  const vMesh = stage.add({ el: pMesh, scene: null, camera: null }), vRec = stage.add({ el: pRec, scene: null, camera: null });
  // both turn by themselves: the object mesh that goes in, and the reconstruction that comes out
  const orbit = new Orbit(() => stage.request(), { pitch: -10, idle: { spin: 18 } }), spin = new Orbit(() => stage.request(), { idle: { spin: 22 } });
  orbit.bind(pRec); spin.bind(pMesh);
  stage.ticks.add(t => { const a = orbit.tick(t), b = spin.tick(t); return a || b; });
  try {
    const [d, mano] = await Promise.all([getJSON(`static/data/c2f/${name}.json`), loadMano()]);
    const target = new THREE.Vector3(...d.target), cam = new THREE.PerspectiveCamera(24, 1, 0.01, 20), scene = makeScene(cam);
    const hV = dec(d.hand), oV = dec(d.obj.V), og = solid(oV, dec(d.obj.F));
    scene.add(new THREE.Mesh(geometry(hV, d.side === 'L' ? mano.L : mano.R), mat(HAND))); scene.add(new THREE.Mesh(og, mat(OBJ, false, 0.42)));
    const radius = radiusAbout(target, [hV, oV]), toCam = target.clone().negate().normalize();   // yaw 0 looks from the camera of the photo
    Object.assign(vRec, { scene, camera: cam, fit: a => poseFit(cam, target, radius, toCam, orbit.yaw, orbit.pitch, a) });
    const mcam = new THREE.PerspectiveCamera(24, 1, 0.01, 20), mscene = makeScene(mcam);   // the object mesh alone
    mscene.add(new THREE.Mesh(og, mat(OBJ, false, 0.42)));
    const c = og.boundingSphere.center.clone(), rad = og.boundingSphere.radius * 0.98, base = c.clone().negate().normalize();
    Object.assign(vMesh, { scene: mscene, camera: mcam, fit: a => poseFit(mcam, c, rad, base, spin.yaw, spin.pitch, a) });
    const scenePh = $('[data-flow="scene"]', root); scenePh.src = d.full || d.photo; scenePh.alt = `Input image, ${rowLabel(d)}`;
    $('[data-flow="crop"]', root).src = d.crop;
    $$('.loading', host).forEach(l => l.remove());
    stage.request();
  } catch (e) { failed(host, e); }
}

/* canonical hands colored per unit: the coarse contact (21 joints), the region distances the fine head reads, the fine contact (103 regions) */
const NEAR_MM = 30, FAR = [0.86, 0.89, 0.95];
const closeness = mm => Math.pow(clamp(1 - Math.max(mm, 0) / NEAR_MM, 0, 1), 1.5);
async function initUnits() {
  const root = $('#units'), host = $('.stage-host', root), stage = new Stage(host);
  const orbit = new Orbit(() => stage.request(), { minPitch: -70, maxPitch: 70, idle: { spin: 20 } });   // both hands turn all the way round, palm then back
  stage.ticks.add(t => orbit.tick(t));
  try {
    const hd = await loadHand();
    for (const p of $$('.panel.v3d', host)) {
      const fine = p.dataset.unit === 'fine';   // the colours of the paper's figure: one pastel palette, touching units unlike
      canonicalView(stage, p, hd, orbit,
        fine ? i => mix3(hd.regionColor[hd.fine[i]], WHITE, hd.seamF[i] / 255) : i => mix3(hd.jointColor[hd.coarse[i]], WHITE, hd.seamC[i] / 255),
        fine ? i => [hd.regionNames[hd.fine[i]], 'One of 103 regions'] : i => [hd.jointNames[hd.coarse[i]], 'One of 21 joints'], tip, { scale: 1.02 });
      orbit.bind(p);
    }
    stage.request();
  } catch (e) { failed(host, e); }
}
/* the fine head on the first four examples at once: a column per example, a row per step, the input image in the corner of the coarse
   contact. One view for every hand: they turn together, all the way round. */
const C2F_ROWS = [
  { m: 'coarse', name: 'Coarse contact' },
  { m: 'dist', name: 'Region distance', op: 'M8 2.5v11M2.5 8h11' },
  { m: 'fine', name: 'Fine contact', op: 'M8 2.5v11M3.5 9 8 13.5 12.5 9', ours: true },   // an arrow down the column
];
async function initC2F(names) {
  const root = $('#c2f'), host = $('.stage-host', root), stage = new Stage(host), cells = names.map(() => ({}));
  const orbit = new Orbit(() => stage.request(), { minPitch: -70, maxPitch: 70, idle: { spin: 16 } });
  stage.ticks.add(t => orbit.tick(t));
  for (const row of C2F_ROWS) {
    if (row.op) {   // a link from the step above in every column, so that a column reads as one example: coarse + distance -> fine
      host.appendChild(el('div'));
      names.forEach((_, k) => { const l = el('div', `link s${k + 1}`); l.innerHTML = `<span class="opi"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${row.op}"/></svg></span>`; host.appendChild(l); });
    }
    const lab = el('div', 'rowlab' + (row.ours ? ' ours' : ''));
    lab.appendChild(el('b', '', row.name)); host.appendChild(lab);
    names.forEach((_, k) => {
      const p = el('div', `panel v3d plain s${k + 1}`);
      p.setAttribute('aria-label', `${row.name} on the canonical hand, example ${k + 1}, turning in 3D`);
      if (row.m === 'coarse') { const im = el('img', 'photo'); im.draggable = false; im.alt = ''; im.src = BLANK; p.appendChild(im); cells[k].photo = im; }
      p.appendChild(el('div', 'loading', 'Loading 3D…')); host.appendChild(p); cells[k][row.m] = p; orbit.bind(p);
    });
  }
  try {
    const hd = await loadHand(), n = hd.V.length / 3;
    names.forEach(async (name, k) => {
      const c = cells[k], v = {};
      for (const row of C2F_ROWS) {
        const view = v[row.m] = canonicalView(stage, c[row.m], hd, orbit, () => HAND, null, tip, { scale: 1.14, lift: 0.03 });
        const fit = view.fit, cam = view.camera;   // a little left and low, as in every row: the input image holds the top right corner
        view.fit = a => { cam.setViewOffset(a * 1000, 1000, 40 * a, -40, a * 1000, 1000); fit(a); };
      }
      try {
        const d = await getJSON(`static/data/c2f/${name}.json`);
        setColors(v.coarse.geo, n, i => seam(d.coarse[hd.coarse[i]] > 0.5 ? CONTACT : HAND, hd.seamC[i]));
        setColors(v.dist.geo, n, i => seam(mix3(FAR, VIOLET, closeness(d.dmin[hd.fine[i]])), hd.seamF[i]));
        setColors(v.fine.geo, n, i => seam(d.fine[hd.fine[i]] > 0.5 ? CONTACT : HAND, hd.seamF[i]));
        v.coarse.hover = i => { const j = hd.coarse[i]; return [hd.jointNames[j], `Contact probability ${d.coarse[j].toFixed(2)}`]; };
        v.dist.hover = i => { const r = hd.fine[i]; return [hd.regionNames[r], `${Math.max(d.dmin[r], 0).toFixed(1)} mm to the object`]; };
        v.fine.hover = i => { const r = hd.fine[i]; return [hd.regionNames[r], `Contact probability ${d.fine[r].toFixed(2)}`]; };
        c.photo.src = d.photo; c.photo.alt = `Input image, ${rowLabel(d)}`;
        stage.request();
      } catch (e) { failed(c.coarse, e); }
    });
  } catch (e) { failed(host, e); }
}

// ------------------------------------------------------------------ results: methods side by side on a clip or a single frame
const FPS = 6;   // the clips keep every second frame of a 30 fps recording: 6 per second plays them at 0.4x
/* decoded once per clip: per-frame hand vertices (0.1 mm, about the target) and object transforms of every method */
function buildClip(c, mano) {
  const target = new THREE.Vector3(...c.target), objGeo = solid(dec(c.obj.V), dec(c.obj.F)), data = {};
  for (const m of c.methods) data[m.key] = { hands: dec(c.frames[m.key].hands), obj: dec(c.frames[m.key].obj) };
  const mk = (key, isGhost) => {
    const hands = c.sides.map((s, h) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(778 * 3), 3));
      g.setIndex(new THREE.BufferAttribute(s === 'L' ? mano.L : mano.R, 1));
      const me = new THREE.Mesh(g, isGhost ? ghost() : mat(c.handColor[h] || HAND)); me.frustumCulled = false; if (isGhost) me.renderOrder = 2;
      return me;
    });
    const obj = new THREE.Mesh(objGeo, isGhost ? ghost() : mat(c.objColor, false, 0.42)); obj.matrixAutoUpdate = false; obj.frustumCulled = false; if (isGhost) obj.renderOrder = 2;
    return { key, hands, obj };
  };
  const g = data.gt, nh = c.sides.length, o = g.obj, bs = objGeo.boundingSphere, q = bs.center;
  let r2 = 0;
  for (let i = 0; i < nh * 778 * 3; i += 3) r2 = Math.max(r2, g.hands[i] ** 2 + g.hands[i + 1] ** 2 + g.hands[i + 2] ** 2);
  const oc = [o[0] * q.x + o[1] * q.y + o[2] * q.z + o[9] - target.x, o[3] * q.x + o[4] * q.y + o[5] * q.z + o[10] - target.y, o[6] * q.x + o[7] * q.y + o[8] * q.z + o[11] - target.z];
  const radius = Math.max(Math.sqrt(r2) * 1e-4, Math.hypot(...oc) + bs.radius);   // of the ground truth in the first frame
  return { target, data, nh, mk, radius, bs };
}
/** per frame of a clip: the middle of the ground-truth hands and object, and one extent about it that holds every frame */
function trackOf(B, n) {
  const g = B.data.gt, T = B.target, q = B.bs.center, nv = B.nh * 778, centers = [];
  let radius = 0;
  for (let k = 0; k < n; k++) {
    const h = g.hands.subarray(k * nv * 3, (k + 1) * nv * 3), o = g.obj.subarray(k * 12, k * 12 + 12);
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < h.length; i += 3) { x += h[i]; y += h[i + 1]; z += h[i + 2]; }
    const hm = new THREE.Vector3(x / nv * 1e-4 + T.x, y / nv * 1e-4 + T.y, z / nv * 1e-4 + T.z);
    const oc = new THREE.Vector3(o[0] * q.x + o[1] * q.y + o[2] * q.z + o[9], o[3] * q.x + o[4] * q.y + o[5] * q.z + o[10], o[6] * q.x + o[7] * q.y + o[8] * q.z + o[11]);
    const c = hm.clone().add(oc).multiplyScalar(0.5);
    let r2 = 0;
    for (let i = 0; i < h.length; i += 3) r2 = Math.max(r2, (h[i] * 1e-4 + T.x - c.x) ** 2 + (h[i + 1] * 1e-4 + T.y - c.y) ** 2 + (h[i + 2] * 1e-4 + T.z - c.z) ** 2);
    radius = Math.max(radius, Math.sqrt(r2), oc.distanceTo(c) + B.bs.radius);
    centers.push(c);
  }
  return { centers, radius };
}
/** frame k of a built clip on mesh sets made by its mk() */
function poseSets(B, sets, k) {
  const T = B.target, stride = B.nh * 778 * 3;
  for (const set of sets) {
    const d = B.data[set.key];
    set.hands.forEach((h, hi) => {
      const pos = h.geometry.getAttribute('position'), a = pos.array, off = k * stride + hi * 778 * 3;
      for (let i = 0; i < 778 * 3; i += 3) { a[i] = d.hands[off + i] * 1e-4 + T.x; a[i + 1] = d.hands[off + i + 1] * 1e-4 + T.y; a[i + 2] = d.hands[off + i + 2] * 1e-4 + T.z; }
      pos.needsUpdate = true; h.geometry.computeVertexNormals();
    });
    const o = d.obj.subarray(k * 12, k * 12 + 12);
    set.obj.matrix.set(o[0], o[1], o[2], o[9], o[3], o[4], o[5], o[10], o[6], o[7], o[8], o[11], 0, 0, 0, 1); set.obj.matrixWorldNeedsUpdate = true;
  }
}
/** frame k of a clip's photos, one sprite sheet */
function spriteAt(node, clip, k) {
  const s = clip.sprite, col = k % s.cols, row = Math.floor(k / s.cols), rows = Math.ceil(clip.n / s.cols);
  node.style.backgroundImage = `url(${s.src})`;
  node.style.backgroundSize = `${s.cols * 100}% ${rows * 100}%`;
  node.style.backgroundPosition = `${s.cols > 1 ? col / (s.cols - 1) * 100 : 0}% ${rows > 1 ? row / (rows - 1) * 100 : 0}%`;
}

/* every chosen example at once: the input, two prior methods and HORCRUX. All of them turn together and keep turning, as the
   gallery without a scanned model does; "Camera view" brings every example back to the photo's view and framing, and holds it. */
const ROWS_PER_STAGE = 4;   // one canvas over at most four examples, unless the block says otherwise (data-per-stage)
const ROW_FILL = 1.8;       // away from the photo's view, a small panel frames the ground-truth scene tighter than the single viewer (2.25)
const CLIP_FILL = 2.1;      // a clip's extent holds its every frame: a little more room, so that a large object stays inside while it turns
const ROW_PITCH = -12;      // the turning views look a little from above
const GLIDE = 90;           // ms: how closely a clip's view follows the middle of its hand and object
function initRows(root) {
  const names = root.dataset.rows.split(','), body = $('.rows', root), camBtn = $('[data-act="camera"]', root), play = $('.play', root);
  const per = +root.dataset.perStage || ROWS_PER_STAGE, rows = [], stages = [];
  const camFirst = root.dataset.camera === 'on';   // the video blocks open in the photo's view, held until the button is pressed
  let camOn = camFirst, far = !camFirst, playing = !reduceMotion;   // far: framed about the scene, not as the photo's crop
  const orbit = new Orbit(() => stages.forEach(s => s.request()), { pitch: camFirst ? 0 : ROW_PITCH, idle: { spin: 16, when: () => !camOn && playing } });   // Pause also stops the turning
  function setFrame(r, k) { r.frame = k; if (r.track) r.goal = r.track.centers[k]; spriteAt($('.sprite', r.P.input), r.clip, k); poseSets(r.clip.built, r.views.map(v => v.set), k); r.stage.request(); }
  let stage = null, host = null;
  names.forEach((name, i) => {
    if (i % per === 0) {
      host = el('div', 'rows-host stage-host'); body.appendChild(host); stage = new Stage(host); stages.push(stage);
      const mine = stage.mine = [];   // the examples over this canvas: their clips play while it is on screen
      stage.ticks.add(t => {
        let moving = orbit.tick(t);   // once per frame: a second canvas in the same frame sees no time pass
        const dt = Math.min(t - (stage.lastT || t), 200); stage.lastT = t;
        for (const r of mine) if (r.goal && r.center.distanceToSquared(r.goal) > 1e-10) {   // a clip's view glides after its hand, in time
          r.center.lerp(r.goal, 1 - Math.exp(-dt / GLIDE)); moving = true;
        }
        if (!far && !camOn && Math.hypot(orbit.yaw, orbit.pitch) > 35) far = true;   // left the photo's view: keep the scene's framing
        return moving;
      });
      stage.ticks.add(t => {
        if (!playing) return false;
        let any = false;
        for (const r of mine) {
          if (!r.clip || r.clip.n < 2) continue;
          any = true; if (!r.last) r.last = t;
          if (t - r.last > 1000 / FPS) { r.last = t; setFrame(r, (r.frame + 1) % r.clip.n); }
        }
        return any;
      });
    }
    const ex = el('div', 'ex'), P = {}, r = { name, stage, P, frame: 0, last: 0, clip: null, center: null, goal: null, track: null };
    for (const role of ['input', 'm0', 'm1', 'm2']) {
      const p = el('div', 'panel' + (role === 'input' ? '' : ' v3d') + (role === 'm2' ? ' ours' : '')), cap = el('div', 'pcap');
      if (role === 'input') p.appendChild(el('div', 'sprite'));
      cap.appendChild(el('div', 'pcap-name', role === 'input' ? 'Input' : role === 'm2' ? 'HORCRUX (ours)' : ' ')); p.appendChild(cap);
      if (role !== 'input') p.appendChild(el('div', 'loading', 'Loading 3D…'));
      ex.appendChild(p); P[role] = p;
    }
    host.appendChild(ex);
    r.views = ['m0', 'm1', 'm2'].map(k => { orbit.bind(P[k]); return stage.add({ el: P[k], scene: null, camera: null }); });
    rows.push(r); stage.mine.push(r);
    Promise.all([getJSON(`static/data/clips/${name}.json?v=20261123a`), loadMano()]).then(([c, mano]) => {
      if (!c.built) c.built = buildClip(c, mano);
      r.clip = c;
      if (c.n > 1) { r.track = trackOf(c.built, c.n); r.goal = r.track.centers[0]; }
      r.center = (r.goal || c.built.target).clone();
      const ar = String((c.box[2] - c.box[0]) / (c.box[3] - c.box[1]));
      Object.values(P).forEach(p => { p.style.aspectRatio = ar; });
      const methods = c.methods.filter(m => m.key !== 'gt');
      r.views.forEach((v, j) => {
        const cam = kCamera(c, c.built.target), scene = makeScene(cam), set = c.built.mk(methods[j].key, false);
        Object.assign(cam.userData, { radius: r.track ? r.track.radius : c.built.radius, fill: r.track ? CLIP_FILL : ROW_FILL });
        set.hands.forEach(h => scene.add(h)); scene.add(set.obj);
        const u = cam.userData;   // turning about r.center: the frame's own middle in a clip; the photo's view keeps the crop of the whole clip
        Object.assign(v, { scene, camera: cam, set, fit: a => {
          const t = r.center; u.far = far; u.tp = [u.fx * t.x / -t.z + u.cx, u.fy * -t.y / -t.z + u.cy]; poseK(cam, t, orbit.yaw, orbit.pitch, a);
        } });
        $('.pcap-name', v.el).textContent = methods[j].key === 'ours' ? `${methods[j].label} (ours)` : methods[j].label;
        if (j < 2) $$(`.rows-head [data-m="${j}"]`, root).forEach(h => { h.textContent = methods[j].label; });
      });
      $$('.loading', ex).forEach(l => l.remove());
      setFrame(r, 0);
    }).catch(e => failed(ex, e));
  });
  camBtn.addEventListener('click', () => {
    camOn = !camOn; camBtn.setAttribute('aria-pressed', String(camOn));
    if (camOn) { far = false; orbit.animateTo(0, 0, 1100); }        // the framing follows the angle back to the photo's crop
    else orbit.animateTo(40, ROW_PITCH, 1400);                       // and away again, then the turning resumes
  });
  if (play) {
    const setPlaying = on => {
      playing = on; play.setAttribute('aria-pressed', String(on)); $('.play-tx', play).textContent = on ? 'Pause' : 'Play';
      if (on) orbit.rest();   // the turning eases back in from the present view
      rows.forEach(r => { r.last = 0; r.stage.request(); });
    };
    play.addEventListener('click', () => setPlaying(!playing));
    setPlaying(playing);
  }
}

/* contact on the eight frames of the supp video's Contact Estimation pages: the input crop, UniHOPE, HACO and the fine contact of
   HORCRUX, each on the canonical hand the video draws (per-vertex maps, build_data.py contact_cmp). Every hand turns together about
   its long axis, from the palm, until Pause. */
const CONTACT_COLS = [['uni', 'UniHOPE'], ['haco', 'HACO'], ['fine', 'HORCRUX (ours)']];
async function initContact(root) {
  const body = $('.rows', root), play = $('.play', root), host = el('div', 'rows-host stage-host'), stage = new Stage(host);
  body.appendChild(host);
  let playing = !reduceMotion;
  const orbit = new Orbit(() => stage.request(), { minPitch: -70, maxPitch: 70, idle: { spin: 16, when: () => playing } });
  stage.ticks.add(t => orbit.tick(t));
  const cap = (p, name) => { const c = el('div', 'pcap'); c.appendChild(el('div', 'pcap-name', name)); p.appendChild(c); };
  try {
    const [d, mano] = await Promise.all([getJSON('static/data/contact/cmp.json'), loadMano()]);
    const hd = { V: dec(d.V), F: mano.R };
    for (const r of d.rows) {
      const ex = el('div', 'ex'), inp = el('div', 'panel'), sp = el('div', 'sprite');
      sp.style.backgroundImage = `url(${r.photo})`; sp.setAttribute('role', 'img'); sp.setAttribute('aria-label', `Input hand crop, ${rowLabel(r)}`);
      inp.appendChild(sp); cap(inp, 'Input'); ex.appendChild(inp); host.appendChild(ex);
      for (const [k, name] of CONTACT_COLS) {
        const p = el('div', 'panel v3d' + (k === 'fine' ? ' ours' : '')), v = dec(r[k]);
        p.setAttribute('aria-label', `${name} contact on the canonical hand, ${rowLabel(r)}, turning in 3D`);
        cap(p, name); ex.appendChild(p);
        canonicalView(stage, p, hd, orbit, i => mix3(HAND, CONTACT, v[i]), null, null, { scale: 1.0 });
        orbit.bind(p);
      }
    }
    stage.request();
  } catch (e) { failed(host, e); }
  if (play) {
    const setPlaying = on => {
      playing = on; play.setAttribute('aria-pressed', String(on)); $('.play-tx', play).textContent = on ? 'Pause' : 'Play';
      if (on) orbit.rest(); stage.request();
    };
    play.addEventListener('click', () => setPlaying(!playing));
    setPlaying(playing);
  }
}

// ------------------------------------------------------------------ results: the object mesh reconstructed from the photo
const OBJECT_NAME = {
  S10024: 'Mug', O50001: 'Camera', A01009: 'Soap dispenser', C42001: 'Binoculars', A02018: 'Pump dispenser', S10020: 'Mug', A02021: 'Pump dispenser',
  C40001: 'Eyeglasses', A02011: 'Pump dispenser', O24001: 'Wrench', O21001: 'Screwdriver', C41001: 'Headphones', C90001: 'Apple', C22001: 'Hammer',
  A15015: 'Bottle', C52001: 'Phone',
};
const GALLERY_FILL = 1.16;   // room around each scene: the input image holds the top right corner of its cell
const ALTERNATE = 5000, FADE = 280;   // ms on each object mesh before the gallery shows the other one; the meshes dip out and back in
function initRecon(list) {
  const root = $('#recon'), host = $('.stage-host', root), stage = new Stage(host), cells = [];
  const orbit = new Orbit(() => stage.request(), { pitch: -10, idle: { spin: 16 } });   // one view for every cell: they turn together
  stage.ticks.add(t => orbit.tick(t));
  let which = 'recon', timer = 0;   // the object mesh HORCRUX is given: reconstructed from the photo, or the scan
  const paint = c => { c.scan.forEach(m => { m.visible = which === 'scan'; }); c.recon.forEach(m => { m.visible = which === 'recon'; }); };
  function show(w) {
    if (w === which) return;
    which = w; mark(w);
    const swap = () => { cells.forEach(paint); stage.request(); host.classList.remove('swap'); };
    if (reduceMotion) { swap(); return; }
    host.classList.add('swap'); setTimeout(swap, FADE);
  }
  /* the two meshes take turns by themselves; a click shows one a little longer, and nothing switches while a view is held */
  function alternate(ms) {
    clearTimeout(timer);
    if (reduceMotion) return;
    timer = setTimeout(() => {
      if (stage.visible && !document.hidden && !orbit.held && cells.length) show(which === 'recon' ? 'scan' : 'recon');
      alternate();
    }, ms || ALTERNATE);
  }
  const mark = seg($('[data-seg="mesh"]', root), 'mesh', w => { show(w); alternate(2 * ALTERNATE); });
  alternate();
  list.forEach(async r => {
    const what = (OBJECT_NAME[r.objId] || r.label).toLowerCase(), p = el('div', 'panel v3d'), im = el('img', 'photo');
    p.setAttribute('aria-label', `HORCRUX on a hand holding a ${what}, turning in 3D`);
    im.draggable = false; im.alt = `Input image: a hand holding a ${what}`; im.src = BLANK;
    p.appendChild(im); p.appendChild(el('div', 'loading', 'Loading 3D…')); host.appendChild(p); orbit.bind(p);
    const view = stage.add({ el: p, scene: null, camera: null });
    try {
      const [d, mano] = await Promise.all([getJSON(`static/data/recon/${r.name}.json`), loadMano()]);
      const target = new THREE.Vector3(...d.target), cam = new THREE.PerspectiveCamera(24, 1, 0.01, 20), scene = makeScene(cam);
      const hs = dec(d.scan.hand), hr = dec(d.recon.hand), sV = dec(d.scan.V), rV = dec(d.recon.V), tex = mat(null, true);
      tex.roughness = 0.7;
      const c = {
        scan: [new THREE.Mesh(geometry(hs, mano.R), mat(HAND)), new THREE.Mesh(solid(sV, dec(d.scan.F)), mat(OBJ, false, 0.42))],
        recon: [new THREE.Mesh(geometry(hr, mano.R), mat(HAND)), new THREE.Mesh(solid(rV, dec(d.recon.F), dec(d.recon.C)), tex)],
      };
      [...c.scan, ...c.recon].forEach(m => scene.add(m)); paint(c); cells.push(c);
      const radius = radiusAbout(target, [hs, hr, sV, rV]) * GALLERY_FILL, toCam = target.clone().negate().normalize();   // yaw 0 looks from the camera of the photo
      Object.assign(view, { scene, camera: cam, fit: a => { cam.setViewOffset(a * 1000, 1000, 45 * a, -55, a * 1000, 1000); poseFit(cam, target, radius, toCam, orbit.yaw, orbit.pitch, a); } });
      im.src = d.photo; $('.loading', p).remove(); stage.request();
    } catch (e) { failed(p, e); }
  });
}

// ------------------------------------------------------------------ results: the main measure of each setting, from the paper's tables (it has the rest)
const BARS = [   // the main measure of each setting; each card's bars start at the low end of its axis, labeled under them; lower: smaller is better
  { title: 'Hand pose', sub: 'DexYCB · MJE\u00a0↓', measure: 'MJE', axis: [8, 14], lower: true, kpi: 'Hand joint error',
    rows: [['HandOccNet', 12.79], ['SimpleHand', 13.13], ['SemiHand', 13.46], ['HFL-Net', 13.27], ['UniHOPE', 12.92], ['HORCRUX', 10.12]] },
  { title: 'Object pose', sub: 'H2O, two hands · Object\u00a0AUC\u00a0↑', measure: 'Object AUC', axis: [60, 100],
    rows: [['ArcticNet-SF', 73.82], ['HOPformer', 84.06], ['HORCRUX', 97.95]] },
  { title: 'Unseen-object generalization', sub: 'DexYCB → OakInk · Object\u00a0AUC\u00a0↑', measure: 'Object AUC', axis: [30, 100], kpi: 'Object AUC on unseen objects',
    rows: [['SemiHand', 40.50], ['HFL-Net', 37.83], ['UniHOPE', 38.81], ['HORCRUX', 93.29]] },
  { title: 'Contact estimation', sub: 'OakInk · F1\u00a0at\u00a03\u00a0mm\u00a0↑', measure: 'F1 at 3 mm', axis: [10, 80], kpi: 'Contact F1@3mm',
    rows: [['SemiHand', 18.83], ['HFL-Net', 18.90], ['UniHOPE', 18.34], ['HACO', 59.15], ['HORCRUX', 73.62]] },
];
function initNumbers() {
  const bars = $('#bars');
  for (const g of BARS) {
    const card = el('div', 'bargroup'), h = el('h4', '', g.title), rows = el('div', 'brows');
    h.appendChild(el('small', '', g.sub)); card.appendChild(h);
    const [lo, hi] = g.axis, ours = g.rows.find(r => r[0] === 'HORCRUX')[1], prior = g.rows.filter(r => r[0] !== 'HORCRUX').map(r => r[1]);
    const best = g.lower ? Math.min(...prior) : Math.max(...prior), gain = Math.abs(ours - best);
    for (const [name, v] of g.rows) {
      const r = el('div', 'brow' + (name === 'HORCRUX' ? ' ours' : '')), track = el('span', 'btrack'), bar = el('i');
      r.appendChild(el('span', 'bname', name)); r.appendChild(el('span', 'bval', v.toFixed(2)));
      bar.style.setProperty('--v', clamp((v - lo) / (hi - lo), 0.02, 1)); track.appendChild(bar); r.appendChild(track); rows.appendChild(r);
      const label = `${name} · ${g.measure}, ${g.sub.split(' · ')[0]}` + (name === 'HORCRUX' ? '' : g.lower ? ` · ${(v - ours).toFixed(2)} above HORCRUX` : ` · ${(ours - v).toFixed(2)} below HORCRUX`);
      r.tabIndex = 0; r.setAttribute('aria-label', `${name}, ${g.measure}: ${v.toFixed(2)}`);
      const show = () => tip.show(track, v.toFixed(2), label);
      r.addEventListener('pointerenter', show); r.addEventListener('pointerleave', tip.hide); r.addEventListener('focus', show); r.addEventListener('blur', tip.hide);
    }
    card.appendChild(rows);
    const axis = el('div', 'baxis');   // where the bars start: the axis does not begin at zero
    [lo, (lo + hi) / 2, hi].forEach(x => axis.appendChild(el('span', '', String(x))));
    card.appendChild(axis);
    const foot = el('div', 'bfoot'); foot.appendChild(el('span', '', g.lower ? 'Below the best prior method' : 'Over the best prior method')); foot.appendChild(el('b', '', (g.lower ? '−' : '+') + gain.toFixed(2)));
    card.appendChild(foot); bars.appendChild(card);
    if (g.kpi) {   // the cards under the hero: the same numbers, best prior method -> HORCRUX
      const k = el('div', 'kpi'), n = el('div', 'kpi-n');
      n.appendChild(el('span', '', best.toFixed(2))); n.appendChild(el('i', '', '→')); n.appendChild(el('b', '', ours.toFixed(2)));
      k.appendChild(n); k.appendChild(el('div', 'kpi-l', g.kpi)); $('#kpis').appendChild(k);
    }
  }
  const io = new IntersectionObserver(es => {   // the bars grow when they first come into view
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => bars.classList.add('in')));
  }, { threshold: 0.25 });
  io.observe(bars);
}

// ------------------------------------------------------------------ page chrome
function initCopy() {
  $$('.copy').forEach(b => b.addEventListener('click', () => {
    const text = $(b.dataset.copy).textContent;
    const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); };
    if (navigator.clipboard && isSecureContext) navigator.clipboard.writeText(text).then(done);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* no clipboard */ }
      ta.remove();
    }
  }));
}
function initNav() {
  const nav = $('#nav'), links = $$('.nav-links a');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => io.observe(s));
}

initNav(); initCopy(); initNumbers();
getJSON('static/data/index.json?v=20261120c').then(index => {
  const method = index.method;   // the frames of the paper's main figures
  initHero(index.hero);
  whenNear($('#flow'), () => { initFlow(method[0]); initUnits(); initC2F(method.slice(0, 4)); });
  $$('.rows-view:not(.contact-view)').forEach(root => whenNear(root, () => initRows(root)));
  whenNear($('#contact'), () => initContact($('#contact')));
  whenNear($('#recon'), () => initRecon(index.recon));
}).catch(e => failed(document, e));
