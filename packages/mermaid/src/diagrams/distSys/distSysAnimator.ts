export interface DistSysAnimationController {
  play(): void;
  pause(): void;
  stop(): void;
  /** Shows/hides the connecting line without affecting the orb traveling along it. */
  setPathVisible(visible: boolean): void;
  /** Flips the current line visibility; returns the new state. */
  togglePath(): boolean;
}

export interface AttachDistSysAnimationOptions {
  /** The live (inserted-into-the-page) root SVG element. */
  svg: SVGSVGElement;
  /** CSS selector, scoped to `svg`, for the `<path>` the orb travels along. */
  pathSelector: string;
  /** CSS selector, scoped to `svg`, for the `<g>` the orb is appended to. */
  tokenGroupSelector: string;
  /** Milliseconds the orb waits at the hub before the next one departs the service. */
  interval: number;
  /** Milliseconds an orb takes to travel from one end of the path to the other. */
  travelDuration: number;
  tokenRadius: number;
  tokenClass: string;
  /** Whether the connecting line is visible on attach. The orb travels along it either way. */
  pathVisible: boolean;
}

type Phase = 'traveling' | 'waiting';

const NOOP_CONTROLLER: DistSysAnimationController = {
  play() {
    /* path or token group missing from the DOM; nothing to animate */
  },
  pause() {},
  stop() {},
  setPathVisible() {},
  togglePath() {
    return false;
  },
};

/**
 * Drives a single "event" orb, one at a time, along an already-rendered SVG path: travel,
 * then a gap, then the next orb departs. Pure DOM + rAF — no dependency on mermaid internals
 * beyond the two elements it's given, so it works regardless of how the caller mounted the SVG.
 */
export function attachDistSysAnimation(
  options: AttachDistSysAnimationOptions
): DistSysAnimationController {
  const {
    svg,
    pathSelector,
    tokenGroupSelector,
    interval,
    travelDuration,
    tokenRadius,
    tokenClass,
    pathVisible,
  } = options;

  const path = svg.querySelector<SVGPathElement>(pathSelector);
  const tokenGroup = svg.querySelector<SVGGElement>(tokenGroupSelector);
  if (!path || !tokenGroup) {
    return NOOP_CONTROLLER;
  }

  // The line is purely visual — hiding it never touches the path's geometry, so
  // getPointAtLength keeps working and the orb keeps flowing along the same route.
  let lineVisible = pathVisible;
  path.style.visibility = lineVisible ? '' : 'hidden';

  const totalLength = path.getTotalLength();

  let currentTokenEl: SVGCircleElement | null = null;
  let phase: Phase = 'waiting';
  // performance.now() timestamp the current phase began; elapsed time within a phase is
  // always measured from here, so pausing/resuming only has to shift this one number.
  let phaseStart = 0;
  let playing = false;
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
    currentTokenEl = el;
  };

  const tick = (now: number) => {
    if (phase === 'traveling' && currentTokenEl) {
      const t = (now - phaseStart) / travelDuration;
      if (t >= 1) {
        currentTokenEl.remove();
        currentTokenEl = null;
        phase = 'waiting';
        phaseStart = now;
      } else {
        const point = path.getPointAtLength(t * totalLength);
        currentTokenEl.setAttribute('cx', String(point.x));
        currentTokenEl.setAttribute('cy', String(point.y));
      }
    } else if (phase === 'waiting' && now - phaseStart >= interval) {
      spawnToken();
      phase = 'traveling';
      phaseStart = now;
    }
    rafId = requestAnimationFrame(tick);
  };

  const play = () => {
    if (playing) {
      return;
    }
    playing = true;
    if (pausedAt !== undefined) {
      // Shift the current phase's clock forward by however long we were paused, so it
      // resumes from where it visually stopped instead of jumping ahead.
      phaseStart += performance.now() - pausedAt;
      pausedAt = undefined;
    } else {
      spawnToken();
      phase = 'traveling';
      phaseStart = performance.now();
    }
    rafId = requestAnimationFrame(tick);
  };

  const pause = () => {
    if (!playing) {
      return;
    }
    playing = false;
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    pausedAt = performance.now();
  };

  const stop = () => {
    pause();
    pausedAt = undefined;
    phase = 'waiting';
    if (currentTokenEl) {
      currentTokenEl.remove();
      currentTokenEl = null;
    }
  };

  const setPathVisible = (visible: boolean) => {
    lineVisible = visible;
    path.style.visibility = lineVisible ? '' : 'hidden';
  };

  const togglePath = () => {
    setPathVisible(!lineVisible);
    return lineVisible;
  };

  return { play, pause, stop, setPathVisible, togglePath };
}
