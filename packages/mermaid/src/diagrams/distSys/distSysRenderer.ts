import type { DrawDefinition, SVG } from '../../diagram-api/types.js';
import type { Diagram } from '../../Diagram.js';
import { selectSvgElement } from '../../rendering-util/selectSvgElement.js';
import { configureSvgSize } from '../../setupGraphViewbox.js';
import { attachDistSysAnimation } from './distSysAnimator.js';
import type { DistSysDB } from './distSysDb.js';

const WIDTH = 480;
const HEIGHT = 200;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 70;
const TOKEN_RADIUS = 7;
const TRAVEL_DURATION_MS = 900;

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
  svg.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  configureSvgSize(svg, HEIGHT, WIDTH, db.getConfig().useMaxWidth);

  const serviceX = 60;
  const hubX = WIDTH - 60 - NODE_WIDTH;
  const nodeY = (HEIGHT - NODE_HEIGHT) / 2;
  const portY = nodeY + NODE_HEIGHT / 2;
  const servicePort = { x: serviceX + NODE_WIDTH, y: portY };
  const hubPort = { x: hubX, y: portY };

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

  const pathG = svg.append('g').attr('class', 'distsys-path');
  pathG
    .append('path')
    .attr('id', pathId)
    .attr('d', `M${servicePort.x},${servicePort.y} L${hubPort.x},${hubPort.y}`)
    .attr('marker-end', `url(#${markerId})`)
    .attr('class', 'distsys-edge');

  pathG
    .append('text')
    .attr('x', (servicePort.x + hubPort.x) / 2)
    .attr('y', portY - 12)
    .attr('text-anchor', 'middle')
    .attr('class', 'distsys-edge-label')
    .text(event.label);

  const serviceG = svg.append('g').attr('class', 'distsys-node distsys-service');
  serviceG
    .append('rect')
    .attr('x', serviceX)
    .attr('y', nodeY)
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 6);
  serviceG
    .append('text')
    .attr('x', serviceX + NODE_WIDTH / 2)
    .attr('y', portY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(service.label);

  const hubG = svg.append('g').attr('class', 'distsys-node distsys-hub');
  hubG
    .append('rect')
    .attr('x', hubX)
    .attr('y', nodeY)
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', NODE_HEIGHT / 2);
  hubG
    .append('text')
    .attr('x', hubX + NODE_WIDTH / 2)
    .attr('y', portY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(hub.label);

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
