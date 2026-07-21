/**
 * Diagram-agnostic "animated event" support: an orb (token) that repeatedly travels along an
 * already-rendered SVG line, plus the frontmatter spec (`animate: events: [...]`) that lets any
 * diagram type opt lines into that animation without new diagram syntax.
 *
 * The animation core is pure DOM + rAF and works on any SVGGeometryElement (`<line>`, `<path>`,
 * ...) — it only needs `getTotalLength()`/`getPointAtLength()`. Each diagram type supplies its
 * own notion of "which line does this event ride" by mapping the parsed spec onto its rendered
 * elements (see `resolveAnimatedEventTarget`); the sequence diagram was the first adopter, the
 * distSys diagram shares the same core via its own attach wrapper.
 */

export interface TokenAnimationController {
  play(): void;
  pause(): void;
  stop(): void;
  /** Shows/hides the connecting line without affecting the orb traveling along it. */
  setPathVisible(visible: boolean): void;
  /** Flips the current line visibility; returns the new state. */
  togglePath(): boolean;
}

/** Returned when the target line or token group is missing from the DOM; nothing to animate. */
export const NOOP_TOKEN_ANIMATION: TokenAnimationController = {
  play: () => undefined,
  pause: () => undefined,
  stop: () => undefined,
  setPathVisible: () => undefined,
  togglePath: () => false,
};

export interface AttachTokenAnimationOptions {
  /** The already-rendered line the orb travels along, live in the page. */
  path: SVGGeometryElement;
  /** The `<g>` the orb is appended to (kept separate so orbs render above other content). */
  tokenGroup: SVGGElement;
  /** Milliseconds between one orb arriving and the next one departing. */
  interval: number;
  /** Milliseconds an orb takes to travel from one end of the line to the other. */
  travelDuration: number;
  tokenRadius: number;
  tokenClass: string;
  /** Whether the connecting line is visible on attach. The orb travels along it either way. */
  pathVisible: boolean;
}

type Phase = 'traveling' | 'waiting';

/**
 * Drives a single event orb, one at a time, along an already-rendered SVG line: travel, then a
 * gap, then the next orb departs. No dependency on mermaid internals beyond the two elements
 * it's given, so it works regardless of which diagram type rendered them.
 */
export function attachTokenAnimation(
  options: AttachTokenAnimationOptions
): TokenAnimationController {
  const { path, tokenGroup, interval, travelDuration, tokenRadius, tokenClass, pathVisible } =
    options;

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

// ---------------------------------------------------------------------------------------------
// The `animate:` frontmatter spec
// ---------------------------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TRAVEL_DURATION_MS = 900;
const DEFAULT_TOKEN_RADIUS = 7;
const DEFAULT_TOKEN_FILL = '#FF6B6B';
const DEFAULT_TOKEN_STROKE = '#B33333';

const HEX_COLOR_RE = /^#([\dA-Fa-f]{3}|[\dA-Fa-f]{6})$/;

/** How an event names the line it rides. All filters are ANDed; `nth` (1-based) picks among
 * whatever the other filters leave when they alone can't narrow it to one line. */
export interface AnimatedEventOn {
  from?: string;
  to?: string;
  /** The line's rendered label text (e.g. the sequence message text), exact match. */
  message?: string;
  nth?: number;
}

/** One payload field of an event, parsed from UML member notation (`+username: string`). */
export interface AnimatedEventField {
  /** UML visibility marker: `+` public, `-` private, `#` protected, `~` package. */
  visibility?: '+' | '-' | '#' | '~';
  name: string;
  type?: string;
}

export interface AnimatedEventSpec {
  id: string;
  color?: string;
  interval: number;
  travelDuration: number;
  showPath: boolean;
  /** The pathways this event travels — one entry per line it rides. Declared in frontmatter as
   * either a single mapping or a list of them (an event fanning out to several consumers is
   * still one event; the payload doesn't change per consumer). */
  on: AnimatedEventOn[];
  /** Payload fields declared in the `animate.fields` block (keyed by this event's id). */
  fields: AnimatedEventField[];
}

/** One line a diagram type offers up for animation: a stable id (the diagram derives its DOM
 * selector from it), the endpoints, and the rendered label text. */
export interface AnimatedEventTarget {
  id: string;
  from?: string;
  to?: string;
  text: string;
}

const requireOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`animate frontmatter requires \`${field}\` to be a non-empty string when set`);
  }
  return value;
};

/** `+username: string` → visibility `+`, name `username`, type `string`. Visibility and type
 * are both optional (`username` alone is valid); anything else is a loud error. */
const UML_FIELD_RE = /^([#+~-])?\s*([A-Z_a-z]\w*)\s*(?::\s*(\S[^]*?))?\s*$/;

const parseUmlField = (raw: unknown, path: string): AnimatedEventField => {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      `animate frontmatter requires \`${path}\` to be a UML member string like \`+username: string\``
    );
  }
  const match = UML_FIELD_RE.exec(raw.trim());
  if (!match) {
    throw new Error(
      `animate frontmatter: \`${path}\` \`${raw}\` is not valid UML member notation ` +
        '(expected `[+|-|#|~]name[: type]`, e.g. `+username: string`)'
    );
  }
  const [, visibility, name, type] = match;
  return {
    visibility: visibility as AnimatedEventField['visibility'],
    name,
    type,
  };
};

/** Parses the `animate.fields` block — a mapping of event id to a list of UML member strings —
 * onto the already-parsed events. Kept separate from `events` so payload shape can live apart
 * from routing/animation concerns, tied together only by the event id. */
const applyFieldsBlock = (raw: unknown, events: AnimatedEventSpec[]): void => {
  if (raw === undefined) {
    return;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'animate frontmatter requires `fields` to be a mapping of event id to a list of UML ' +
        'member strings, e.g.\nfields:\n  user-created:\n    - "+username: string"'
    );
  }
  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const [eventId, rawFields] of Object.entries(raw)) {
    const event = eventsById.get(eventId);
    if (!event) {
      throw new Error(
        `animate frontmatter: \`fields.${eventId}\` references no declared event ` +
          `(known ids: ${events.map((e) => `\`${e.id}\``).join(', ')})`
      );
    }
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      throw new Error(
        `animate frontmatter requires \`fields.${eventId}\` to be a non-empty list of UML member strings`
      );
    }
    event.fields = rawFields.map((rawField, i) =>
      parseUmlField(rawField, `fields.${eventId}[${i}]`)
    );
  }
};

/**
 * Validates the raw `animate:` frontmatter value into a list of event specs, failing loudly
 * (with the offending field's path) rather than guessing — same philosophy as the distsys
 * parser, since a silently mis-parsed spec would just look like a missing animation.
 */
export function parseAnimateSpec(raw: unknown): AnimatedEventSpec[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'animate frontmatter must be a mapping with an `events` list, e.g.\n' +
        'animate:\n  events:\n    - on: { from: api, to: hub }'
    );
  }
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('animate frontmatter requires `events` to be a non-empty list');
  }

  const seenIds = new Set<string>();
  const parsed = events.map((rawEvent, index) => {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      throw new Error(`animate frontmatter requires \`events[${index}]\` to be a mapping`);
    }
    const node = rawEvent as Record<string, unknown>;

    const id = requireOptionalString(node.id, `events[${index}].id`) ?? `event-${index}`;
    if (seenIds.has(id)) {
      throw new Error(
        `animate frontmatter requires every \`events[].id\` to be unique (duplicate: \`${id}\`)`
      );
    }
    seenIds.add(id);

    const color = requireOptionalString(node.color, `events[${index}].color`);
    if (color?.startsWith('#') && !HEX_COLOR_RE.test(color)) {
      throw new Error(
        `animate frontmatter: \`events[${index}].color\` \`${color}\` is not a valid hex color ` +
          '(expected `#rgb` or `#rrggbb`)'
      );
    }

    const interval =
      node.interval === undefined || node.interval === null
        ? DEFAULT_INTERVAL_MS
        : Number(node.interval);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error(
        `animate frontmatter requires \`events[${index}].interval\` to be a positive number of milliseconds`
      );
    }

    const travelDuration =
      node.travelDuration === undefined || node.travelDuration === null
        ? DEFAULT_TRAVEL_DURATION_MS
        : Number(node.travelDuration);
    if (!Number.isFinite(travelDuration) || travelDuration <= 0) {
      throw new Error(
        `animate frontmatter requires \`events[${index}].travelDuration\` to be a positive number of milliseconds`
      );
    }

    if (node.showPath !== undefined && typeof node.showPath !== 'boolean') {
      throw new Error(`animate frontmatter requires \`events[${index}].showPath\` to be a boolean`);
    }

    // `on` is one pathway mapping, or a list of them for an event that travels several lines
    // (produced once, consumed by several services). Every pathway shares the event's color,
    // timing, and payload fields — the event is the identity, the pathways are just hops.
    const on = node.on;
    const rawPathways = Array.isArray(on) ? on : [on];
    if (Array.isArray(on) && on.length === 0) {
      throw new Error(
        `animate frontmatter requires \`events[${index}].on\` to be a non-empty list when given as a list`
      );
    }
    const pathways = rawPathways.map((rawPathway, onIndex) => {
      // Error paths keep the plain `on.` form when the user wrote a single mapping, so the
      // message matches what they typed.
      const path = Array.isArray(on) ? `events[${index}].on[${onIndex}]` : `events[${index}].on`;
      if (!rawPathway || typeof rawPathway !== 'object' || Array.isArray(rawPathway)) {
        throw new Error(
          `animate frontmatter requires \`${path}\` to be a mapping naming the line ` +
            'to animate, e.g. `{ from: api, to: hub }`'
        );
      }
      const onNode = rawPathway as Record<string, unknown>;
      const from = requireOptionalString(onNode.from, `${path}.from`);
      const to = requireOptionalString(onNode.to, `${path}.to`);
      const message = requireOptionalString(onNode.message, `${path}.message`);
      let nth: number | undefined;
      if (onNode.nth !== undefined && onNode.nth !== null) {
        nth = Number(onNode.nth);
        if (!Number.isInteger(nth) || nth < 1) {
          throw new Error(
            `animate frontmatter requires \`${path}.nth\` to be a positive integer (1-based)`
          );
        }
      }
      if (from === undefined && to === undefined && message === undefined && nth === undefined) {
        throw new Error(
          `animate frontmatter requires \`${path}\` to set at least one of ` +
            '`from`, `to`, `message`, `nth`'
        );
      }
      return { from, to, message, nth };
    });

    return {
      id,
      color,
      interval,
      travelDuration,
      showPath: node.showPath ?? true,
      on: pathways,
      fields: [],
    };
  });

  applyFieldsBlock((raw as { fields?: unknown }).fields, parsed);
  return parsed;
}

const describeTargets = (targets: AnimatedEventTarget[]): string =>
  targets.map((t) => `\`${t.from ?? '?'} -> ${t.to ?? '?'}: ${t.text}\``).join(', ');

/**
 * Picks the one line a single pathway rides from the diagram's candidate list. Filters are
 * applied in confidence order — from/to, then exact label text, then `nth` as the last-resort
 * tiebreak — and ambiguity is an error (listing the contenders) rather than a silent
 * first-match, so an orb can never quietly animate the wrong line.
 */
const resolveOnePathway = (
  label: string,
  pathway: AnimatedEventOn,
  targets: AnimatedEventTarget[]
): AnimatedEventTarget => {
  const { from, to, message, nth } = pathway;
  let matches = targets;
  if (from !== undefined) {
    matches = matches.filter((t) => t.from === from);
  }
  if (to !== undefined) {
    matches = matches.filter((t) => t.to === to);
  }
  if (message !== undefined) {
    matches = matches.filter((t) => t.text.trim() === message.trim());
  }

  if (matches.length === 0) {
    throw new Error(
      `animate: ${label} matched no line ` +
        `(available: ${targets.length ? describeTargets(targets) : 'none'})`
    );
  }
  if (nth !== undefined) {
    if (nth > matches.length) {
      throw new Error(
        `animate: ${label} asks for \`nth: ${nth}\` but only ${matches.length} ` +
          `line(s) match: ${describeTargets(matches)}`
      );
    }
    return matches[nth - 1];
  }
  if (matches.length > 1) {
    throw new Error(
      `animate: ${label} matches ${matches.length} lines: ` +
        `${describeTargets(matches)} — add \`message:\` (the line's label) or \`nth:\` to pick one`
    );
  }
  return matches[0];
};

/**
 * Resolves every pathway of an event to its line, in declaration order. Multi-pathway events
 * get the pathway index in any error — "pathway 2 (on[1])" — so the offending entry is
 * findable at a glance.
 */
export function resolveAnimatedEventTargets(
  event: AnimatedEventSpec,
  targets: AnimatedEventTarget[]
): AnimatedEventTarget[] {
  return event.on.map((pathway, i) => {
    const label =
      event.on.length === 1
        ? `event \`${event.id}\``
        : `event \`${event.id}\` pathway ${i + 1} (\`on[${i}]\`)`;
    return resolveOnePathway(label, pathway, targets);
  });
}

export interface BoundAnimatedEvent {
  event: AnimatedEventSpec;
  /** CSS selectors, scoped to the rendered svg, for the lines this event rides — one per
   * pathway, in `on` declaration order. */
  selectors: string[];
}

/** Legend data exposed on `svgEl.distSys.legend` so host pages can describe the streams —
 * event id, the color the orb actually renders with, and any declared payload fields. */
export interface AnimatedEventLegendEntry {
  id: string;
  color: string;
  fields: AnimatedEventField[];
}

/**
 * Attaches every resolved event's animation to the live (inserted-into-the-page) SVG and
 * exposes the same `svgEl.distSys` aggregate controller the distsys diagram uses — play/pause/
 * stop/setPathVisible/togglePath across all streams at once, plus `.events['id[pathwayIndex]']`
 * for one stream (keyed the same way distsys keys its per-route controllers) — so existing
 * hosts (like the render:html control bar) work unchanged.
 *
 * Orb and line colors are set inline rather than via stylesheet classes, because the host
 * diagram's `<style>` block knows nothing about animation tokens.
 */
export function attachAnimatedEvents(element: Element, bound: BoundAnimatedEvent[]): void {
  const svgEl = (
    element.tagName === 'svg' ? element : element.querySelector('svg')
  ) as SVGSVGElement | null;
  if (!svgEl) {
    return;
  }
  const controllersById: Record<string, TokenAnimationController> = {};
  bound.forEach(({ event, selectors }) => {
    selectors.forEach((selector, pathwayIndex) => {
      const key = `${event.id}[${pathwayIndex}]`;
      const line = svgEl.querySelector<SVGGeometryElement>(selector);
      if (!line) {
        controllersById[key] = NOOP_TOKEN_ANIMATION;
        return;
      }
      if (event.color) {
        line.style.stroke = event.color;
      }
      const tokenGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      tokenGroup.setAttribute('class', 'animated-event-tokens');
      tokenGroup.style.fill = event.color ?? DEFAULT_TOKEN_FILL;
      tokenGroup.style.stroke = event.color ?? DEFAULT_TOKEN_STROKE;
      svgEl.appendChild(tokenGroup);
      controllersById[key] = attachTokenAnimation({
        path: line,
        tokenGroup,
        interval: event.interval,
        travelDuration: event.travelDuration,
        tokenRadius: DEFAULT_TOKEN_RADIUS,
        tokenClass: 'animated-event-token',
        pathVisible: event.showPath,
      });
    });
  });

  // Everything a host page needs to render a legend for the streams: one entry per event, in
  // declaration order, with the color already resolved to what the orb actually uses.
  const legend: AnimatedEventLegendEntry[] = bound.map(({ event }) => ({
    id: event.id,
    color: event.color ?? DEFAULT_TOKEN_FILL,
    fields: event.fields,
  }));

  const controllerList = Object.values(controllersById);
  const aggregate: TokenAnimationController & {
    events: typeof controllersById;
    legend: AnimatedEventLegendEntry[];
  } = {
    play() {
      controllerList.forEach((c) => c.play());
    },
    pause() {
      controllerList.forEach((c) => c.pause());
    },
    stop() {
      controllerList.forEach((c) => c.stop());
    },
    setPathVisible(visible: boolean) {
      controllerList.forEach((c) => c.setPathVisible(visible));
    },
    togglePath() {
      const nowVisible = controllerList[0] ? controllerList[0].togglePath() : false;
      controllerList.slice(1).forEach((c) => c.setPathVisible(nowVisible));
      return nowVisible;
    },
    events: controllersById,
    legend,
  };
  (svgEl as unknown as { distSys: typeof aggregate }).distSys = aggregate;
  aggregate.play();
}
