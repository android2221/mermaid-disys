---
name: distsys-diagram
description: Use when creating, editing, or rendering a distsys-beta diagram in this repo — a YAML-based mermaid diagram type for sketching services, a hub, animated events, and static service-to-service calls.
---

# distsys-beta diagrams

## Overview

`distsys-beta` is this repo's custom mermaid diagram type: a row of **services**, a **hub**
above them, animated **events** (orbs traveling between services and the hub), and static
**calls** (plain lines for direct service-to-service relationships). It's YAML, not mermaid's
usual arrow syntax.

Full schema reference, field-by-field defaults/validation, layout internals, and the
`svgEl.distSys` controller API live in
`packages/mermaid/src/diagrams/distSys/GUIDE.md` — read it before writing anything nontrivial.
This file is just the quick-start.

## Minimal shape

```yaml
distsys-beta
services:
  - id: orders
    label: Order Service
hub:
  id: bus
  label: Event Hub
events:
  - id: order-created
    label: OrderCreated
    interval: 300
    routes:
      - from: orders
        to: bus
calls:                    # optional — static lines, no orb
  - from: orders
    to: payments
    label: charge
    bidirectional: true   # optional, default false
```

- `services[].id`/`hub.id` must all be unique; `label` defaults to `id`.
- An event is declared **once** (id, label, `interval` ms, optional `color`, optional
  `showPath: false`) and carries a `routes` list of `{from, to, label?}` hops — this is how one
  event fans out to several handlers or makes a round trip.
- `calls[].from`/`to` must both be service ids (never the hub) — route hub traffic through
  `events` instead.

## Layout — read before adding services out of order

Services lay out left-to-right in **declaration order**; that's the only positioning control.
A connector between adjacent services draws directly between them. A connector between
non-adjacent services auto-routes into its own lane below the row instead of cutting through
whatever's in between — only the two endpoint boxes grow taller to reach it. Prefer ordering
services so things that talk directly are adjacent; don't fight the auto-routing by hand.

## Rendering

```bash
pnpm build:mermaid                                   # after any renderer/parser change
pnpm render:html path/to/diagram.mmd -o out.html      # self-contained animated HTML, no server
```

Open `out.html` in a browser. Diagrams with `events` get an automatic play/pause/stop/toggle-line
control bar.

## Validation

The parser throws with the exact field path on: missing/duplicate ids, an unknown id in
`from`/`to`, `from === to`, non-positive `interval`, invalid hex `color`, or a `calls` entry
touching the hub. See the README for the complete list.
