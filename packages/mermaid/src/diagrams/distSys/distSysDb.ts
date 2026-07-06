import type { DiagramDB } from '../../diagram-api/types.js';
import {
  clear as commonClear,
  getAccDescription,
  getAccTitle,
  getDiagramTitle,
  setAccDescription,
  setAccTitle,
  setDiagramTitle,
} from '../common/commonDb.js';
import type { DistSysCall, DistSysEvent, DistSysHub, DistSysService } from './distSysTypes.js';

export class DistSysDB implements DiagramDB {
  private services: DistSysService[] = [];
  private hub?: DistSysHub;
  private events: DistSysEvent[] = [];
  private calls: DistSysCall[] = [];
  private diagramId = '';

  /** Set by the renderer once it knows the live DOM ids to animate; invoked by the caller after inserting the SVG. */
  public bindFunctions?: (element: Element) => void;

  constructor() {
    this.clear();
  }

  public clear(): void {
    this.services = [];
    this.hub = undefined;
    this.events = [];
    this.calls = [];
    this.diagramId = '';
    this.bindFunctions = undefined;
    commonClear();
  }

  public setDiagramId(id: string): void {
    this.diagramId = id;
  }

  public getDiagramId(): string {
    return this.diagramId;
  }

  public setServices(services: DistSysService[]): void {
    this.services = services;
  }

  public getServices(): DistSysService[] {
    return this.services;
  }

  public setHub(hub: DistSysHub): void {
    this.hub = hub;
  }

  public getHub(): DistSysHub | undefined {
    return this.hub;
  }

  public setEvents(events: DistSysEvent[]): void {
    this.events = events;
  }

  public getEvents(): DistSysEvent[] {
    return this.events;
  }

  public setCalls(calls: DistSysCall[]): void {
    this.calls = calls;
  }

  public getCalls(): DistSysCall[] {
    return this.calls;
  }

  public getConfig(): { useMaxWidth: boolean } {
    return { useMaxWidth: true };
  }

  public setAccTitle = setAccTitle;
  public getAccTitle = getAccTitle;
  public setDiagramTitle = setDiagramTitle;
  public getDiagramTitle = getDiagramTitle;
  public getAccDescription = getAccDescription;
  public setAccDescription = setAccDescription;
}
