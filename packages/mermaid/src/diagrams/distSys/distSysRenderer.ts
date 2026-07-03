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
const GAP_Y = 90;
const LABEL_OFFSET_X = 14;
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

export const draw: DrawDefinition = (_text, id, _version, diagObj: Diagram) => {
  const db = diagObj.db as DistSysDB;
  db.setDiagramId(id);

  const service = db.getService();
  const hub = db.getHub();
  const event = db.getEvent();
  if (!service || !hub || !event) {
    throw new Error('distsys diagram requires a `service`, `hub`, and `event` block');
  }

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

  // Text is measured before anything is positioned, so the hub bar, the service box, and
  // the overall canvas can all grow to fit arbitrarily long labels.
  const serviceG = svg.append('g').attr('class', 'distsys-node distsys-service');
  const serviceText = serviceG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(service.label);

  const hubG = svg.append('g').attr('class', 'distsys-node distsys-hub');
  const hubText = hubG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(hub.label);

  const pathG = svg.append('g').attr('class', 'distsys-path');
  const labelText = pathG
    .append('text')
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('class', 'distsys-edge-label')
    .text(event.label);

  const serviceWidth = Math.max(
    MIN_NODE_WIDTH,
    measureWidth(serviceText.node()!) + NODE_TEXT_PADDING_X
  );
  // The hub is a long bar sized to span the service(s) beneath it, widening further if its
  // own label needs more room.
  const hubWidth = Math.max(
    MIN_HUB_WIDTH,
    serviceWidth + HUB_OVERHANG_X * 2,
    measureWidth(hubText.node()!) + NODE_TEXT_PADDING_X
  );
  const labelWidth = measureWidth(labelText.node()!);

  const maxNodeWidth = Math.max(hubWidth, serviceWidth);
  const centerX = MARGIN_X + maxNodeWidth / 2;
  const rightExtent = Math.max(maxNodeWidth / 2, LABEL_OFFSET_X + labelWidth);
  const width = centerX + rightExtent + MARGIN_X;

  const hubX = centerX - hubWidth / 2;
  const hubY = MARGIN_Y;
  const hubBottom = hubY + HUB_HEIGHT;

  const serviceX = centerX - serviceWidth / 2;
  const serviceY = hubBottom + GAP_Y;
  const serviceCenterY = serviceY + NODE_HEIGHT / 2;

  const height = serviceY + NODE_HEIGHT + MARGIN_Y;

  svg.attr('viewBox', `0 0 ${width} ${height}`);
  configureSvgSize(svg, height, width, db.getConfig().useMaxWidth);

  // Orbs travel bottom-to-top: the service emits up into the hub.
  pathG
    .insert('path', 'text')
    .attr('id', pathId)
    .attr('d', `M${centerX},${serviceY} L${centerX},${hubBottom}`)
    .attr('marker-end', `url(#${markerId})`)
    .attr('class', 'distsys-edge');
  labelText.attr('x', centerX + LABEL_OFFSET_X).attr('y', (hubBottom + serviceY) / 2);

  hubG
    .insert('rect', 'text')
    .attr('x', hubX)
    .attr('y', hubY)
    .attr('width', hubWidth)
    .attr('height', HUB_HEIGHT)
    .attr('rx', 8);
  hubText.attr('x', hubX + hubWidth / 2).attr('y', hubY + HUB_HEIGHT / 2);

  serviceG
    .insert('rect', 'text')
    .attr('x', serviceX)
    .attr('y', serviceY)
    .attr('width', serviceWidth)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 6);
  serviceText.attr('x', serviceX + serviceWidth / 2).attr('y', serviceCenterY);

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
