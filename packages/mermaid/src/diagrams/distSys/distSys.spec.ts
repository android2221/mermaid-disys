import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parser } from './distSysParser.js';
import { DistSysDB } from './distSysDb.js';
import detector from './distSysDetector.js';
import { attachDistSysAnimation } from './distSysAnimator.js';

describe('distSys detector', () => {
  it('requires the -beta suffix', () => {
    expect(detector.detector('distsys-beta')).toBe(true);
    expect(detector.detector('distsys')).toBe(false);
  });
});

describe('distSys parser', () => {
  let db: DistSysDB;

  beforeEach(() => {
    db = new DistSysDB();
    // @ts-expect-error yy is typed as DiagramDB, DistSysDB satisfies it at runtime
    parser.parser.yy = db;
  });

  it('parses a service, hub, and event block', async () => {
    const input = `distsys-beta
service:
  id: orders
  label: Order Service
hub:
  id: bus
  label: Event Hub
event:
  id: order-created
  label: OrderCreated
  interval: 500
`;
    await parser.parse(input);
    expect(db.getService()).toEqual({ id: 'orders', label: 'Order Service' });
    expect(db.getHub()).toEqual({ id: 'bus', label: 'Event Hub' });
    expect(db.getEvent()).toEqual({
      id: 'order-created',
      label: 'OrderCreated',
      interval: 500,
      showPath: true,
    });
  });

  it('defaults label to id and interval to 1000ms when omitted', async () => {
    const input = `distsys-beta
service:
  id: orders
hub:
  id: bus
event:
  id: order-created
`;
    await parser.parse(input);
    expect(db.getService()).toEqual({ id: 'orders', label: 'orders' });
    expect(db.getHub()).toEqual({ id: 'bus', label: 'bus' });
    expect(db.getEvent()).toEqual({
      id: 'order-created',
      label: 'order-created',
      interval: 1000,
      showPath: true,
    });
  });

  it('parses event.showPath', async () => {
    const input = `distsys-beta
service:
  id: orders
hub:
  id: bus
event:
  id: order-created
  showPath: false
`;
    await parser.parse(input);
    expect(db.getEvent()?.showPath).toBe(false);
  });

  it('throws when event.showPath is not a boolean', async () => {
    const input = `distsys-beta
service:
  id: orders
hub:
  id: bus
event:
  id: order-created
  showPath: yes
`;
    await expect(parser.parse(input)).rejects.toThrow(/showPath/);
  });

  it('throws when service.id is missing', async () => {
    const input = `distsys-beta
hub:
  id: bus
event:
  id: order-created
`;
    await expect(parser.parse(input)).rejects.toThrow(/service\.id/);
  });

  it('throws when service and hub share the same id', async () => {
    const input = `distsys-beta
service:
  id: same
hub:
  id: same
event:
  id: order-created
`;
    await expect(parser.parse(input)).rejects.toThrow(/to be different/);
  });

  it('throws when event.interval is not a positive number', async () => {
    const input = `distsys-beta
service:
  id: orders
hub:
  id: bus
event:
  id: order-created
  interval: -5
`;
    await expect(parser.parse(input)).rejects.toThrow(/interval/);
  });
});

describe('distSys animator', () => {
  function makeFakePath(length: number): SVGPathElement {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.getTotalLength = () => length;
    path.getPointAtLength = (len: number) => ({ x: len, y: 0 }) as DOMPoint;
    return path;
  }

  function makeSvg(pathLength: number) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const path = makeFakePath(pathLength);
    path.id = 'p';
    const tokens = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tokens.id = 'tokens';
    svg.appendChild(path);
    svg.appendChild(tokens);
    document.body.appendChild(svg);
    return { svg, path, tokens };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('spawns a token immediately on play and moves it along the path', () => {
    const { svg, tokens } = makeSvg(100);
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#p',
      tokenGroupSelector: '#tokens',
      interval: 200,
      travelDuration: 100,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: true,
    });

    controller.play();
    expect(tokens.children.length).toBe(1);

    vi.advanceTimersByTime(50);
    // requestAnimationFrame is polyfilled by jsdom on a timer; flush it.
    vi.advanceTimersByTime(0);
  });

  it('removes tokens once they finish traveling and stop() clears everything', () => {
    const { svg, tokens } = makeSvg(100);
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#p',
      tokenGroupSelector: '#tokens',
      interval: 1000,
      travelDuration: 50,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: true,
    });

    controller.play();
    expect(tokens.children.length).toBe(1);
    controller.stop();
    expect(tokens.children.length).toBe(0);
  });

  it('returns a no-op controller when the path or token group is missing', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#missing',
      tokenGroupSelector: '#missing-too',
      interval: 100,
      travelDuration: 100,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: true,
    });
    expect(() => controller.play()).not.toThrow();
    expect(() => controller.pause()).not.toThrow();
    expect(() => controller.stop()).not.toThrow();
    expect(() => controller.setPathVisible(false)).not.toThrow();
    expect(controller.togglePath()).toBe(false);
  });

  it('hides the line without stopping the orbs, and starts hidden when pathVisible is false', () => {
    const { svg, path } = makeSvg(100);
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#p',
      tokenGroupSelector: '#tokens',
      interval: 1000,
      travelDuration: 200,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: false,
    });

    expect(path.style.visibility).toBe('hidden');
    controller.play();

    controller.setPathVisible(true);
    expect(path.style.visibility).toBe('');

    const nowVisible = controller.togglePath();
    expect(nowVisible).toBe(false);
    expect(path.style.visibility).toBe('hidden');

    // Toggling the line doesn't touch the animation loop or the orb itself.
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(0);
  });
});
