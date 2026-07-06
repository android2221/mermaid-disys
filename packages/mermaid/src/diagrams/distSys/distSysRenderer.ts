import type { DrawDefinition, SVG } from '../../diagram-api/types.js';
import type { Diagram } from '../../Diagram.js';
import { selectSvgElement } from '../../rendering-util/selectSvgElement.js';
import { configureSvgSize } from '../../setupGraphViewbox.js';
import { attachDistSysAnimation, type DistSysAnimationController } from './distSysAnimator.js';
import type { DistSysDB } from './distSysDb.js';
import type { DistSysCall } from './distSysTypes.js';

const MARGIN_X = 60;
const MARGIN_Y = 36;
const HUB_HEIGHT = 48;
const HUB_OVERHANG_X = 24;
const MIN_HUB_WIDTH = 160;
const NODE_HEIGHT = 70;
const MIN_NODE_WIDTH = 120;
const NODE_TEXT_PADDING_X = 28;
const SERVICE_GAP_X = 48;
const GAP_Y = 90;
const LABEL_ROW_HEIGHT = 20;
const LABEL_TEXT_HALF_HEIGHT = 7;
const PARALLEL_OFFSET = 16;
const ROW_LINE_TO_LABEL_GAP = 14;
const ROW_SPACING = 32;
const CROSSING_LANE_GAP = 14;
const CROSSING_LANE_HEIGHT = 26;
const TOKEN_RADIUS = 7;
const TRAVEL_DURATION_MS = 900;

/** getBBox() only returns real measurements once the element is attached to a rendered
 * document — true here because mermaidAPI always inserts the svg into the page before
 * calling the renderer. Falls back to 0 (never shrinks below the width floors) otherwise. */
const measureWidth = (el: SVGGraphicsElement): number => {
  try {
    return el.getBBox().width;
  } catch {
    return 0;
  }
};

type Endpoint = { kind: 'hub' } | { kind: 'service'; index: number };

type ConnectorItem =
  | {
      kind: 'event';
      eventId: string;
      routeIndex: number;
      label: string;
      interval: number;
      showPath: boolean;
      color?: string;
      fromEnd: Endpoint;
      toEnd: Endpoint;
    }
  | { kind: 'call'; call: DistSysCall; fromEnd: Endpoint; toEnd: Endpoint };

/** Two connectors sharing the same pair of nodes (regardless of direction) share this key, so
 * they can be offset into parallel lines instead of drawing exactly on top of one another. */
const connectorKeyOf = (fromEnd: Endpoint, toEnd: Endpoint): string => {
  if (fromEnd.kind === 'hub' || toEnd.kind === 'hub') {
    const serviceEnd = fromEnd.kind === 'hub' ? toEnd : fromEnd;
    return `hub:${(serviceEnd as { index: number }).index}`;
  }
  const lo = Math.min(fromEnd.index, toEnd.index);
  const hi = Math.max(fromEnd.index, toEnd.index);
  return `pair:${lo}-${hi}`;
};

export const draw: DrawDefinition = (_text, id, _version, diagObj: Diagram) => {
  const db = diagObj.db as DistSysDB;
  db.setDiagramId(id);

  const services = db.getServices();
  const hub = db.getHub();
  const events = db.getEvents();
  const calls = db.getCalls();
  if (services.length === 0 || !hub || events.length === 0) {
    throw new Error('distsys diagram requires `services`, `hub`, and `events` blocks');
  }

  // The parser guarantees each route's from/to are known, distinct ids, so exactly one of the
  // two resolves to the hub (a hub<->service route) or neither does (a service<->service route).
  // Calls are always service<->service (the parser rejects a hub reference in `calls`).
  const resolveEndpoint = (refId: string): Endpoint => {
    if (refId === hub.id) {
      return { kind: 'hub' };
    }
    const index = services.findIndex((service) => service.id === refId);
    return { kind: 'service', index };
  };

  // Each event is declared once (id, label, interval, color) but can carry several routes — one
  // ConnectorItem per route, all sharing that event's styling and animation timing.
  const connectorItems: ConnectorItem[] = [
    ...events.flatMap((event) =>
      event.routes.map(
        (route, routeIndex): ConnectorItem => ({
          kind: 'event',
          eventId: event.id,
          routeIndex,
          label: route.label,
          interval: event.interval,
          showPath: event.showPath,
          color: event.color,
          fromEnd: resolveEndpoint(route.from),
          toEnd: resolveEndpoint(route.to),
        })
      )
    ),
    ...calls.map(
      (call): ConnectorItem => ({
        kind: 'call',
        call,
        fromEnd: resolveEndpoint(call.from),
        toEnd: resolveEndpoint(call.to),
      })
    ),
  ];

  // Group connectors that join the same two nodes so they can be spaced into parallel lines
  // (e.g. a service->hub event and a hub->service event between the same pair, or a call
  // alongside an event on the same services) rather than overlapping exactly.
  const connectorGroups = new Map<string, number[]>();
  connectorItems.forEach(({ fromEnd, toEnd }, i) => {
    const key = connectorKeyOf(fromEnd, toEnd);
    const list = connectorGroups.get(key) ?? [];
    list.push(i);
    connectorGroups.set(key, list);
  });
  const groupPosition = connectorItems.map(({ fromEnd, toEnd }, i) => {
    const list = connectorGroups.get(connectorKeyOf(fromEnd, toEnd))!;
    return { indexInGroup: list.indexOf(i), groupSize: list.length };
  });

  // A service<->service connector whose two services aren't adjacent would otherwise draw
  // straight through whatever sits between them. Instead, each one gets its own horizontal lane
  // stacked underneath the others, low enough in the (correspondingly taller) service boxes that
  // it clears their labels, in encounter order so multiple such connectors don't collide.
  const crossingTierOf = new Map<number, number>();
  connectorItems.forEach(({ fromEnd, toEnd }, i) => {
    if (fromEnd.kind === 'service' && toEnd.kind === 'service' && Math.abs(fromEnd.index - toEnd.index) > 1) {
      crossingTierOf.set(i, crossingTierOf.size);
    }
  });
  const crossingTierCount = crossingTierOf.size;

  const svg: SVG = selectSvgElement(id);

  const markerId = `${id}-distsys-arrow`;

  svg
    .append('defs')
    .append('marker')
    .attr('id', markerId)
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 9)
    .attr('refY', 5)
    .attr('markerWidth', 8)
    .attr('markerHeight', 8)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('class', 'distsys-arrow');

  // Text is measured before anything is positioned, so the hub bar, every service box, every
  // edge label, and the overall canvas can all grow to fit arbitrarily long labels.
  const hubG = svg.append('g').attr('class', 'distsys-node distsys-hub');
  const hubText = hubG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(hub.label);

  const serviceNodes = services.map((service) => {
    const g = svg.append('g').attr('class', 'distsys-node distsys-service');
    const text = g
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(service.label);
    return { service, g, text };
  });

  const pathG = svg.append('g').attr('class', 'distsys-path');
  const labelTextOf = (item: ConnectorItem): string => (item.kind === 'event' ? item.label : (item.call.label ?? ''));
  const connectorLabelTexts = connectorItems.map((item) =>
    pathG
      .append('text')
      .attr('dominant-baseline', 'middle')
      .attr('class', 'distsys-edge-label')
      .text(labelTextOf(item))
  );

  const serviceWidths = serviceNodes.map(({ text }) =>
    Math.max(MIN_NODE_WIDTH, measureWidth(text.node()!) + NODE_TEXT_PADDING_X)
  );
  const labelWidths = connectorLabelTexts.map((text) => measureWidth(text.node()!));

  // Gaps between adjacent services default to SERVICE_GAP_X, but any gap a direct
  // service<->service connector (event or call) crosses is widened to fit the widest such
  // label, so the connecting line (and the label centered beneath it) is never narrower than
  // its own text.
  const gaps = new Array(Math.max(services.length - 1, 0)).fill(SERVICE_GAP_X);
  connectorItems.forEach(({ fromEnd, toEnd }, i) => {
    if (fromEnd.kind === 'service' && toEnd.kind === 'service') {
      const lo = Math.min(fromEnd.index, toEnd.index);
      const hi = Math.max(fromEnd.index, toEnd.index);
      if (hi === lo + 1) {
        gaps[lo] = Math.max(gaps[lo], labelWidths[i] + NODE_TEXT_PADDING_X);
      }
    }
  });

  const servicesWidth =
    serviceWidths.reduce((sum, w) => sum + w, 0) + gaps.reduce((sum, g) => sum + g, 0);
  // The hub is a long bar sized to span every service beneath it, widening further if its own
  // label needs more room.
  const hubWidth = Math.max(
    MIN_HUB_WIDTH,
    servicesWidth + HUB_OVERHANG_X * 2,
    measureWidth(hubText.node()!) + NODE_TEXT_PADDING_X
  );

  const contentWidth = Math.max(hubWidth, servicesWidth);
  const hubX = (contentWidth - hubWidth) / 2;
  const servicesStartX = (contentWidth - servicesWidth) / 2;

  // Grow each service box's height when crossing connectors need lanes to stack in below the
  // label, so every service stays the same height and the lanes never spill outside the box.
  const crossingExtraHeight =
    crossingTierCount > 0 ? CROSSING_LANE_GAP + crossingTierCount * CROSSING_LANE_HEIGHT : 0;
  const effectiveNodeHeight = NODE_HEIGHT + crossingExtraHeight;

  const hubY = MARGIN_Y;
  const hubBottom = hubY + HUB_HEIGHT;
  const serviceY = hubBottom + GAP_Y;
  const serviceCenterY = serviceY + NODE_HEIGHT / 2;

  // Lay out services left-to-right, then record each one's box + center for path routing.
  let cursorX = servicesStartX;
  const serviceBoxes = serviceWidths.map((w, i) => {
    const box = { x: cursorX, width: w, centerX: cursorX + w / 2 };
    cursorX += w + (gaps[i] ?? 0);
    return box;
  });

  const centerXOf = (end: Endpoint): number =>
    end.kind === 'hub' ? hubX + hubWidth / 2 : serviceBoxes[end.index].centerX;

  // Each connector's start/end order is its travel direction (irrelevant for a non-animated
  // call, but harmless). Connectors sharing a node pair are nudged apart via `centered` (their
  // signed offset from the shared center line) so opposite-direction or duplicate lines don't
  // overlap.
  const geometry = connectorItems.map(({ fromEnd, toEnd }, i) => {
    const { indexInGroup, groupSize } = groupPosition[i];
    const centered = indexInGroup - (groupSize - 1) / 2;
    const labelWidth = labelWidths[i];

    if (fromEnd.kind === 'hub' || toEnd.kind === 'hub') {
      // Hub<->service: a vertical line above the referenced service's center. The label sits
      // centered directly on the line, in the empty gap between hub and service; connectors
      // sharing this pair stack their labels in group order with a fixed gap between each.
      const serviceEnd = fromEnd.kind === 'hub' ? toEnd : fromEnd;
      const cx = centerXOf(serviceEnd) + centered * PARALLEL_OFFSET;
      const startY = fromEnd.kind === 'hub' ? hubBottom : serviceY;
      const endY = fromEnd.kind === 'hub' ? serviceY : hubBottom;
      const labelY = (hubBottom + serviceY) / 2 + indexInGroup * LABEL_ROW_HEIGHT;
      return {
        startX: cx,
        endX: cx,
        startY,
        endY,
        labelX: cx,
        labelY,
        labelAnchor: 'middle' as const,
        labelLeft: cx - labelWidth / 2,
        labelRight: cx + labelWidth / 2,
      };
    }
    const fromBox = serviceBoxes[(fromEnd as { index: number }).index];
    const toBox = serviceBoxes[(toEnd as { index: number }).index];

    if (crossingTierOf.has(i)) {
      // Not adjacent — instead of a straight line through whatever sits between the two
      // services, route it through its own lane low in the (taller) service boxes, below where
      // any label sits, so it reads as passing underneath rather than through them. Each
      // crossing connector stacks in its own lane, in encounter order.
      const tier = crossingTierOf.get(i)!;
      const laneY = serviceY + NODE_HEIGHT + CROSSING_LANE_GAP + tier * CROSSING_LANE_HEIGHT;
      const fromX = fromBox.centerX;
      const toX = toBox.centerX;
      const labelX = (fromX + toX) / 2;
      const labelY = laneY - ROW_LINE_TO_LABEL_GAP;
      return {
        startX: fromX,
        endX: toX,
        startY: laneY,
        endY: laneY,
        labelX,
        labelY,
        labelAnchor: 'middle' as const,
        labelLeft: labelX - labelWidth / 2,
        labelRight: labelX + labelWidth / 2,
      };
    }

    // Service<->service: a direct horizontal line between the two boxes' facing sides, staying
    // within their shared row (the gap between two adjacent boxes has no other content in it,
    // so the line and its label can live there without touching either box's own text) —
    // keeping it visually between the services rather than relocated elsewhere. Connectors
    // sharing this pair spread out around the row's center; each one's label sits directly
    // below its own line, so scanning down reads as line, label, line, label.
    const goesRight = fromBox.centerX < toBox.centerX;
    const startX = goesRight ? fromBox.x + fromBox.width : fromBox.x;
    const endX = goesRight ? toBox.x : toBox.x + toBox.width;
    const labelX = (startX + endX) / 2;
    const y = serviceCenterY + centered * ROW_SPACING;
    const labelY = y + ROW_LINE_TO_LABEL_GAP;
    return {
      startX,
      endX,
      startY: y,
      endY: y,
      labelX,
      labelY,
      labelAnchor: 'middle' as const,
      labelLeft: labelX - labelWidth / 2,
      labelRight: labelX + labelWidth / 2,
    };
  });

  // Extend the canvas to fit whichever content (hub bar, service row, or any edge label)
  // reaches furthest, then shift everything so the leftmost content sits at MARGIN_X.
  let minX = Math.min(hubX, servicesStartX);
  let maxX = Math.max(hubX + hubWidth, servicesStartX + servicesWidth);
  let maxY = serviceY + effectiveNodeHeight;
  geometry.forEach((g) => {
    minX = Math.min(minX, g.labelLeft, g.startX, g.endX);
    maxX = Math.max(maxX, g.labelRight, g.startX, g.endX);
    maxY = Math.max(maxY, g.labelY + LABEL_TEXT_HALF_HEIGHT);
  });
  const offsetX = MARGIN_X - minX;
  const width = maxX - minX + MARGIN_X * 2;
  const height = maxY + MARGIN_Y;
  const shift = (x: number) => x + offsetX;

  svg.attr('viewBox', `0 0 ${width} ${height}`);
  configureSvgSize(svg, height, width, db.getConfig().useMaxWidth);

  // Only events get a token group + animation controller; calls are static, so they only need a
  // path id. Each route gets its own path/tokens ids, keyed by event id + route index.
  let callIndex = 0;
  const domIds = connectorItems.map((item) => {
    if (item.kind === 'event') {
      return {
        pathId: `${id}-distsys-event-path-${item.eventId}-${item.routeIndex}`,
        tokensId: `${id}-distsys-tokens-${item.eventId}-${item.routeIndex}`,
      };
    }
    const pathId = `${id}-distsys-call-path-${callIndex}`;
    callIndex += 1;
    return { pathId, tokensId: undefined as string | undefined };
  });

  geometry.forEach((g, i) => {
    const item = connectorItems[i];
    const d = `M${shift(g.startX)},${g.startY} L${shift(g.endX)},${g.endY}`;
    const path = pathG
      .insert('path', 'text')
      .attr('id', domIds[i].pathId)
      .attr('d', d)
      .attr('marker-end', `url(#${markerId})`)
      .attr('class', item.kind === 'event' ? 'distsys-edge' : 'distsys-call');
    if (item.kind === 'call' && item.call.bidirectional) {
      // The marker's `orient="auto-start-reverse"` makes reusing it as marker-start point
      // outward too, giving a double-headed arrow with no second marker definition needed.
      path.attr('marker-start', `url(#${markerId})`);
    }
    if (item.kind === 'event' && item.color) {
      // The arrowhead marker can't inherit this — SVG markers inherit CSS from their own
      // position in <defs>, not from the path referencing them — so only the line and the
      // orb (via the same custom property on its token group, set below) pick up the color.
      path.style('--distsys-color', item.color);
    }
    connectorLabelTexts[i].attr('text-anchor', g.labelAnchor).attr('x', shift(g.labelX)).attr('y', g.labelY);
  });

  hubG
    .insert('rect', 'text')
    .attr('x', shift(hubX))
    .attr('y', hubY)
    .attr('width', hubWidth)
    .attr('height', HUB_HEIGHT)
    .attr('rx', 8);
  hubText.attr('x', shift(hubX + hubWidth / 2)).attr('y', hubY + HUB_HEIGHT / 2);

  serviceNodes.forEach(({ g, text }, index) => {
    const box = serviceBoxes[index];
    g.insert('rect', 'text')
      .attr('x', shift(box.x))
      .attr('y', serviceY)
      .attr('width', box.width)
      .attr('height', effectiveNodeHeight)
      .attr('rx', 6);
    text.attr('x', shift(box.centerX)).attr('y', serviceCenterY);
  });

  connectorItems.forEach((item, i) => {
    if (item.kind !== 'event') {
      return;
    }
    // Event items always have a tokensId (only calls omit one) — see the domIds map above.
    const tokens = svg.append('g').attr('class', 'distsys-tokens').attr('id', domIds[i].tokensId!);
    if (item.color) {
      tokens.style('--distsys-color', item.color);
    }
  });

  // The animation only runs once this SVG is live in the page — see distSysAnimator.ts.
  // The caller (whoever inserted `svg` into the DOM) must invoke the returned `bindFunctions`
  // with that live element for the streams to start. Calls have no controller — they're static.
  db.bindFunctions = (element: Element) => {
    const svgEl = (element.tagName === 'svg' ? element : element.querySelector('svg')) as
      | SVGSVGElement
      | null;
    if (!svgEl) {
      return;
    }
    // Keyed as `eventId[routeIndex]` so `svgEl.distSys.events['id[0]']` reaches one specific
    // route even when several routes share the same event id.
    const controllersById: Record<string, DistSysAnimationController> = {};
    connectorItems.forEach((item, i) => {
      if (item.kind !== 'event') {
        return;
      }
      controllersById[`${item.eventId}[${item.routeIndex}]`] = attachDistSysAnimation({
        svg: svgEl,
        pathSelector: `#${domIds[i].pathId}`,
        tokenGroupSelector: `#${domIds[i].tokensId}`,
        interval: item.interval,
        travelDuration: TRAVEL_DURATION_MS,
        tokenRadius: TOKEN_RADIUS,
        tokenClass: 'distsys-token',
        pathVisible: item.showPath,
      });
    });
    const controllerList = Object.values(controllersById);
    // Exposed so page code can do `svgEl.distSys.pause()` / `.play()` / `.setPathVisible()` / etc,
    // applied across every event's stream at once, plus `.events[id]` for per-event control.
    const aggregate: DistSysAnimationController & { events: typeof controllersById } = {
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
    };
    (svgEl as unknown as { distSys: typeof aggregate }).distSys = aggregate;
    aggregate.play();
  };
};

export const renderer = { draw };
