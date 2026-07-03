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
  /** Milliseconds between successive emissions of this event from the service to the hub. */
  interval: number;
  /** Whether the connecting line is drawn. The orbs travel along the route either way. */
  showPath: boolean;
}
