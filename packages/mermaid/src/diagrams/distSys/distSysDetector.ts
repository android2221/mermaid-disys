import type {
  DiagramDetector,
  DiagramLoader,
  ExternalDiagramDefinition,
} from '../../diagram-api/types.js';

const id = 'distSys';

const detector: DiagramDetector = (txt) => {
  return /^\s*distsys-beta/.test(txt);
};

const loader: DiagramLoader = async () => {
  const { diagram } = await import('./distSysDiagram.js');
  return { id, diagram };
};

const distSys: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default distSys;
