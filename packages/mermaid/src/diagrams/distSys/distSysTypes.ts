export interface DistSysService {
  id: string;
  label: string;
}

export interface DistSysHub {
  id: string;
  label: string;
}

export interface DistSysEvent {
  id: string;
  label: string;
  /** Milliseconds the hub holds the event before the service sends the next one. Only one
   * orb travels at a time. */
  interval: number;
  /** Whether the connecting line is drawn. The orbs travel along the route either way. */
  showPath: boolean;
  /** Ids of the node(s) this event originates from (a `service.id` or `hub.id`). */
  from: string[];
  /** Ids of the node(s) this event is delivered to (a `service.id` or `hub.id`). */
  to: string[];
}
