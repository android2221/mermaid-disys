export interface DistSysAnimationController {
  play(): void;
  pause(): void;
  stop(): void;
}

export interface AttachDistSysAnimationOptions {
  /** The live (inserted-into-the-page) root SVG element. */
  svg: SVGSVGElement;
  /** CSS selector, scoped to `svg`, for the `<path>` the orb travels along. */
  pathSelector: string;
  /** CSS selector, scoped to `svg`, for the `<g>` that newly-spawned orbs are appended to. */
  tokenGroupSelector: string;
  /** Milliseconds between successive orbs entering the path. */
  interval: number;
  /** Milliseconds an orb takes to travel from one end of the path to the other. */
  travelDuration: number;
  tokenRadius: number;
  tokenClass: string;
}

interface ActiveToken {
  el: SVGCircleElement;
  start: number;
}

const NOOP_CONTROLLER: DistSysAnimationController = {
  play() {
    /* path or token group missing from the DOM; nothing to animate */
  },
  pause() {},
  stop() {},
};

/**
 * Drives a repeating stream of "event" orbs along an already-rendered SVG path.
 * Pure DOM + rAF — no dependency on mermaid internals beyond the two elements it's given,
 * so it works regardless of how the caller chose to mount the SVG into the page.
 */
export function attachDistSysAnimation(
  options: AttachDistSysAnimationOptions
): DistSysAnimationController {
  const { svg, pathSelector, tokenGroupSelector, interval, travelDuration, tokenRadius, tokenClass } =
    options;

  const path = svg.querySelector<SVGPathElement>(pathSelector);
  const tokenGroup = svg.querySelector<SVGGElement>(tokenGroupSelector);
  if (!path || !tokenGroup) {
    return NOOP_CONTROLLER;
  }

  const totalLength = path.getTotalLength();
  const activeTokens = new Set<ActiveToken>();

  let spawnTimer: ReturnType<typeof setInterval> | undefined;
  let rafId: number | undefined;
  let pausedAt: number | undefined;

  const spawnToken = () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', String(tokenRadius));
    el.setAttribute('class', tokenClass);
    const origin = path.getPointAtLength(0);
    el.setAttribute('cx', String(origin.x));
    el.setAttribute('cy', String(origin.y));
    tokenGroup.appendChild(el);
    activeTokens.add({ el, start: performance.now() });
  };

  const tick = (now: number) => {
    activeTokens.forEach((token) => {
      const t = (now - token.start) / travelDuration;
      if (t >= 1) {
        token.el.remove();
        activeTokens.delete(token);
        return;
      }
      const point = path.getPointAtLength(t * totalLength);
      token.el.setAttribute('cx', String(point.x));
      token.el.setAttribute('cy', String(point.y));
    });
    rafId = requestAnimationFrame(tick);
  };

  const play = () => {
    if (spawnTimer !== undefined) {
      return; // already playing
    }
    if (pausedAt !== undefined) {
      // Shift every in-flight token's clock forward by however long we were paused,
      // so it resumes from where it visually stopped instead of jumping ahead.
      const delta = performance.now() - pausedAt;
      activeTokens.forEach((token) => {
        token.start += delta;
      });
      pausedAt = undefined;
    } else {
      spawnToken();
    }
    spawnTimer = setInterval(spawnToken, interval);
    rafId = requestAnimationFrame(tick);
  };

  const pause = () => {
    if (spawnTimer !== undefined) {
      clearInterval(spawnTimer);
      spawnTimer = undefined;
    }
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
      pausedAt = performance.now();
    }
  };

  const stop = () => {
    pause();
    pausedAt = undefined;
    activeTokens.forEach((token) => token.el.remove());
    activeTokens.clear();
  };

  return { play, pause, stop };
}
