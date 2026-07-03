// The "* as yaml" part is necessary for tree-shaking
import * as yaml from 'js-yaml';
import type { ParserDefinition } from '../../diagram-api/types.js';
import { DistSysDB } from './distSysDb.js';

const DEFAULT_INTERVAL_MS = 1000;

interface DistSysYamlNode {
  id?: unknown;
  label?: unknown;
}

interface DistSysYamlEvent extends DistSysYamlNode {
  interval?: unknown;
  showPath?: unknown;
}

interface DistSysYamlDoc {
  service?: DistSysYamlNode;
  hub?: DistSysYamlNode;
  event?: DistSysYamlEvent;
}

const requireId = (node: DistSysYamlNode | undefined, field: string): string => {
  if (!node || typeof node.id !== 'string' || node.id.trim() === '') {
    throw new Error(`distsys diagram requires \`${field}.id\` to be set to a non-empty string`);
  }
  return node.id;
};

const labelOf = (node: DistSysYamlNode | undefined, fallbackId: string): string => {
  return typeof node?.label === 'string' && node.label.trim() !== '' ? node.label : fallbackId;
};

export const parser: ParserDefinition = {
  parser: {
    // @ts-expect-error - DistSysDB is not assignable to DiagramDB
    yy: undefined,
  },
  parse: async (input: string): Promise<void> => {
    const db = parser.parser?.yy;
    if (!(db instanceof DistSysDB)) {
      throw new Error(
        'parser.parser?.yy was not a DistSysDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.'
      );
    }

    // Strip the leading `distsys-beta` diagram declaration; everything after it is plain YAML.
    const body = input.replace(/^\s*distsys-beta\s*\r?\n?/, '');

    let doc: DistSysYamlDoc | undefined;
    try {
      doc = (yaml.load(body, { schema: yaml.JSON_SCHEMA }) as DistSysYamlDoc | undefined) ?? undefined;
    } catch (err) {
      throw new Error(`distsys diagram body is not valid YAML: ${(err as Error).message}`);
    }

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error(
        'distsys diagram requires a `service`, `hub`, and `event` block, e.g.\n' +
          'distsys-beta\n' +
          'service:\n  id: orders\n  label: Order Service\n' +
          'hub:\n  id: bus\n  label: Event Hub\n' +
          'event:\n  id: order-created\n  label: OrderCreated\n  interval: 1000'
      );
    }

    const serviceId = requireId(doc.service, 'service');
    const hubId = requireId(doc.hub, 'hub');
    const eventId = requireId(doc.event, 'event');

    if (serviceId === hubId) {
      throw new Error('distsys diagram requires `service.id` and `hub.id` to be different');
    }

    const rawInterval = doc.event?.interval;
    const interval =
      rawInterval === undefined || rawInterval === null ? DEFAULT_INTERVAL_MS : Number(rawInterval);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error('distsys diagram requires `event.interval` to be a positive number of milliseconds');
    }

    const rawShowPath = doc.event?.showPath;
    if (rawShowPath !== undefined && typeof rawShowPath !== 'boolean') {
      throw new Error('distsys diagram requires `event.showPath` to be a boolean');
    }
    const showPath = rawShowPath ?? true;

    db.setService({ id: serviceId, label: labelOf(doc.service, serviceId) });
    db.setHub({ id: hubId, label: labelOf(doc.hub, hubId) });
    db.setEvent({ id: eventId, label: labelOf(doc.event, eventId), interval, showPath });
  },
};
