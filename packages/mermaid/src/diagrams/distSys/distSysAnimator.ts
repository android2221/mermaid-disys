import {
  attachTokenAnimation,
  NOOP_TOKEN_ANIMATION,
  type TokenAnimationController,
} from '../../rendering-util/animatedEvents.js';

/** The distsys controller is the shared token-animation controller — the animation core lives
 * in rendering-util/animatedEvents.ts so other diagram types (via `animate:` frontmatter) can
 * drive the same orbs along their own lines. This wrapper only keeps distsys's selector-based
 * call signature. */
export type DistSysAnimationController = TokenAnimationController;

export interface AttachDistSysAnimationOptions {
  /** The live (inserted-into-the-page) root SVG element. */
  svg: SVGSVGElement;
  /** CSS selector, scoped to `svg`, for the `<path>` the orb travels along. */
  pathSelector: string;
  /** CSS selector, scoped to `svg`, for the `<g>` the orb is appended to. */
  tokenGroupSelector: string;
  /** Milliseconds the orb waits at the hub before the next one departs the service. */
  interval: number;
  /** Milliseconds an orb takes to travel from one end of the path to the other. */
  travelDuration: number;
  tokenRadius: number;
  tokenClass: string;
  /** Whether the connecting line is visible on attach. The orb travels along it either way. */
  pathVisible: boolean;
}

export function attachDistSysAnimation(
  options: AttachDistSysAnimationOptions
): DistSysAnimationController {
  const { svg, pathSelector, tokenGroupSelector, ...animationOptions } = options;
  const path = svg.querySelector<SVGGeometryElement>(pathSelector);
  const tokenGroup = svg.querySelector<SVGGElement>(tokenGroupSelector);
  if (!path || !tokenGroup) {
    return NOOP_TOKEN_ANIMATION;
  }
  return attachTokenAnimation({ path, tokenGroup, ...animationOptions });
}
