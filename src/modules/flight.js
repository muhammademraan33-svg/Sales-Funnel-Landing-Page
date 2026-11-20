// "Learn to fly": one real lesson clip presented like an Instagram story,
// with four chapters. The progress bars, the label and the list of moves all
// follow the footage; tapping a move (or either side of the film) jumps to it.

import { $, $$ } from '../lib/dom.js';
import { loadVideo } from './videos.js';

export function initFlight() {
  const story = $('[data-story]');
  if (!story) return;

  const video = $('[data-story-video]', story);
  const chapters = story.dataset.chapters.split(',').map(Number);
  const fallbackDuration = Number(story.dataset.duration);
  const bars = $$('.story__bars b', story);
  const label = $('[data-story-label]', story);
  const moves = $$('[data-move]');
  const names = moves.map((move) => $('strong', move).textContent);

  let current = -1;
  let frame = 0;

  const chapterAt = (time) => {
    let index = 0;
    chapters.forEach((start, i) => {
      if (time >= start - 0.02) index = i;
    });
    return index;
  };

  function render() {
    const time = video.currentTime || 0;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration;
    const index = chapterAt(time);

    bars.forEach((bar, i) => {
      const start = chapters[i];
      const end = chapters[i + 1] ?? duration;
      const progress = i < index ? 1 : i > index ? 0 : Math.min(1, Math.max(0, (time - start) / (end - start)));
      bar.style.transform = `scaleX(${progress})`;
      moves[i]?.style.setProperty('--p', i === index ? progress : 0);
    });

    if (index !== current) {
      current = index;
      label.textContent = names[index];
      moves.forEach((move, i) => {
        move.classList.toggle('is-active', i === index);
        if (i === index) move.setAttribute('aria-current', 'step');
        else move.removeAttribute('aria-current');
      });
    }
  }

  const loop = () => {
    render();
    frame = requestAnimationFrame(loop);
  };
  video.addEventListener('play', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  });
  video.addEventListener('pause', () => cancelAnimationFrame(frame));
  video.addEventListener('seeked', render);

  function seek(index) {
    const target = chapters[(index + chapters.length) % chapters.length] + 0.03;
    loadVideo(video);
    const jump = () => {
      video.currentTime = target;
      video.play().catch(() => {});
      render();
    };
    if (video.readyState >= 1) jump();
    else video.addEventListener('loadedmetadata', jump, { once: true });
  }

  moves.forEach((move, i) => move.addEventListener('click', () => seek(i)));
  $('[data-story-prev]', story)?.addEventListener('click', () => seek(Math.max(current, 0) - 1));
  $('[data-story-next]', story)?.addEventListener('click', () => seek(Math.max(current, 0) + 1));

  render();
}
