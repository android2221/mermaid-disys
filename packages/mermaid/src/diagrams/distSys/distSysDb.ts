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
import type { DistSysEvent, DistSysHub, DistSysService } from './distSysTypes.js';

export class DistSysDB implements DiagramDB {
  private services: DistSysService[] = [];
  private hub?: DistSysHub;
  private event?: DistSysEvent;
  private diagramId = '';

  /** Set by the renderer once it knows the live DOM ids to animate; invoked by the caller after inserting the SVG. */
  public bindFunctions?: (element: Element) => void;

  constructor() {
    this.clear();
  }

  public clear(): void {
    this.services = [];
    this.hub = undefined;
    this.event = undefined;
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

  public setEvent(event: DistSysEvent): void {
    this.event = event;
  }

  public getEvent(): DistSysEvent | undefined {
    return this.event;
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
