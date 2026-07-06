export interface DistSysService {
  id: string;
  label: string;
}

export interface DistSysHub {
  id: string;
  label: string;
}

/** One hop of an event: a specific from/to pair, with its own label (defaulting to the
 * event's own label when not overridden). */
export interface DistSysEventRoute {
  from: string;
  to: string;
  label: string;
}

export interface DistSysEvent {
  id: string;
  label: string;
  /** Milliseconds the hub holds the event before the service sends the next one. Only one
   * orb travels at a time per route. */
  interval: number;
  /** Whether the connecting line is drawn. The orbs travel along the route either way. */
  showPath: boolean;
  /** A hex code (`#rgb`/`#rrggbb`) or CSS color name recoloring this event's lines and orbs;
   * undefined uses the default styling. */
  color?: string;
  /** The from/to hops this event travels — one event, one identity, any number of routes. */
  routes: DistSysEventRoute[];
}

/** A static service<->service relationship: just a line, no orb — for indicating that two
 * services call each other without modeling a specific animated event. */
export interface DistSysCall {
  from: string;
  to: string;
  label?: string;
  /** Draws an arrowhead at both ends instead of just at `to`. */
  bidirectional: boolean;
}
