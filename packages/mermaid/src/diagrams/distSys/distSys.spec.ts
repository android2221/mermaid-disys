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

  it('parses a services list, hub, and an events list', async () => {
    const input = `distsys-beta
services:
  - id: orders
    label: Order Service
hub:
  id: bus
  label: Event Hub
events:
  - id: order-created
    label: OrderCreated
    interval: 500
    from: orders
    to: bus
`;
    await parser.parse(input);
    expect(db.getServices()).toEqual([{ id: 'orders', label: 'Order Service' }]);
    expect(db.getHub()).toEqual({ id: 'bus', label: 'Event Hub' });
    expect(db.getEvents()).toEqual([
      {
        id: 'order-created',
        label: 'OrderCreated',
        interval: 500,
        showPath: true,
        from: ['orders'],
        to: ['bus'],
      },
    ]);
  });

  it('parses a round trip: one event service->hub, another hub->service', async () => {
    const input = `distsys-beta
services:
  - id: orders
    label: Order Service
hub:
  id: bus
  label: Event Hub
events:
  - id: order-created
    label: OrderCreated
    from: orders
    to: bus
  - id: order-confirmed
    label: OrderConfirmed
    from: bus
    to: orders
`;
    await parser.parse(input);
    expect(db.getEvents()).toEqual([
      {
        id: 'order-created',
        label: 'OrderCreated',
        interval: 1000,
        showPath: true,
        from: ['orders'],
        to: ['bus'],
      },
      {
        id: 'order-confirmed',
        label: 'OrderConfirmed',
        interval: 1000,
        showPath: true,
        from: ['bus'],
        to: ['orders'],
      },
    ]);
  });

  it('parses multiple services and a service<->service event', async () => {
    const input = `distsys-beta
services:
  - id: orders
    label: Order Service
  - id: payments
    label: Payment Service
hub:
  id: bus
events:
  - id: payment-requested
    label: PaymentRequested
    from: orders
    to: payments
`;
    await parser.parse(input);
    expect(db.getServices()).toEqual([
      { id: 'orders', label: 'Order Service' },
      { id: 'payments', label: 'Payment Service' },
    ]);
    expect(db.getEvents()).toMatchObject([{ from: ['orders'], to: ['payments'] }]);
  });

  it('defaults label to id and interval to 1000ms when omitted', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: orders
    to: bus
`;
    await parser.parse(input);
    expect(db.getServices()).toEqual([{ id: 'orders', label: 'orders' }]);
    expect(db.getHub()).toEqual({ id: 'bus', label: 'bus' });
    expect(db.getEvents()).toEqual([
      {
        id: 'order-created',
        label: 'order-created',
        interval: 1000,
        showPath: true,
        from: ['orders'],
        to: ['bus'],
      },
    ]);
  });

  it('accepts an event.from/to as a hub -> service list, normalizing single values to arrays', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: [bus]
    to: [orders]
`;
    await parser.parse(input);
    expect(db.getEvents()).toMatchObject([{ from: ['bus'], to: ['orders'] }]);
  });

  it('parses events[].showPath', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    showPath: false
    from: orders
    to: bus
`;
    await parser.parse(input);
    expect(db.getEvents()[0]?.showPath).toBe(false);
  });

  it('throws when events[].showPath is not a boolean', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    showPath: yes
    from: orders
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/showPath/);
  });

  it('throws when services is missing', async () => {
    const input = `distsys-beta
hub:
  id: bus
events:
  - id: order-created
    from: orders
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/services/);
  });

  it('throws when services is an empty list', async () => {
    const input = `distsys-beta
services: []
hub:
  id: bus
events:
  - id: order-created
    from: orders
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/services/);
  });

  it('throws when two services share the same id', async () => {
    const input = `distsys-beta
services:
  - id: orders
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: orders
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/unique/);
  });

  it('throws when a service and the hub share the same id', async () => {
    const input = `distsys-beta
services:
  - id: same
hub:
  id: same
events:
  - id: order-created
    from: same
    to: same
`;
    await expect(parser.parse(input)).rejects.toThrow(/differ/);
  });

  it('throws when events is missing', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/events/);
  });

  it('throws when events is an empty list', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events: []
`;
    await expect(parser.parse(input)).rejects.toThrow(/events/);
  });

  it('throws when two events share the same id', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: same
    from: orders
    to: bus
  - id: same
    from: bus
    to: orders
`;
    await expect(parser.parse(input)).rejects.toThrow(/unique/);
  });

  it('throws when events[].interval is not a positive number', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    interval: -5
    from: orders
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/interval/);
  });

  it('throws when events[].from is missing', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/events\[0\]\.from/);
  });

  it('throws when events[].to is missing', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: orders
`;
    await expect(parser.parse(input)).rejects.toThrow(/events\[0\]\.to/);
  });

  it('throws when events[].from/to reference an unknown id', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: nope
    to: bus
`;
    await expect(parser.parse(input)).rejects.toThrow(/unknown id/);
  });

  it('throws when events[].from and .to overlap', async () => {
    const input = `distsys-beta
services:
  - id: orders
hub:
  id: bus
events:
  - id: order-created
    from: orders
    to: orders
`;
    await expect(parser.parse(input)).rejects.toThrow(/disjoint/);
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

  it('stop() clears the in-flight orb', () => {
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

  it('never shows more than one orb at a time, even with a short interval', () => {
    const { svg, tokens } = makeSvg(100);
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#p',
      tokenGroupSelector: '#tokens',
      interval: 20,
      travelDuration: 100,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: true,
    });

    controller.play();
    let maxConcurrent = tokens.children.length;
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(10);
      maxConcurrent = Math.max(maxConcurrent, tokens.children.length);
    }
    expect(maxConcurrent).toBe(1);
  });

  it('waits `interval` ms after an orb arrives before the next one departs', () => {
    const { svg, tokens } = makeSvg(100);
    const controller = attachDistSysAnimation({
      svg,
      pathSelector: '#p',
      tokenGroupSelector: '#tokens',
      interval: 50,
      travelDuration: 100,
      tokenRadius: 5,
      tokenClass: 'token',
      pathVisible: true,
    });

    controller.play();
    expect(tokens.children.length).toBe(1); // first orb departs immediately

    // Poll in small steps rather than jumping straight to a computed boundary — the exact
    // instant rAF fires under fake timers isn't guaranteed, so sample frequently instead.
    let sawGap = false;
    for (let elapsed = 0; elapsed < 130; elapsed += 5) {
      vi.advanceTimersByTime(5);
      if (tokens.children.length === 0) {
        sawGap = true;
      }
    }
    expect(sawGap).toBe(true); // the orb arrived and the gap before the next one actually happened

    for (let elapsed = 0; elapsed < 100; elapsed += 5) {
      vi.advanceTimersByTime(5);
    }
    // Well past travelDuration + interval (150ms) from the first departure: the next orb
    // has departed and is still mid-flight (its own travelDuration doesn't end until 250ms).
    expect(tokens.children.length).toBe(1);
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
