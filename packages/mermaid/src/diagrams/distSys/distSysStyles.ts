import type { DiagramStylesProvider } from '../../diagram-api/types.js';

const getStyles: DiagramStylesProvider = () => `
  .distsys-node rect {
    fill: #ECECFF;
    stroke: #9370DB;
    stroke-width: 1px;
  }

  .distsys-hub rect {
    fill: #FFF5AD;
    stroke: #AAAA33;
  }

  .distsys-node text {
    fill: #333333;
    font-size: 14px;
  }

  .distsys-edge {
    stroke: #333333;
    stroke-width: 1.5px;
    fill: none;
  }

  .distsys-arrow {
    fill: #333333;
  }

  .distsys-edge-label {
    fill: #333333;
    font-size: 12px;
  }

  .distsys-token {
    fill: #FF6B6B;
    stroke: #B33333;
    stroke-width: 1px;
  }
`;

export default getStyles;
