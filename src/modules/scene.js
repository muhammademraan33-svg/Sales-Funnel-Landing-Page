// Draws the hero's Vice City set in code: a skyline, palms, water reflections
// and stars. Everything is geometry generated from a fixed seed, so the scene
// is identical on every visit and no illustration files are needed.

import { $, $$, seeded } from '../lib/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SILHOUETTE = '#090620';

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const round = (n) => Math.round(n * 10) / 10;
const gauss = (x, mean, spread) => Math.exp(-((x - mean) ** 2) / (2 * spread ** 2));

/* ---------------------------------------------------------------- skyline */

function buildSkyline(root) {
  const W = 1600;
  const H = 120;
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Two clusters of towers with low-rise between, loosely like downtown and the beach.
  const envelope = (x) => 0.26 + 0.74 * Math.min(1, gauss(x, 0.3, 0.11) + 0.75 * gauss(x, 0.9, 0.06) + 0.4 * gauss(x, 0.58, 0.07));

  const layer = (seed, { scale, fill, windows }) => {
    const rand = seeded(seed);
    let shape = '';
    const lights = { '#f3c754': '', '#fc50b0': '', '#63f5ee': '' };
    let x = -10;
    while (x < W) {
      const w = 15 + rand() * 34;
      const h = Math.max(8, H * scale * envelope((x + w / 2) / W) * (0.42 + rand() * 0.58));
      const top = H - h;
      shape += `M${round(x)} ${H}V${round(top)}`;
      const style = rand();
      if (style < 0.22 && w > 24) {
        // stepped crown
        const inset = w * 0.22;
        shape += `h${round(inset)}v${round(-h * 0.1)}h${round(w - inset * 2)}v${round(h * 0.1)}h${round(inset)}`;
      } else if (style < 0.34) {
        // antenna
        shape += `h${round(w / 2 - 1)}v${round(-h * 0.22)}h2v${round(h * 0.22)}h${round(w / 2 - 1)}`;
      } else {
        shape += `h${round(w)}`;
      }
      shape += `V${H}Z`;

      if (windows && h > 22) {
        for (let wx = x + 3; wx < x + w - 4; wx += 5) {
          for (let wy = top + 5; wy < H - 4; wy += 6.5) {
            if (rand() > 0.24) continue;
            const pick = rand();
            const color = pick < 0.62 ? '#f3c754' : pick < 0.86 ? '#fc50b0' : '#63f5ee';
            lights[color] += `M${round(wx)} ${round(wy)}h2v2.6h-2z`;
          }
        }
      }
      x += w + (rand() < 0.18 ? 3 + rand() * 12 : 0);
    }
    root.append(svg('path', { d: shape, fill }));
    for (const [color, d] of Object.entries(lights)) {
      if (d) root.append(svg('path', { d, fill: color, opacity: color === '#f3c754' ? '0.8' : '0.7' }));
    }
  };

  layer(11, { scale: 0.62, fill: '#4b2590', windows: false }); // hazy far row
  layer(305, { scale: 1, fill: '#150a3e', windows: true }); //    near row, lit
}

/* ------------------------------------------------------------------ palms */

function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

function quadTangent(p0, p1, p2, t) {
  const x = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const y = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * A palm silhouette in a 400x600 box. `lean` bends the trunk (negative leans
 * left); fronds arch out of the crown and droop, each feathered with leaflets.
 */
function buildPalm(root, seed, { lean = 0.3, fronds = 11 } = {}) {
  const rand = seeded(seed);
  root.setAttribute('viewBox', '0 0 400 600');

  const base = { x: 200 - lean * 150, y: 606 };
  const crown = { x: 200 + lean * 50, y: 196 };
  const c1 = { x: base.x + lean * 20, y: 440 };
  const c2 = { x: crown.x - lean * 90, y: 300 };

  // Trunk: a tapered ribbon along a cubic curve.
  const left = [];
  const right = [];
  const STEPS = 22;
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const p = cubic(base, c1, c2, crown, t);
    const q = cubic(base, c1, c2, crown, Math.min(1, t + 0.01));
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = 11 - 5.5 * t;
    left.push(`${round(p.x - (dy / len) * half)} ${round(p.y + (dx / len) * half)}`);
    right.unshift(`${round(p.x + (dy / len) * half)} ${round(p.y - (dx / len) * half)}`);
  }
  root.append(svg('path', { d: `M${left.join('L')}L${right.join('L')}Z`, fill: SILHOUETTE }));

  let spines = '';
  let leaflets = '';
  for (let i = 0; i < fronds; i += 1) {
    const spread = i / (fronds - 1);
    const angle = ((-170 + spread * 160 + (rand() - 0.5) * 12) * Math.PI) / 180;
    const len = 150 + rand() * 46;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const droop = len * (0.26 + 0.42 * Math.abs(dir.x));
    const p1 = { x: crown.x + dir.x * len * 0.56, y: crown.y + dir.y * len * 0.66 - len * 0.1 };
    const p2 = { x: crown.x + dir.x * len * 1.06, y: crown.y + dir.y * len * 0.5 + droop };
    spines += `M${round(crown.x)} ${round(crown.y)}Q${round(p1.x)} ${round(p1.y)} ${round(p2.x)} ${round(p2.y)}`;

    const SEGMENTS = 24;
    for (let s = 2; s <= SEGMENTS; s += 1) {
      const t = s / SEGMENTS;
      const p = quad(crown, p1, p2, t);
      const tan = quadTangent(crown, p1, p2, t);
      const size = (24 + rand() * 12) * Math.sin(Math.PI * t ** 0.8) + 4;
      for (const side of [1, -1]) {
        // leaflets sweep back along the frond and hang with gravity
        let lx = -tan.y * side * 0.72 + tan.x * 0.56;
        let ly = tan.x * side * 0.72 + tan.y * 0.56 + 0.5;
        const norm = Math.hypot(lx, ly) || 1;
        lx /= norm;
        ly /= norm;
        leaflets += `M${round(p.x)} ${round(p.y)}l${round(lx * size)} ${round(ly * size)}`;
      }
    }
  }
  root.append(svg('path', { d: spines, fill: 'none', stroke: SILHOUETTE, 'stroke-width': 4, 'stroke-linecap': 'round' }));
  root.append(svg('path', { d: leaflets, fill: 'none', stroke: SILHOUETTE, 'stroke-width': 2.7, 'stroke-linecap': 'round' }));
  root.append(svg('circle', { cx: round(crown.x), cy: round(crown.y + 3), r: 11, fill: SILHOUETTE }));
}

/* ------------------------------------------------------- water and sky */

function buildRipples(root, sunX) {
  const rand = seeded(77);
  const warm = ['#f3c754', '#fc50b0', '#f5793d', '#ffd9a8'];
  const cool = ['#63f5ee', '#8a3fd1', '#19c8c9'];
  const add = (x, y, width, color, opacity) => {
    const line = document.createElement('i');
    line.style.cssText =
      `left:${round(x)}%;top:${round(y * 100)}%;width:${round(width)}%;height:${round(1.5 + y * 2.5)}px;` +
      `background:${color};--o:${round(opacity)};animation-duration:${round(2.2 + rand() * 3.8)}s;animation-delay:-${round(rand() * 6)}s`;
    root.append(line);
  };
  // the sun's reflection: a cone of warm streaks widening towards the viewer
  for (let i = 0; i < 44; i += 1) {
    const y = rand() ** 1.6;
    const spread = 3 + y * 26;
    add(sunX + (rand() - 0.5) * 2 * spread, 0.02 + y * 0.9, (1 + y * 6) * (0.5 + rand()), warm[Math.floor(rand() * warm.length)], 0.4 + rand() * 0.5);
  }
  // cooler glints across the rest of the water
  for (let i = 0; i < 26; i += 1) {
    const y = rand();
    add(rand() * 100, 0.04 + y * 0.85, (1 + y * 4) * (0.5 + rand()), cool[Math.floor(rand() * cool.length)], 0.18 + rand() * 0.3);
  }
}

function buildStars(root) {
  const rand = seeded(1986);
  for (let i = 0; i < 42; i += 1) {
    const star = document.createElement('i');
    const size = 1 + rand() * 1.6;
    star.style.cssText = `left:${round(rand() * 100)}%;top:${round(rand() ** 1.4 * 100)}%;width:${round(size)}px;height:${round(size)}px;animation-delay:-${round(rand() * 4)}s;animation-duration:${round(2.4 + rand() * 3)}s`;
    root.append(star);
  }
}

let built = false;

/** Builds the set once, the first time the stage layout is used. */
export function buildScene() {
  if (built) return;
  const scene = $('[data-scene]');
  if (!scene) return;
  built = true;

  buildSkyline($('[data-skyline]', scene));
  buildStars($('[data-stars]', scene));
  buildRipples($('[data-ripples]', scene), 75); // under the sun (--sun-x in hero.css)

  const palms = {
    l1: { seed: 4, lean: 0.55, fronds: 12 },
    l2: { seed: 9, lean: 0.2, fronds: 10 },
    r1: { seed: 21, lean: -0.5, fronds: 12 },
  };
  for (const node of $$('[data-palm]', scene)) {
    const { seed, ...shape } = palms[node.dataset.palm];
    buildPalm(node, seed, shape);
  }
}
