// Clips below the fold load only when the visitor gets near them, and play
// only while they are on screen. The page starts light and stays cool.

import { $$ } from '../lib/dom.js';
import { reduceMotion } from '../lib/motion.js';

const saveData = Boolean(navigator.connection?.saveData);

/** Attaches the real file to a lazily loaded <video data-src>. */
export function loadVideo(video) {
  if (!video.dataset.src) return;
  video.src = video.dataset.src;
  delete video.dataset.src;
  video.load();
}

export function initLazyVideos() {
  const videos = $$('[data-lazy-video]');
  if (!videos.length) return;

  // Reduced motion or Data Saver: still frames only. (The lesson film can
  // still be started by hand from its chapter buttons.)
  if (reduceMotion || saveData) return;

  if (!('IntersectionObserver' in window)) {
    videos.forEach(loadVideo);
    return;
  }

  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        loadVideo(entry.target);
        nearby.unobserve(entry.target);
      }
    },
    { rootMargin: '75% 40%' },
  );

  const onScreen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target;
        if (entry.isIntersecting) {
          loadVideo(video);
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    },
    { threshold: 0.15 },
  );

  for (const video of videos) {
    video.muted = true;
    nearby.observe(video);
    onScreen.observe(video);
  }
}
