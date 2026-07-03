import type { DrawDefinition, SVG } from '../../diagram-api/types.js';
import type { Diagram } from '../../Diagram.js';
import { selectSvgElement } from '../../rendering-util/selectSvgElement.js';
import { configureSvgSize } from '../../setupGraphViewbox.js';
import { attachDistSysAnimation } from './distSysAnimator.js';
import type { DistSysDB } from './distSysDb.js';

const HEIGHT = 200;
const NODE_HEIGHT = 70;
const MIN_NODE_WIDTH = 120;
const NODE_TEXT_PADDING_X = 28;
const MARGIN_X = 60;
const MIN_GAP = 70;
const LABEL_PADDING_X = 24;
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
  const nodeY = (HEIGHT - NODE_HEIGHT) / 2;
  const portY = nodeY + NODE_HEIGHT / 2;

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

  // Text is measured before anything is positioned, so node widths and the service->hub
  // gap can grow to fit arbitrarily long labels instead of the hub shape painting over them.
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
  const labelText = pathG.append('text').attr('text-anchor', 'middle').attr('class', 'distsys-edge-label').text(event.label);

  const serviceWidth = Math.max(
    MIN_NODE_WIDTH,
    measureWidth(serviceText.node()!) + NODE_TEXT_PADDING_X
  );
  const hubWidth = Math.max(MIN_NODE_WIDTH, measureWidth(hubText.node()!) + NODE_TEXT_PADDING_X);
  const gap = Math.max(MIN_GAP, measureWidth(labelText.node()!) + LABEL_PADDING_X * 2);

  const serviceX = MARGIN_X;
  const servicePort = { x: serviceX + serviceWidth, y: portY };
  const hubX = servicePort.x + gap;
  const hubPort = { x: hubX, y: portY };
  const width = hubX + hubWidth + MARGIN_X;

  svg.attr('viewBox', `0 0 ${width} ${HEIGHT}`);
  configureSvgSize(svg, HEIGHT, width, db.getConfig().useMaxWidth);

  pathG
    .insert('path', 'text')
    .attr('id', pathId)
    .attr('d', `M${servicePort.x},${servicePort.y} L${hubPort.x},${hubPort.y}`)
    .attr('marker-end', `url(#${markerId})`)
    .attr('class', 'distsys-edge');
  labelText.attr('x', (servicePort.x + hubPort.x) / 2).attr('y', portY - 12);

  serviceG
    .insert('rect', 'text')
    .attr('x', serviceX)
    .attr('y', nodeY)
    .attr('width', serviceWidth)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 6);
  serviceText.attr('x', serviceX + serviceWidth / 2).attr('y', portY);

  hubG
    .insert('rect', 'text')
    .attr('x', hubX)
    .attr('y', nodeY)
    .attr('width', hubWidth)
    .attr('height', NODE_HEIGHT)
    .attr('rx', NODE_HEIGHT / 2);
  hubText.attr('x', hubX + hubWidth / 2).attr('y', portY);

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
    });
    // Exposed so page code can do `svgEl.distSys.pause()` / `.play()` / `.stop()`.
    (svgEl as unknown as { distSys: typeof controller }).distSys = controller;
    controller.play();
  };
};

export const renderer = { draw };
