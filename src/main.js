import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/archivo/wdth-italic.css';
import '@fontsource/mr-dafoe/400.css';

import './styles/base.css';
import './styles/hero.css';
import './styles/sections.css';
import './styles/booking.css';

import { ScrollTrigger, startSmoothScroll } from './lib/motion.js';
import { initBooking, openBooking } from './modules/booking/index.js';
import { initChrome } from './modules/chrome.js';
import { initFlight } from './modules/flight.js';
import { initHero } from './modules/hero.js';
import { runPreloader } from './modules/preloader.js';
import { initMarquee, initSections } from './modules/sections.js';
import { initLazyVideos } from './modules/videos.js';

startSmoothScroll();

const hero = initHero();
initSections();
initFlight();
initLazyVideos();
initBooking();
initChrome({ openBooking });

// Anything measured from text waits for the real fonts.
(document.fonts?.ready ?? Promise.resolve()).then(() => {
  initMarquee();
  ScrollTrigger.refresh();
});
window.addEventListener('load', () => ScrollTrigger.refresh());

// Opening titles, then the hero's title sequence in step with the reveal.
runPreloader().then(() => hero.intro());
