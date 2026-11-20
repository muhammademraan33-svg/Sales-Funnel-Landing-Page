// Cuts, grades and compresses the source footage into the web-ready files in
// public/media. Every clip is real footage published by @miami.aquaexperience;
// the edit list below records which post and time range each shot comes from.
//
// Usage:  node scripts/build-media.mjs            (all outputs)
//         node scripts/build-media.mjs hero wake  (only the named outputs)
//
// Requires ffmpeg on PATH and the original files in _source/instagram
// (named <post-code>.mp4 / <post-code>_NN.jpg).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '_source', 'instagram');
const OUT_VIDEO = path.join(ROOT, 'public', 'media', 'video');
const OUT_IMG = path.join(ROOT, 'public', 'media', 'img');
fs.mkdirSync(OUT_VIDEO, { recursive: true });
fs.mkdirSync(OUT_IMG, { recursive: true });

// Source posts (instagram.com/miami.aquaexperience/reel/<code>)
const EFOIL_SUNSET = 'DdH9CtbRC5m'; // "Ven y aprende a volar con nosotros" - eFoil lesson, sunset
const EFOIL_LIZ = 'DfzvpQBRmB6'; //    "Speed and control is everything"   - Liz on the eFoil
const WAKE = 'DdJk7drxqyr'; //         "Surfeando con delfines"            - wakesurf + dolphins
const ESURF = 'DfvVhHqRU24'; //        "probo el e-surf por primera vez"   - Awake Explore e-surf
const BROLL = 'DezQTtXRhPt'; //        "Deportes que te hacen mas cool"    - b-roll inserts
const CAROUSEL = 'DT0dmUqEdXN'; //     wakesurf sessions photo carousel

// A light, consistent grade: cooler violet shadows, warmer highlights, a touch
// more saturation. Kept subtle so skin tones and the real light stay natural.
const GRADE =
  'eq=contrast=1.07:saturation=1.16:gamma=0.97,' +
  'colorbalance=rs=0.03:gs=-0.03:bs=0.09:rm=0.03:gm=-0.02:bm=0.02:rh=0.07:gh=-0.01:bh=-0.02';

// Source footage is 30 fps. Slowing it to 80% lands exactly on 24 fps with
// every source frame shown once: smooth slow motion at a film frame rate.
const SLOW = 1.25;
const FPS = 24;

// Crops that remove burned-in captions / camera watermarks from the frame.
const CROP_BELOW_TOP_TEXT = (x) => `crop=568:1010:${x}:270`;

/**
 * Each output is a list of shots: [post, start, end, optionalCropFilter]
 * (times in seconds of the original, real-time clip).
 */
const VIDEOS = {
  // Opening film: the widest, most cinematic shots of both rides.
  hero: {
    sizes: [720, 540],
    shots: [
      [EFOIL_SUNSET, 29.45, 31.75], // eFoil, pink sunset, skyline
      [WAKE, 0.3, 2.6], //             wakesurf, dolphin in the wake, skyline
      [EFOIL_LIZ, 11.3, 14.0], //      Liz flying, tracking shot
      [WAKE, 19.6, 22.2], //           wakesurf spin
      [EFOIL_SUNSET, 0.8, 3.5], //     eFoil at blue hour
    ],
  },
  wake: {
    sizes: [720],
    shots: [
      [WAKE, 3.2, 5.8], //    close on the wave
      [WAKE, 12.6, 15.2], //  wide carve
      [BROLL, 13.3, 14.6], // tandem at sunset
      [WAKE, 9.0, 11.2], //   close, blue board
    ],
  },
  efoil: {
    sizes: [720],
    shots: [
      [EFOIL_LIZ, 3.2, 6.2], //    Liz, front follow-cam
      [ESURF, 22.0, 24.2], //      e-surf past the yacht
      [EFOIL_LIZ, 0.3, 2.5], //    low rear angle
      [EFOIL_LIZ, 14.6, 16.8], //  flying, carving down
    ],
  },
  // One real first lesson, start to finish, in four chapters.
  flight: {
    sizes: [720],
    chapters: true,
    shots: [
      [EFOIL_SUNSET, 10.75, 13.1], //  belly -> knees
      [EFOIL_SUNSET, 13.2, 16.25], //  knees -> feet
      [EFOIL_SUNSET, 16.45, 18.55], // standing, cruising
      [EFOIL_SUNSET, 19.2, 21.7], //   lift-off: flying on the foil
    ],
  },
  'reel-gopro': {
    sizes: [540],
    shots: [
      [BROLL, 9.95, 11.8, CROP_BELOW_TOP_TEXT(76)], //  wakesurf into the sun
      [BROLL, 15.8, 17.5, CROP_BELOW_TOP_TEXT(76)], //  eFoil into the sun
    ],
  },
  'reel-esurf': {
    sizes: [540],
    shots: [
      [ESURF, 16.45, 17.5, CROP_BELOW_TOP_TEXT(112)], // e-surf towards the skyline
      [ESURF, 17.75, 19.35, CROP_BELOW_TOP_TEXT(76)],
    ],
  },
  'reel-wake': {
    sizes: [540],
    shots: [[WAKE, 15.9, 17.5], [WAKE, 22.6, 23.8], [WAKE, 7.1, 8.6]],
  },
};

// Real photos from the wakesurf carousel -> [carousel index, output name]
const PHOTOS = [
  ['06', 'photo-neon-glasses'],
  ['17', 'photo-neon-board'],
  ['16', 'photo-crew'],
  ['13', 'photo-birthday'],
  ['09', 'photo-friends'],
  ['07', 'photo-board'],
  ['18', 'photo-float'],
  ['10', 'photo-dogs'],
];

function ffmpeg(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`ffmpeg failed for ${label}:\n${r.stderr}`);
    process.exit(1);
  }
}

function encodeVideo(name, spec) {
  for (const width of spec.sizes) {
    const height = Math.round((width * 16) / 9 / 2) * 2;
    const inputs = [];
    const chains = [];
    spec.shots.forEach(([post, start, end, crop], i) => {
      inputs.push('-ss', String(start), '-t', (end - start).toFixed(3), '-i', path.join(SRC, `${post}.mp4`));
      const steps = [
        `setpts=${SLOW}*(PTS-STARTPTS)`,
        crop,
        `scale=${width}:${height}:flags=lanczos`,
        'hqdn3d=2:2:4:4', // light denoise: the sources are already social-compressed
        GRADE,
        `fps=${FPS}`,
        'format=yuv420p',
        'setsar=1',
      ].filter(Boolean);
      chains.push(`[${i}:v]${steps.join(',')}[v${i}]`);
    });
    const concat = `${spec.shots.map((_, i) => `[v${i}]`).join('')}concat=n=${spec.shots.length}:v=1:a=0[out]`;
    const suffix = spec.sizes.length > 1 ? `-${width}` : '';
    const file = path.join(OUT_VIDEO, `${name}${suffix}.mp4`);
    const big = width >= 720;
    ffmpeg(
      [
        ...inputs,
        '-filter_complex', [...chains, concat].join(';'),
        '-map', '[out]', '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
        '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
        '-maxrate', big ? '1500k' : '900k', '-bufsize', big ? '3000k' : '1800k',
        '-g', String(FPS * 2), '-movflags', '+faststart',
        file,
      ],
      file,
    );
    const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
    console.log(`video  ${path.basename(file).padEnd(22)} ${width}x${height}  ${mb} MB`);

    // Poster = first frame, so the page paints instantly before the video loads.
    if (width === spec.sizes[0]) {
      const poster = path.join(OUT_IMG, `${name}-poster.webp`);
      ffmpeg(['-i', file, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '74', poster], poster);
      console.log(`poster ${path.basename(poster).padEnd(22)} ${(fs.statSync(poster).size / 1024).toFixed(0)} KB`);
    }
  }
  if (spec.chapters) {
    let t = 0;
    const marks = spec.shots.map(([, start, end]) => {
      const at = t;
      t += (end - start) * SLOW;
      return Number(at.toFixed(2));
    });
    console.log(`       chapters (s): ${marks.join(', ')}  total ${t.toFixed(2)}`);
  }
}

function encodePhoto([index, name]) {
  const src = path.join(SRC, `${CAROUSEL}_${index}.jpg`);
  const file = path.join(OUT_IMG, `${name}.webp`);
  ffmpeg(
    ['-i', src, '-vf', 'scale=960:1280:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1280', '-c:v', 'libwebp', '-quality', '78', file],
    file,
  );
  console.log(`photo  ${path.basename(file).padEnd(26)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

const only = process.argv.slice(2);
for (const [name, spec] of Object.entries(VIDEOS)) {
  if (only.length && !only.includes(name)) continue;
  encodeVideo(name, spec);
}
if (!only.length || only.includes('photos')) PHOTOS.forEach(encodePhoto);
