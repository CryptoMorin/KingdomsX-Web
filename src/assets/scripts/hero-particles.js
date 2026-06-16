import { tsParticles } from "@tsparticles/engine";
import { loadFirePreset } from "@tsparticles/preset-fire";
import { loadEmittersPlugin } from "@tsparticles/plugin-emitters";
import { loadEmittersShapeSquare } from "@tsparticles/plugin-emitters-shape-square";
import { loadRotateUpdater } from "@tsparticles/updater-rotate";
import { loadWobbleUpdater } from "@tsparticles/updater-wobble";

const containerId = "hero-particles";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const resizeDebounceMs = 250;
const particleLimits = {
  desktopReferenceArea: 1366 * 768,
  max: 50,
  min: 20,
};
const particleFillColors = ["#ffdf7a", "#fbb03b", "#ff7417", "#c23010"];
const flameColors = {
  body: "rgba(255, 151, 38, 0.8)",
};

let particlesReady;
let particlesContainer;
let resizeTimer;
let visibilityObserver;
let heroInView = true;

const getParticleLimit = () => {
  const viewportArea = window.innerWidth * window.innerHeight;
  const scaledLimit = particleLimits.max * Math.sqrt(viewportArea / particleLimits.desktopReferenceArea);

  return Math.round(Math.min(particleLimits.max, Math.max(particleLimits.min, scaledLimit)));
};

const dividerEmitterPoints = [
  { x: 6, y: 88.5, width: 12, delay: 0.82 },
  { x: 18, y: 90.5, width: 14, delay: 0.72 },
  { x: 34, y: 94, width: 16, delay: 0.62 },
  { x: 50, y: 94.5, width: 18, delay: 0.58 },
  { x: 66, y: 94, width: 16, delay: 0.62 },
  { x: 82, y: 90.5, width: 14, delay: 0.72 },
  { x: 94, y: 88.5, width: 12, delay: 0.82 },
];

const createDividerEmitter = ({ x, y, width, delay }) => ({
  autoPlay: true,
  direction: "top",
  fill: true,
  startCount: 0,
  life: {
    count: 0,
  },
  position: {
    x,
    y,
  },
  rate: {
    delay,
    quantity: 1,
  },
  size: {
    width,
    height: 0,
    mode: "percent",
  },
});

const dividerEmitters = dividerEmitterPoints.map(createDividerEmitter);

const drawOuterFlame = (context, radius) => {
  context.beginPath();
  context.moveTo(0, -radius * 1.4);
  context.bezierCurveTo(radius * 0.7, -radius * 0.82, radius * 0.74, radius * 0.18, radius * 0.22, radius * 0.82);
  context.bezierCurveTo(radius * 0.08, radius, -radius * 0.08, radius, -radius * 0.22, radius * 0.82);
  context.bezierCurveTo(-radius * 0.74, radius * 0.18, -radius * 0.7, -radius * 0.82, 0, -radius * 1.4);
  context.fill();
};

const flameShape = {
  draw({ context }) {
    context.moveTo(0, 0);
    context.lineTo(0, 0);
  },
  afterDraw({ context, opacity, radius }) {
    const previousAlpha = context.globalAlpha;
    const previousFill = context.fillStyle;

    context.globalAlpha = previousAlpha * opacity;
    context.fillStyle = flameColors.body;
    drawOuterFlame(context, radius);

    context.globalAlpha = previousAlpha;
    context.fillStyle = previousFill;
  },
  getSidesCount() {
    return 1;
  },
};

const loadFlameShape = async (engine) => {
  await engine.pluginManager.register((currentEngine) => {
    currentEngine.pluginManager.addShape(["flame"], () => Promise.resolve(flameShape));
  });
};

const loadParticles = async () => {
  particlesReady ??= Promise.all([
    loadFirePreset(tsParticles),
    loadEmittersPlugin(tsParticles),
    loadEmittersShapeSquare(tsParticles),
    loadFlameShape(tsParticles),
    loadRotateUpdater(tsParticles),
    loadWobbleUpdater(tsParticles),
  ]);

  await particlesReady;
};

const destroyParticles = () => {
  particlesContainer?.destroy();
  particlesContainer = undefined;
};

const updateParticlePlayback = () => {
  if (!particlesContainer) {
    return;
  }

  if (heroInView) {
    particlesContainer.play();
  } else {
    particlesContainer.pause();
  }
};

const observeHeroVisibility = (host) => {
  visibilityObserver?.disconnect();

  if (!("IntersectionObserver" in window)) {
    heroInView = true;
    return;
  }

  const hero = host.closest(".hero") ?? host;

  visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      heroInView = entry.isIntersecting;
      updateParticlePlayback();
    },
    {
      rootMargin: "8% 0px",
      threshold: 0,
    },
  );

  visibilityObserver.observe(hero);
};

const stopObservingHeroVisibility = () => {
  visibilityObserver?.disconnect();
  visibilityObserver = undefined;
  heroInView = true;
};

const createParticleOptions = () => ({
  preset: "fire",
  autoPlay: true,
  background: {
    color: {
      value: "transparent",
    },
    image: "none",
  },
  detectRetina: false,
  fpsLimit: 45,
  fullScreen: {
    enable: false,
  },
  interactivity: {
    detectsOn: "window",
    events: {
      onClick: {
        enable: false,
      },
      onHover: {
        enable: false,
      },
      resize: {
        enable: true,
      },
    },
  },
  particles: {
    number: {
      value: 0,
      limit: {
        value: getParticleLimit(),
        mode: "wait",
      },
      density: {
        enable: false,
      },
    },
    opacity: {
      value: {
        min: 0.2,
        max: 0.6,
      },
      animation: {
        enable: true,
        speed: 0.18,
        sync: false,
        startValue: "random",
        destroy: "none",
      },
    },
    paint: {
      fill: {
        color: {
          value: particleFillColors,
        },
        enable: false,
        opacity: {
          min: 0.4,
          max: 0.9,
        },
      },
    },
    shape: {
      type: "flame",
    },
    size: {
      value: {
        min: 1.2,
        max: 3.2,
      },
      animation: {
        enable: false,
        speed: 0,
        sync: false,
        startValue: "random",
        destroy: "none",
      },
    },
    move: {
      enable: true,
      direction: {
        min: 263,
        max: 277,
      },
      drift: {
        min: -0.25,
        max: 0.55,
      },
      random: true,
      speed: {
        min: 1.4,
        max: 4,
      },
      straight: false,
      outModes: {
        default: "destroy",
        bottom: "destroy",
        left: "destroy",
        right: "destroy",
        top: "destroy",
      },
    },
    rotate: {
      value: {
        min: 345,
        max: 375,
      },
      direction: "random",
      path: true,
      animation: {
        enable: true,
        speed: {
          min: 1,
          max: 5,
        },
        sync: false,
      },
    },
    wobble: {
      enable: true,
      distance: {
        min: 6,
        max: 18,
      },
      speed: {
        angle: {
          min: 10,
          max: 24,
        },
        move: {
          min: 0.45,
          max: 1.2,
        },
      },
    },
  },
  emitters: dividerEmitters,
});

const initHeroParticles = async () => {
  const host = document.getElementById(containerId);

  if (!host || reducedMotionQuery.matches) {
    stopObservingHeroVisibility();
    destroyParticles();
    return;
  }

  observeHeroVisibility(host);
  await loadParticles();
  destroyParticles();

  particlesContainer = await tsParticles.load({
    id: containerId,
    options: createParticleOptions(),
  });
  updateParticlePlayback();
};

initHeroParticles();
reducedMotionQuery.addEventListener("change", initHeroParticles);
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(initHeroParticles, resizeDebounceMs);
});
