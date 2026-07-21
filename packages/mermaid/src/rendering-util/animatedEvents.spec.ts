import { describe, expect, it } from 'vitest';
import {
  parseAnimateSpec,
  resolveAnimatedEventTarget,
  type AnimatedEventTarget,
} from './animatedEvents.js';

describe('parseAnimateSpec', () => {
  it('parses a minimal event with defaults', () => {
    const events = parseAnimateSpec({ events: [{ on: { from: 'api', to: 'hub' } }] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'event-0',
      interval: 1000,
      travelDuration: 900,
      showPath: true,
      on: { from: 'api', to: 'hub' },
    });
  });

  it('honors explicit id, color, interval, travelDuration, showPath', () => {
    const events = parseAnimateSpec({
      events: [
        {
          id: 'user-created',
          color: '#3b82f6',
          interval: 250,
          travelDuration: 500,
          showPath: false,
          on: { message: 'UserCreated' },
        },
      ],
    });
    expect(events[0]).toMatchObject({
      id: 'user-created',
      color: '#3b82f6',
      interval: 250,
      travelDuration: 500,
      showPath: false,
    });
  });

  it('rejects a non-mapping spec', () => {
    expect(() => parseAnimateSpec('yes')).toThrow(/animate frontmatter must be a mapping/);
    expect(() => parseAnimateSpec(['a'])).toThrow(/animate frontmatter must be a mapping/);
  });

  it('rejects an empty or missing events list', () => {
    expect(() => parseAnimateSpec({})).toThrow(/`events` to be a non-empty list/);
    expect(() => parseAnimateSpec({ events: [] })).toThrow(/`events` to be a non-empty list/);
  });

  it('rejects duplicate event ids', () => {
    expect(() =>
      parseAnimateSpec({
        events: [
          { id: 'x', on: { from: 'a' } },
          { id: 'x', on: { from: 'b' } },
        ],
      })
    ).toThrow(/duplicate: `x`/);
  });

  it('rejects an invalid hex color but accepts CSS color names', () => {
    expect(() => parseAnimateSpec({ events: [{ color: '#12345', on: { from: 'a' } }] })).toThrow(
      /not a valid hex color/
    );
    expect(
      parseAnimateSpec({ events: [{ color: 'mediumseagreen', on: { from: 'a' } }] })[0].color
    ).toBe('mediumseagreen');
  });

  it('rejects a non-positive interval and travelDuration', () => {
    expect(() => parseAnimateSpec({ events: [{ interval: 0, on: { from: 'a' } }] })).toThrow(
      /interval/
    );
    expect(() => parseAnimateSpec({ events: [{ travelDuration: -5, on: { from: 'a' } }] })).toThrow(
      /travelDuration/
    );
  });

  it('rejects a missing or empty `on`', () => {
    expect(() => parseAnimateSpec({ events: [{}] })).toThrow(/`events\[0].on` to be a mapping/);
    expect(() => parseAnimateSpec({ events: [{ on: {} }] })).toThrow(
      /at least one of `from`, `to`, `message`, `nth`/
    );
  });

  it('rejects a non-integer or non-positive nth', () => {
    expect(() => parseAnimateSpec({ events: [{ on: { nth: 0 } }] })).toThrow(/positive integer/);
    expect(() => parseAnimateSpec({ events: [{ on: { nth: 1.5 } }] })).toThrow(/positive integer/);
  });
});

describe('resolveAnimatedEventTarget', () => {
  const targets: AnimatedEventTarget[] = [
    { id: '0', from: 'user', to: 'api', text: 'POST /users' },
    { id: '1', from: 'api', to: 'user', text: '201 Created' },
    { id: '2', from: 'api', to: 'hub', text: 'UserCreated' },
    { id: '3', from: 'api', to: 'hub', text: 'UserCreated' },
    { id: '4', from: 'api', to: 'hub', text: 'AuditLogged' },
  ];

  const eventWith = (on: object) => parseAnimateSpec({ events: [{ id: 'e', on } as object] })[0];

  it('resolves a unique from/to pair', () => {
    expect(resolveAnimatedEventTarget(eventWith({ from: 'user', to: 'api' }), targets).id).toBe(
      '0'
    );
  });

  it('errors listing candidates when from/to is ambiguous', () => {
    expect(() =>
      resolveAnimatedEventTarget(eventWith({ from: 'api', to: 'hub' }), targets)
    ).toThrow(/matches 3 lines: .*UserCreated.*AuditLogged.* — add `message:`/);
  });

  it('disambiguates by message text', () => {
    expect(
      resolveAnimatedEventTarget(
        eventWith({ from: 'api', to: 'hub', message: 'AuditLogged' }),
        targets
      ).id
    ).toBe('4');
  });

  it('uses nth as the final tiebreak when even the text repeats', () => {
    expect(
      resolveAnimatedEventTarget(
        eventWith({ from: 'api', to: 'hub', message: 'UserCreated', nth: 2 }),
        targets
      ).id
    ).toBe('3');
  });

  it('errors when text alone still matches several lines and no nth is given', () => {
    expect(() =>
      resolveAnimatedEventTarget(
        eventWith({ from: 'api', to: 'hub', message: 'UserCreated' }),
        targets
      )
    ).toThrow(/matches 2 lines/);
  });

  it('errors when nothing matches, listing what exists', () => {
    expect(() => resolveAnimatedEventTarget(eventWith({ from: 'nope' }), targets)).toThrow(
      /matched no line \(available: .*POST \/users/
    );
  });

  it('errors when nth exceeds the match count', () => {
    expect(() =>
      resolveAnimatedEventTarget(eventWith({ from: 'api', to: 'hub', nth: 9 }), targets)
    ).toThrow(/asks for `nth: 9` but only 3/);
  });
});
