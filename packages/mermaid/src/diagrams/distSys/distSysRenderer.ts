import type { DrawDefinition, SVG } from '../../diagram-api/types.js';
import type { Diagram } from '../../Diagram.js';
import { selectSvgElement } from '../../rendering-util/selectSvgElement.js';
import { configureSvgSize } from '../../setupGraphViewbox.js';
import { attachDistSysAnimation } from './distSysAnimator.js';
import type { DistSysDB } from './distSysDb.js';

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
const LABEL_OFFSET_X = 14;
const LABEL_OFFSET_Y = 18;
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

export const draw: DrawDefinition = (_text, id, _version, diagObj: Diagram) => {
  const db = diagObj.db as DistSysDB;
  db.setDiagramId(id);

  const services = db.getServices();
  const hub = db.getHub();
  const event = db.getEvent();
  if (services.length === 0 || !hub || !event) {
    throw new Error('distsys diagram requires `services`, `hub`, and `event` blocks');
  }

  // The parser guarantees from/to are known, disjoint ids, so exactly one of the two
  // resolves to the hub (a service<->service event) or neither does (a hub<->service event).
  const resolveEndpoint = (refId: string): Endpoint => {
    if (refId === hub.id) {
      return { kind: 'hub' };
    }
    const index = services.findIndex((service) => service.id === refId);
    return { kind: 'service', index };
  };
  const fromEnd = resolveEndpoint(event.from[0]);
  const toEnd = resolveEndpoint(event.to[0]);

  const svg: SVG = selectSvgElement(id);

  const markerId = `${id}-distsys-arrow`;
  const pathId = `${id}-distsys-event-path`;
  const tokensId = `${id}-distsys-tokens`;

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

  // Text is measured before anything is positioned, so the hub bar, every service box, and
  // the overall canvas can all grow to fit arbitrarily long labels.
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
  const labelText = pathG
    .append('text')
    .attr('dominant-baseline', 'middle')
    .attr('class', 'distsys-edge-label')
    .text(event.label);

  const serviceWidths = serviceNodes.map(({ text }) =>
    Math.max(MIN_NODE_WIDTH, measureWidth(text.node()!) + NODE_TEXT_PADDING_X)
  );
  const labelWidth = measureWidth(labelText.node()!);

  // Gaps between adjacent services default to SERVICE_GAP_X, but the one gap a direct
  // service<->service event connects is widened to fit that event's label so it doesn't
  // overlap either box.
  const gaps = new Array(Math.max(services.length - 1, 0)).fill(SERVICE_GAP_X);
  if (fromEnd.kind === 'service' && toEnd.kind === 'service') {
    const lo = Math.min(fromEnd.index, toEnd.index);
    const hi = Math.max(fromEnd.index, toEnd.index);
    if (hi === lo + 1) {
      gaps[lo] = Math.max(SERVICE_GAP_X, labelWidth + NODE_TEXT_PADDING_X);
    }
  }

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

  const hubY = MARGIN_Y;
  const hubBottom = hubY + HUB_HEIGHT;
  const serviceY = hubBottom + GAP_Y;
  const serviceCenterY = serviceY + NODE_HEIGHT / 2;
  const height = serviceY + NODE_HEIGHT + MARGIN_Y;

  // Lay out services left-to-right, then record each one's box + center for path routing.
  let cursorX = servicesStartX;
  const serviceBoxes = serviceWidths.map((w, i) => {
    const box = { x: cursorX, width: w, centerX: cursorX + w / 2 };
    cursorX += w + (gaps[i] ?? 0);
    return box;
  });

  const centerXOf = (end: Endpoint): number =>
    end.kind === 'hub' ? hubX + hubWidth / 2 : serviceBoxes[end.index].centerX;

  // The path's start/end order is the travel direction: the animator always moves from the
  // start point to the end point, so `from`/`to` decide direction and, for service<->service
  // events, which side of each box the line touches. All x values here are still relative to
  // the unshifted layout — the whole canvas is translated once the full extent is known below.
  let startX: number, startY: number, endX: number, endY: number;
  let labelX: number, labelY: number;
  let labelAnchor: 'start' | 'middle';
  if (fromEnd.kind === 'hub' || toEnd.kind === 'hub') {
    // Hub<->service: a vertical line directly above the referenced service's center.
    const serviceEnd = fromEnd.kind === 'hub' ? toEnd : fromEnd;
    const cx = centerXOf(serviceEnd);
    startX = endX = cx;
    startY = fromEnd.kind === 'hub' ? hubBottom : serviceY;
    endY = fromEnd.kind === 'hub' ? serviceY : hubBottom;
    labelX = cx + LABEL_OFFSET_X;
    labelY = (hubBottom + serviceY) / 2;
    labelAnchor = 'start';
  } else {
    // Service<->service: a direct horizontal line between the two boxes' facing sides. Routes
    // straight through any boxes in between if the two services aren't neighbors.
    const fromBox = serviceBoxes[fromEnd.index];
    const toBox = serviceBoxes[toEnd.index];
    const goesRight = fromBox.centerX < toBox.centerX;
    startX = goesRight ? fromBox.x + fromBox.width : fromBox.x;
    endX = goesRight ? toBox.x : toBox.x + toBox.width;
    startY = endY = serviceCenterY;
    labelX = (startX + endX) / 2;
    // The line runs through the boxes' vertical center, so the label sits above the whole row
    // (in the hub<->service gap) rather than at line height, to avoid overlapping either box.
    labelY = serviceY - LABEL_OFFSET_Y;
    labelAnchor = 'middle';
  }

  // Extend the canvas to fit whichever content (hub bar, service row, or the edge label)
  // reaches furthest, then shift everything so the leftmost content sits at MARGIN_X.
  const labelLeft = labelAnchor === 'start' ? labelX : labelX - labelWidth / 2;
  const labelRight = labelAnchor === 'start' ? labelX + labelWidth : labelX + labelWidth / 2;
  const minX = Math.min(hubX, servicesStartX, labelLeft, startX, endX);
  const maxX = Math.max(hubX + hubWidth, servicesStartX + servicesWidth, labelRight, startX, endX);
  const offsetX = MARGIN_X - minX;
  const width = maxX - minX + MARGIN_X * 2;
  const shift = (x: number) => x + offsetX;

  svg.attr('viewBox', `0 0 ${width} ${height}`);
  configureSvgSize(svg, height, width, db.getConfig().useMaxWidth);

  pathG
    .insert('path', 'text')
    .attr('id', pathId)
    .attr('d', `M${shift(startX)},${startY} L${shift(endX)},${endY}`)
    .attr('marker-end', `url(#${markerId})`)
    .attr('class', 'distsys-edge');
  labelText.attr('text-anchor', labelAnchor).attr('x', shift(labelX)).attr('y', labelY);

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
      .attr('height', NODE_HEIGHT)
      .attr('rx', 6);
    text.attr('x', shift(box.centerX)).attr('y', serviceCenterY);
  });

  svg.append('g').attr('class', 'distsys-tokens').attr('id', tokensId);

  // The animation only runs once this SVG is live in the page — see distSysAnimator.ts.
  // The caller (whoever inserted `svg` into the DOM) must invoke the returned `bindFunctions`
  // with that live element for the stream to start.
  db.bindFunctions = (element: Element) => {
    const svgEl = (element.tagName === 'svg' ? element : element.querySelector('svg')) as
      | SVGSVGElement
      | null;
    if (!svgEl) {
      return;
    }
    const controller = attachDistSysAnimation({
      svg: svgEl,
      pathSelector: `#${pathId}`,
      tokenGroupSelector: `#${tokensId}`,
      interval: event.interval,
      travelDuration: TRAVEL_DURATION_MS,
      tokenRadius: TOKEN_RADIUS,
      tokenClass: 'distsys-token',
      pathVisible: event.showPath,
    });
    // Exposed so page code can do `svgEl.distSys.pause()` / `.play()` / `.setPathVisible()` / etc.
    (svgEl as unknown as { distSys: typeof controller }).distSys = controller;
    controller.play();
  };
};

export const renderer = { draw };
