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
  from?: unknown;
  to?: unknown;
}

interface DistSysYamlDoc {
  services?: unknown;
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

/** `services` is a YAML sequence of `{id, label}` nodes; ids must be unique. */
const parseServices = (value: unknown): { id: string; label: string }[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'distsys diagram requires `services` to be a non-empty list, e.g.\n' +
        'services:\n  - id: orders\n    label: Order Service'
    );
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const node = raw as DistSysYamlNode | undefined;
    const id = requireId(node, `services[${index}]`);
    if (seen.has(id)) {
      throw new Error(`distsys diagram requires every \`services[].id\` to be unique (duplicate: \`${id}\`)`);
    }
    seen.add(id);
    return { id, label: labelOf(node, id) };
  });
};

/** Accepts either a single id or a YAML sequence of ids and normalizes to a non-empty string[]. */
const requireIds = (value: unknown, field: string): string[] => {
  const arr = value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (arr.length === 0) {
    throw new Error(`distsys diagram requires \`${field}\` to be set to an id or list of ids`);
  }
  return arr.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`distsys diagram requires every entry in \`${field}\` to be a non-empty string`);
    }
    return item;
  });
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
        'distsys diagram requires `services`, `hub`, and `event` blocks, e.g.\n' +
          'distsys-beta\n' +
          'services:\n  - id: orders\n    label: Order Service\n' +
          'hub:\n  id: bus\n  label: Event Hub\n' +
          'event:\n  id: order-created\n  label: OrderCreated\n  interval: 1000\n' +
          '  from: orders\n  to: bus'
      );
    }

    const services = parseServices(doc.services);
    const hubId = requireId(doc.hub, 'hub');
    const eventId = requireId(doc.event, 'event');

    if (services.some((s) => s.id === hubId)) {
      throw new Error('distsys diagram requires `hub.id` to differ from every `services[].id`');
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

    const from = requireIds(doc.event?.from, 'event.from');
    const to = requireIds(doc.event?.to, 'event.to');
    const knownIds = new Set([hubId, ...services.map((s) => s.id)]);
    for (const refId of [...from, ...to]) {
      if (!knownIds.has(refId)) {
        throw new Error(
          `distsys diagram: \`event.from\`/\`event.to\` reference unknown id \`${refId}\` ` +
            `(expected one of: ${[...knownIds].map((known) => `\`${known}\``).join(', ')})`
        );
      }
    }
    if (from.some((id) => to.includes(id))) {
      throw new Error(
        'distsys diagram requires `event.from` and `event.to` to be disjoint (an event cannot go from a node to itself)'
      );
    }

    db.setServices(services);
    db.setHub({ id: hubId, label: labelOf(doc.hub, hubId) });
    db.setEvent({ id: eventId, label: labelOf(doc.event, eventId), interval, showPath, from, to });
  },
};
