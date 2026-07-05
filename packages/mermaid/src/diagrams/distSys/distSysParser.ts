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
  events?: unknown;
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

interface ParsedDistSysEvent {
  id: string;
  label: string;
  interval: number;
  showPath: boolean;
  from: string[];
  to: string[];
}

/** `events` is a YAML sequence of event blocks; each one's `from`/`to` must reference known ids. */
const parseEvents = (value: unknown, knownIds: Set<string>): ParsedDistSysEvent[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'distsys diagram requires `events` to be a non-empty list, e.g.\n' +
        'events:\n  - id: order-created\n    label: OrderCreated\n    from: orders\n    to: bus'
    );
  }
  const seenIds = new Set<string>();
  return value.map((raw, index) => {
    const node = raw as DistSysYamlEvent | undefined;
    const id = requireId(node, `events[${index}]`);
    if (seenIds.has(id)) {
      throw new Error(`distsys diagram requires every \`events[].id\` to be unique (duplicate: \`${id}\`)`);
    }
    seenIds.add(id);

    const rawInterval = node?.interval;
    const interval =
      rawInterval === undefined || rawInterval === null ? DEFAULT_INTERVAL_MS : Number(rawInterval);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error(
        `distsys diagram requires \`events[${index}].interval\` to be a positive number of milliseconds`
      );
    }

    const rawShowPath = node?.showPath;
    if (rawShowPath !== undefined && typeof rawShowPath !== 'boolean') {
      throw new Error(`distsys diagram requires \`events[${index}].showPath\` to be a boolean`);
    }
    const showPath = rawShowPath ?? true;

    const from = requireIds(node?.from, `events[${index}].from`);
    const to = requireIds(node?.to, `events[${index}].to`);
    for (const refId of [...from, ...to]) {
      if (!knownIds.has(refId)) {
        throw new Error(
          `distsys diagram: \`events[${index}].from\`/\`.to\` reference unknown id \`${refId}\` ` +
            `(expected one of: ${[...knownIds].map((known) => `\`${known}\``).join(', ')})`
        );
      }
    }
    if (from.some((refId) => to.includes(refId))) {
      throw new Error(
        `distsys diagram requires \`events[${index}].from\` and \`.to\` to be disjoint ` +
          '(an event cannot go from a node to itself)'
      );
    }

    return { id, label: labelOf(node, id), interval, showPath, from, to };
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
        'distsys diagram requires `services`, `hub`, and `events` blocks, e.g.\n' +
          'distsys-beta\n' +
          'services:\n  - id: orders\n    label: Order Service\n' +
          'hub:\n  id: bus\n  label: Event Hub\n' +
          'events:\n  - id: order-created\n    label: OrderCreated\n    interval: 1000\n' +
          '    from: orders\n    to: bus'
      );
    }

    const services = parseServices(doc.services);
    const hubId = requireId(doc.hub, 'hub');

    if (services.some((s) => s.id === hubId)) {
      throw new Error('distsys diagram requires `hub.id` to differ from every `services[].id`');
    }

    const knownIds = new Set([hubId, ...services.map((s) => s.id)]);
    const events = parseEvents(doc.events, knownIds);

    db.setServices(services);
    db.setHub({ id: hubId, label: labelOf(doc.hub, hubId) });
    db.setEvents(events);
  },
};
