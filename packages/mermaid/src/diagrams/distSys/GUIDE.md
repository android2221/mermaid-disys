# distsys-beta diagrams

`distsys-beta` is a custom mermaid diagram type for sketching a small distributed system: a row
of **services**, a shared **hub** (a message bus / event broker) above them, **events** that
animate as orbs traveling between services and the hub, and **calls** — static lines for
direct service-to-service relationships that don't go through the hub.

It's declared as YAML, not mermaid's usual arrow syntax. This doc covers the full schema, how to
render a diagram, and the layout rules worth knowing before you draw something complex.

## Minimal example

````
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
````

The first line must be exactly `distsys-beta`. Everything after it is parsed as plain YAML.

## Top-level blocks

### `services` (required, non-empty list)

```yaml
services:
  - id: orders
    label: Order Service   # optional — defaults to id
```

- `id` — required, unique, non-empty string.
- `label` — optional display text; defaults to `id` when omitted.
- **Declaration order is the layout.** Services are laid out left-to-right in the order you list
  them — there's no other positioning control (see [Layout notes](#layout-notes)).

### `hub` (required)

```yaml
hub:
  id: bus
  label: Event Hub   # optional — defaults to id
```

A single hub bar, rendered above the service row and spanning its width. `hub.id` must be
different from every `services[].id`.

### `events` (required, non-empty list)

An event is declared **once** — a stable identity, label, interval, and optional color — and
carries a `routes` list of the hops it actually travels. This lets one event fan out to several
handlers, or make a round trip, without repeating its styling.

```yaml
events:
  - id: order-lifecycle
    label: OrderLifecycle       # optional — defaults to id
    interval: 500                # optional ms — default 1000
    showPath: true                # optional — default true
    color: "#3b82f6"               # optional — hex or CSS color name
    routes:
      - from: orders
        to: bus
        label: OrderCreated        # optional — defaults to the event's own label
      - from: bus
        to: orders
        label: OrderConfirmed
```

Field reference:

| Field      | Required | Notes |
|------------|----------|-------|
| `id`       | yes      | Unique across all events. |
| `label`    | no       | Defaults to `id`. |
| `interval` | no       | Positive milliseconds; default `1000`. Time the hub holds the event before the next one departs on the same route — only one orb travels a given route at a time. |
| `showPath` | no       | Default `true`. Set `false` to hide the connecting line — the orb(s) still animate along the (invisible) route. |
| `color`    | no       | A hex code (`#rgb` / `#rrggbb`) or a CSS color name. Recolors this event's line(s) and orb(s). The arrowhead stays neutral — SVG `<marker>` elements don't inherit color from the path referencing them. |
| `routes`   | yes      | Non-empty list of `{from, to, label?}`. |

Each route's `from`/`to` must be a known id — either a `services[].id` or the `hub.id` — and must
differ from each other. Exactly one of `from`/`to` resolves to the hub for a hub↔service route;
if neither does, it's a **direct service↔service route** (the line runs straight between the two
service boxes, bypassing the hub bar visually even though the hub still renders).

`label` on a route overrides the event's own label just for that hop; omit it to inherit the
event's label.

### `calls` (optional list)

Static, non-animated service↔service lines — for showing that two services talk to each other
directly, without modeling a specific event.

```yaml
calls:
  - from: orders
    to: payments
    label: charge          # optional
    bidirectional: true    # optional — default false, draws an arrowhead at both ends
```

- `from` / `to` must both be `services[].id` — never the hub. Route hub-involving traffic through
  `events` instead.
- `label` is optional.
- `bidirectional` (default `false`) draws arrowheads at both ends instead of just at `to`.

Calls render as dashed lines with no orb, visually distinct from animated event routes.

## Layout notes

- Services lay out left-to-right in **declaration order** — that's the only positioning control
  there is; there's no explicit x/y or grid placement in the schema.
- A connector (event route or call) between **adjacent** services draws directly in the gap
  between their boxes.
- A connector between **non-adjacent** services doesn't cut through whatever's declared in
  between. Instead it's routed through its own horizontal lane, low in the two endpoint boxes,
  entering and leaving at their facing edges. Only a box that's an actual endpoint of such a
  connector grows taller to reach its lane; a box the lane merely passes under keeps its normal
  height. Multiple non-adjacent connectors stack in their own lanes, deepest to shallowest, in
  declaration order.
- If you want to avoid non-adjacent routing entirely, order `services` so anything that talks
  directly is next to each other — the parallel-line offsetting and label widths take care of the
  rest automatically.
- Multiple connectors sharing the same pair of nodes (e.g. two events, or an event and a call, on
  the same services) are spread into parallel lines automatically — you don't need to offset
  anything yourself.

## Rendering

Rebuild the mermaid bundle after any source change, then render a `.mmd` file to a
self-contained animated HTML page (bundle inlined, no server or external files needed):

```bash
pnpm build:mermaid
pnpm render:html path/to/diagram.mmd -o path/to/diagram.html
```

Open the output file directly in a browser. For any diagram containing `events`, a play / pause /
stop / toggle-line control bar is included automatically and wired up to the live diagram.

You can also embed it the normal mermaid way — a `<pre class="mermaid">` block plus
`mermaid.run()` — see `demos/distsys.html` for a working page with several inline examples,
including one that drives the controller from page-level buttons.

## Controlling a live diagram

`mermaidAPI.render()` returns `bindFunctions`; calling it on the rendered `<svg>` attaches a
`.distSys` controller:

```js
const { svg, bindFunctions } = await mermaid.mermaidAPI.render('id', src);
mount.innerHTML = svg;
const svgEl = mount.querySelector('svg');
bindFunctions?.(svgEl);

svgEl.distSys.play();
svgEl.distSys.pause();
svgEl.distSys.stop();
svgEl.distSys.setPathVisible(false); // or .togglePath()
```

These apply to every event's stream at once. To control one specific route, use
`svgEl.distSys.events['eventId[routeIndex]']` — keyed by event id and the route's index within
that event's `routes` list (so `stock-reserved[0]` reaches the first route of the
`stock-reserved` event even when it has several).

## Validation

The parser fails loudly (with a specific field path) on: missing/duplicate ids, a route or call
referencing an unknown id, `from === to`, a non-positive `interval`, an invalid hex `color`, or a
`calls` entry that references the hub. There are no silent fallbacks beyond the documented
defaults (`label` → `id`, `interval` → `1000`, `showPath` → `true`, `bidirectional` → `false`).
