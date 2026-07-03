import type { DiagramDefinition } from '../../diagram-api/types.js';
import { parser } from './distSysParser.js';
import { DistSysDB } from './distSysDb.js';
import styles from './distSysStyles.js';
import { renderer } from './distSysRenderer.js';

export const diagram: DiagramDefinition = {
  parser,
  get db() {
    return new DistSysDB();
  },
  renderer,
  styles,
};
