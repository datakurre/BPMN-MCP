# bpmn-js & diagram-js Programmatic Positioning API Research

> Comprehensive reference for building BPMN diagrams element-by-element with good
> positioning, without requiring a separate layout engine (like ELK).

---

## Table of Contents

1. [Default Element Sizes](#1-default-element-sizes)
2. [modeling.createShape](#2-modelingcreateshape)
3. [modeling.appendShape](#3-modelingappendshape)
4. [modeling.createConnection / modeling.connect](#4-modelingcreateconnection--modelingconnect)
5. [modeling.layoutConnection](#5-modelinglayoutconnection)
6. [AutoPlace — autoPlace.append()](#6-autoplace--autoplaceappend)
7. [BpmnAutoPlace — getNewShapePosition internals](#7-bpmnautoplace--getnewshapeposition-internals)
8. [getConnectedDistance & findFreePosition](#8-getconnecteddistance--findfreeposition)
9. [CroppingConnectionDocking](#9-croppingconnectiondocking)
10. [BpmnLayouter — BPMN-specific connection routing](#10-bpmnlayouter--bpmn-specific-connection-routing)
11. [ManhattanLayout — waypoint computation](#11-manhattanlayout--waypoint-computation)
12. [Behavior modules (auto-wiring)](#12-behavior-modules-auto-wiring)
13. [Positioning inside subprocesses and participants](#13-positioning-inside-subprocesses-and-participants)
14. [Collaborations — pools, lanes, message flows](#14-collaborations--pools-lanes-message-flows)
15. [Patterns for complex diagrams](#15-patterns-for-complex-diagrams)
16. [Limitations and gaps](#16-limitations-and-gaps)

---

## 1. Default Element Sizes

From `bpmn-js/lib/features/modeling/ElementFactory.js` — `getDefaultSize()`:

| BPMN Type                                  | Width | Height | Notes         |
| ------------------------------------------ | ----- | ------ | ------------- |
| `bpmn:Task` (all task types)               | 100   | 80     |               |
| `bpmn:SubProcess` (expanded)               | 350   | 200    |               |
| `bpmn:SubProcess` (collapsed)              | 100   | 80     | Same as Task  |
| `bpmn:Gateway` (all types)                 | 50    | 50     | Diamond shape |
| `bpmn:Event` (all types)                   | 36    | 36     | Circle        |
| `bpmn:Participant` (expanded, horizontal)  | 600   | 250    |               |
| `bpmn:Participant` (expanded, vertical)    | 250   | 600    |               |
| `bpmn:Participant` (collapsed, horizontal) | 400   | 60     | Thin bar      |
| `bpmn:Participant` (collapsed, vertical)   | 60    | 400    | Thin bar      |
| `bpmn:Lane`                                | 400   | 100    |               |
| `bpmn:DataObjectReference`                 | 36    | 50     |               |
| `bpmn:DataStoreReference`                  | 50    | 50     |               |
| `bpmn:TextAnnotation`                      | 100   | 30     |               |
| `bpmn:Group`                               | 300   | 300    |               |
| Fallback default                           | 100   | 80     |               |

Minimum dimensions (from `ResizeBehavior.js`):

| Element                         | Min Width | Min Height |
| ------------------------------- | --------- | ---------- |
| `bpmn:Participant` (horizontal) | 300       | 150        |
| `bpmn:Participant` (vertical)   | 150       | 300        |
| `bpmn:Lane` (horizontal)        | 300       | 60         |
| `bpmn:Lane` (vertical)          | 60        | 300        |
| `bpmn:SubProcess`               | 140       | 120        |
| `bpmn:TextAnnotation`           | 50        | 30         |

---

## 2. modeling.createShape

**Source:** `diagram-js/lib/command/CreateShapeHandler.js`

### Signature

```js
modeling.createShape(shape, position, target, parentIndex?, hints?)
```

- `shape` — Shape object (from `elementFactory.createShape(...)`)
- `position` — **Center point** `{ x, y }` — the handler subtracts `width/2` and `height/2`
- `target` — Parent element (process, participant, subprocess, or a sequence flow for insertion)
- `parentIndex` — Optional Z-order index
- `hints` — `{ attach: true }` for boundary events

### Internal flow

```
preExecute:
  1. Behaviors fire (e.g. CreateBehavior reparents from Lane → Participant)

execute:
  1. shape.x = position.x - round(shape.width / 2)
  2. shape.y = position.y - round(shape.height / 2)
  3. canvas.addShape(shape, parent, parentIndex)

postExecute:
  1. If dropped on a SequenceFlow → DropOnFlowBehavior triggers (split + reconnect)
  2. AutoResize checks if parent (Participant/SubProcess) needs expanding
  3. LabelBehavior creates external label if needed
```

### Key details

- **Position is center-based**: `{ x: 400, y: 200 }` means the shape center is at (400, 200). The top-left will be `(400 - width/2, 200 - height/2)`.
- **CreateBehavior** intercepts `shape.create` and reparents from Lane to Participant: `if (is(parent, 'bpmn:Lane') && !is(shape, 'bpmn:Lane')) { context.parent = getParent(parent, 'bpmn:Participant'); }`. The lane membership (flowNodeRef) is handled separately.
- **Boundary events**: Use `{ attach: true }` hint — `modeling.createShape(boundaryEvent, { x: 400, y: 140 }, hostTask, { attach: true })`. The `AttachEventBehavior` replaces IntermediateCatchEvents with BoundaryEvents when attached.

### Example

```js
const task = elementFactory.createShape({ type: 'bpmn:Task' });
// Task center at (400, 200), actual bounds: (350, 160) to (450, 240)
modeling.createShape(task, { x: 400, y: 200 }, process);
```

---

## 3. modeling.appendShape

**Source:** `diagram-js/lib/features/modeling/cmd/AppendShapeHandler.js`

### Signature

```js
modeling.appendShape(source, shape, position, target?, hints?)
```

- `source` — Existing element to append from
- `shape` — Shape to create (or shape attrs)
- `position` — Center point `{ x, y }`
- `target` — Parent (defaults to `source.parent`)
- `hints` — `{ attach, connection, connectionTarget }`

### Internal flow (AppendShapeHandler)

```
preExecute:
  1. modeling.createShape(shape, position, target, { attach: hints.attach })

postExecute:
  1. Check if a connection already exists between source and shape
  2. If not: modeling.connect(source, shape, connection)
     - If hints.connectionTarget === source: connect(shape, source) [reversed]
```

### AppendBehavior — default positioning

If `context.position` is not provided, `AppendBehavior` (bpmn-js) supplies defaults:

```js
// For TextAnnotation:
position = {
  x: source.x + source.width / 2 + 75,
  y: source.y - 50 - shape.height / 2,
};

// For all other FlowNodes:
position = {
  x: source.x + source.width + 80 + shape.width / 2,
  y: source.y + source.height / 2,
};
```

So a Task (100×80) appended to another Task at (200, 200) without explicit position would be placed at:

- x = 200 + 100 + 80 + 50 = 430 (center)
- y = 200 + 40 = 240 (center, i.e. source vertical center)

This gives a **fixed 80px gap** between elements. The `autoPlace.append()` function (Section 6) provides smarter adaptive positioning.

---

## 4. modeling.createConnection / modeling.connect

**Source:** `diagram-js/lib/features/modeling/cmd/CreateConnectionHandler.js`

### Signatures

```js
// Explicit — full control
modeling.createConnection(source, target, parentIndex?, connection, parent, hints?)

// Shorthand — auto-detects type, uses source.parent
modeling.connect(source, target, attrs?, hints?)
```

### Internal flow (CreateConnectionHandler)

```
execute:
  1. connection.source = source
  2. connection.target = target
  3. If connection.waypoints is NOT already set:
       connection.waypoints = this._layouter.layoutConnection(connection, hints)
     Key insight: pre-setting waypoints SKIPS the layouter entirely
  4. canvas.addConnection(connection, parent, parentIndex)
```

### Connection type auto-detection

When using `modeling.connect(source, target)`, the connection type is determined by `BpmnRules.canConnect()`:

- Same pool / process → `bpmn:SequenceFlow`
- Cross-pool → `bpmn:MessageFlow`
- To/from DataObjectReference / DataStoreReference → `bpmn:DataInputAssociation` or `bpmn:DataOutputAssociation`
- To/from TextAnnotation → `bpmn:Association`

### Custom docking points

```js
modeling.connect(source, target, null, {
  connectionStart: { x: 450, y: 200 }, // exit point on source
  connectionEnd: { x: 600, y: 200 }, // entry point on target
});
```

These hints are passed through to the layouter. `CroppingConnectionDocking` will crop to element borders afterward.

---

## 5. modeling.layoutConnection

**Source:** `diagram-js/lib/features/modeling/cmd/LayoutConnectionHandler.js`

### Signature

```js
modeling.layoutConnection(connection, hints?)
```

### Internal flow

```
execute:
  1. Save old waypoints for undo
  2. newWaypoints = layouter.layoutConnection(connection, hints)
  3. connection.waypoints = newWaypoints
  4. connectionDocking.getCroppedWaypoints(connection)
```

This is called automatically during `connection.create`, `shape.move`, `connection.reconnect`, etc. You rarely call it directly unless you need to force re-layout after programmatic changes.

---

## 6. AutoPlace — autoPlace.append()

**Source:** `diagram-js/lib/features/auto-place/AutoPlace.js`

### Signature

```js
autoPlace.append(source, shape, hints?)
```

### Internal flow — step by step

```
1. Fire 'autoPlace.start' event (source, shape)

2. Fire 'autoPlace' event (LOW_PRIORITY = 100)
   └─ diagram-js default handler: getNewShapePosition(source, element)
      → { x: sourceTrbl.right + DEFAULT_DISTANCE + element.width/2, y: sourceMid.y }
      where DEFAULT_DISTANCE = 50

   └─ bpmn-js BpmnAutoPlace handler (overrides via event listener):
      → getNewShapePosition(source, shape, elementRegistry)
      → Routes to getFlowNodePosition / getTextAnnotationPosition / getDataElementPosition
      (See Section 7 for full details)

3. Result position = event result (BPMN handler wins over default)

4. modeling.appendShape(source, shape, position, source.parent, hints)
   └─ Creates shape at computed position
   └─ Connects source → shape with auto-routed SequenceFlow

5. Fire 'autoPlace.end' event (shape)
```

### Key insight

`autoPlace.append()` is the **recommended API** for building diagrams element-by-element. It:

- Computes adaptive spacing based on existing connections
- Avoids collisions with already-connected elements
- Creates both the shape and the connection in one call
- Uses BPMN-specific positioning logic (gateway fan-out, boundary events, etc.)

---

## 7. BpmnAutoPlace — getNewShapePosition internals

**Source:** `bpmn-js/lib/features/auto-place/BpmnAutoPlaceUtil.js`

### Main router

```js
function getNewShapePosition(source, element, elementRegistry) {
  if (is(element, 'bpmn:TextAnnotation'))
    → getTextAnnotationPosition(source, element, horizontal)

  if (is(element, 'bpmn:DataObjectReference') || is(element, 'bpmn:DataStoreReference'))
    → getDataElementPosition(source, element, horizontal)

  if (is(element, 'bpmn:FlowNode'))
    → getFlowNodePosition(source, element, horizontal)
}
```

Where `horizontal = isDirectionHorizontal(source, elementRegistry)` — detects layout direction by analyzing existing connections.

### getFlowNodePosition (the core algorithm)

```js
function getFlowNodePosition(source, element, placeHorizontally) {
  // 1. Determine direction and minimum distance
  if (placeHorizontally) {
    directionHint = 'e'; // east (→ right)
    minDistance = 80;
  } else {
    directionHint = 's'; // south (→ down)
    minDistance = 90;
  }

  // 2. Compute adaptive connected distance
  connectedDistance = getConnectedDistance(source, {
    filter: sequenceFlowOnly, // only count sequence flow connections
    direction: directionHint, // 'e' or 's'
    // Uses default: defaultDistance=50, maxDistance=250
  });

  // 3. Handle boundary events specially
  if (is(source, 'bpmn:BoundaryEvent')) {
    orientation = getOrientation(source, source.host, -25);
    // If boundary is on left/right → invert margin
    if (placeHorizontally) {
      if (orientation.includes('top') || orientation.includes('bottom')) margin *= -1; // search upward instead
    }
  }

  // 4. Compute base position
  if (placeHorizontally) {
    position = {
      x: sourceTrbl.right + connectedDistance + element.width / 2,
      y: sourceMid.y + getDistance(orientation, minDistance, placement),
    };
  } else {
    position = {
      x: sourceMid.x + getDistance(orientation, minDistance, placement),
      y: sourceTrbl.bottom + connectedDistance + element.height / 2,
    };
  }

  // 5. Find free position (collision avoidance)
  return findFreePosition(
    source,
    element,
    position,
    generateGetNextPosition({
      [axis]: { margin: margin, minDistance: minDistance },
    })
  );
}
```

### getTextAnnotationPosition

- Places top-right (horizontal layout) or bottom-right (vertical)
- Default offset: 50px right, 40px up
- Collision avoidance: `{ y: { margin: -30, minDistance: 20 } }` — negative margin = searches upward

### getDataElementPosition

- Places bottom-right (horizontal) or bottom-left (vertical)
- Default offset: 50px right, 80px below
- Collision avoidance: `{ x: { margin: 30, minDistance: 30 } }`

---

## 8. getConnectedDistance & findFreePosition

**Source:** `diagram-js/lib/features/auto-place/AutoPlaceUtil.js`

### Constants

```js
DEFAULT_DISTANCE = 50; // default gap between elements
DEFAULT_MAX_DISTANCE = 250; // cap to prevent elements drifting too far
PLACEMENT_DETECTION_PAD = 10; // overlap detection padding
```

### getConnectedDistance

```js
getConnectedDistance(source, hints?)
```

Computes the optimal distance from `source` to place a new element, based on distances to existing connected elements.

**Parameters:**

- `hints.defaultDistance` — fallback distance (default: 50)
- `hints.direction` — `'e'` (east), `'w'`, `'n'`, `'s'`
- `hints.filter` — function to filter connections (e.g. `sequenceFlowOnly`)
- `hints.getWeight` — weight function for distance averaging
- `hints.maxDistance` — cap (default: 250)
- `hints.reference` — `'center'` or `'edge'` reference point

**Algorithm:**

1. Get all connections matching the filter
2. For each connected target in the specified direction:
   - Compute the edge-to-edge distance from source to target
3. Return weighted average distance (or `defaultDistance` if no connections exist)
4. Clamp to `[0, maxDistance]`

**Effect:** If a source already has targets 120px away, the next element will be placed ~120px away too, creating consistent spacing.

### findFreePosition

```js
findFreePosition(source, element, position, getNextPosition);
```

Iterates positions until it finds one that doesn't overlap with existing connected elements.

**Algorithm:**

1. Check if `position` overlaps any element connected to `source` (with 10px padding)
2. If overlap: call `getNextPosition(element, position, connectedAtPosition)`
3. Repeat until free position found

### generateGetNextPosition

```js
generateGetNextPosition({ y: { margin: 30, minDistance: 80 } });
// or
generateGetNextPosition({ x: { margin: 30, minDistance: 30 } });
```

Creates an iterator that shifts position along the specified axis:

- `margin` — step size and direction (positive = down/right, negative = up/left)
- `minDistance` — minimum distance from the overlapping element

**For gateway fan-out (horizontal layout):**
The default `getFlowNodePosition` uses `{ y: { margin: 30, minDistance: 80 } }`:

- First element: placed at source center-y
- If overlap: shift 30px down, ensure 80px min gap
- If overlap again: shift another 30px down
- This creates a **vertical fan-out pattern** from gateways

**Answer to "Does findFreePosition handle gateway fan-out?":**
Yes, it does — but with limitations. It shifts perpendicular to the flow direction (vertically for horizontal layouts). It creates a cascading fan pattern, not a symmetric one. Elements fan out in one direction (downward for horizontal layouts). For a symmetric gateway split you'd need custom positioning.

---

## 9. CroppingConnectionDocking

**Source:** `diagram-js/lib/layout/CroppingConnectionDocking.js`

### Purpose

Crops connection waypoints to element borders. Without this, waypoints connect to element centers, creating lines that pass through shapes.

### Key methods

```js
// Get cropped waypoints for a connection
getCroppedWaypoints(connection, source?, target?)
// Returns: waypoints[] with first/last points cropped to shape borders

// Get docking point for one end
getDockingPoint(connection, shape, dockStart?)
// Returns: { point, actual, idx }
//   point  — the uncropped reference point
//   actual — the cropped border intersection point
//   idx    — waypoint index
```

### How it works

1. Get the SVG path outline of the shape (circle for events, rounded rect for tasks, diamond for gateways)
2. Create a line segment from the second waypoint to the first (or second-to-last to last)
3. Find the intersection of this line with the shape path
4. Replace the endpoint with the intersection point

### Registration

```js
// bpmn-js/lib/features/modeling/index.js
connectionDocking: ['type', CroppingConnectionDocking];
```

This is automatically applied during `connection.create` and `connection.layout` operations.

---

## 10. BpmnLayouter — BPMN-specific connection routing

**Source:** `bpmn-js/lib/features/modeling/BpmnLayouter.js` (488 lines)

### Registration

```js
// bpmn-js/lib/features/modeling/index.js
layouter: ['type', BpmnLayouter];
```

Extends `BaseLayouter` from diagram-js. Registered in DI as `layouter`.

### Preferred layout tables

**Horizontal layout** (`PREFERRED_LAYOUTS_HORIZONTAL`):

| Scenario                  | Preferred layouts     | Effect                                        |
| ------------------------- | --------------------- | --------------------------------------------- |
| **Default** (task→task)   | `['h:h']`             | Horizontal exit → horizontal entry            |
| **From Gateway**          | `['v:h']`             | Vertical exit → horizontal entry              |
| **To Gateway**            | `['h:v']`             | Horizontal exit → vertical entry              |
| **Message Flow**          | `['straight', 'v:v']` | Try straight first, then vertical-to-vertical |
| **SubProcess** (expanded) | `['straight', 'h:h']` | Try straight, then horizontal                 |
| **Loop: from top**        | `['t:r']`             | Top → right (clockwise)                       |
| **Loop: from right**      | `['r:b']`             | Right → bottom                                |
| **Loop: from bottom**     | `['b:l']`             | Bottom → left                                 |
| **Loop: from left**       | `['l:t']`             | Left → top                                    |

**Vertical layout** (`PREFERRED_LAYOUTS_VERTICAL`): Mirror of horizontal but counter-clockwise.

### layoutConnection flow

```
layoutConnection(connection, hints):
  1. Get source/target shapes
  2. Determine connectionStart/connectionEnd from hints

  3. If Association:
     → Preserve existing waypoints (Associations are NOT manhattan-routed)
     → Return current waypoints

  4. Detect layout direction: isDirectionHorizontal(source, elementRegistry)

  5. Select manhattanOptions based on element types:
     a. MessageFlow → getMessageFlowManhattanOptions: ['straight', 'v:v']
     b. Self-loop (source === target) → getLoopPreferredLayout
     c. BoundaryEvent source → getBoundaryEventPreferredLayouts
     d. Expanded SubProcess involved → layout.subProcess with preserveDocking
     e. Gateway as source → layout.fromGateway: ['v:h']
     f. Gateway as target → layout.toGateway: ['h:v']
     g. Default → layout.default: ['h:h']

  6. Call repairConnection(source, target, start, end, waypoints, manhattanOptions)
  7. Remove redundant points with withoutRedundantPoints()
  8. Return waypoints
```

### Boundary event layout

`getBoundaryEventPreferredLayouts(source, target, end, layout)`:

1. Determine attach orientation: `getOrientation(getMid(source), source.host, -10)`
2. Handle loop case (target === source.host): uses `layout.boundaryLoop`
3. For side-attached boundaries:
   - Map orientation to direction (`'right' → 'r'`, `'bottom' → 'b'`, etc.)
   - Source layout = mapped direction
   - Target layout determined by relative position
4. For corner-attached boundaries: picks the direction component that faces away from host

**`BOUNDARY_TO_HOST_THRESHOLD = 40`**: Used to detect when boundary event flow loops back to host.

### Gateway layout — why v:h and h:v?

Gateways use `'v:h'` (from gateway) and `'h:v'` (to gateway) to create cleaner branching patterns:

- **From gateway**: The connection exits vertically (up/down from the diamond point) then routes horizontally to the target. This creates the classic diamond-to-task "branch" shape.
- **To gateway**: The connection enters vertically (into the diamond point), creating clean merge visuals.

---

## 11. ManhattanLayout — waypoint computation

**Source:** `diagram-js/lib/layout/ManhattanLayout.js`

### Core functions

#### connectRectangles

```js
connectRectangles(source, target, start, end, hints);
```

Main entry point. Determines orientation between rectangles, picks direction pair, computes docking points, and delegates to `connectPoints`.

**Algorithm:**

1. Get orientation of target relative to source
2. Based on orientation + preferred layout hints, determine directions:
   - `'h:h'` → horizontal on both sides
   - `'v:v'` → vertical on both sides
   - `'h:v'`, `'v:h'` → mixed
   - Explicit: `'r:b'`, `'t:l'`, etc.
3. Compute docking points on source/target borders
4. Call `connectPoints(startPoint, endPoint, directions)`

#### connectPoints

```js
connectPoints(a, b, directions);
```

Creates manhattan (orthogonal) waypoints between two points.

For `'h:h'` layout:

```
source ──────┐
             │
             └────── target
```

For `'v:h'` layout (gateway → task):

```
     ◇ gateway
     │
     └────── task
```

#### repairConnection

```js
repairConnection(source, target, start, end, waypoints, hints);
```

Tries multiple strategies in order:

1. **Straight connection** — 2 points if source and target are aligned
2. **Repair from end** — keep existing start waypoints, repair the end
3. **Repair from start** — keep existing end waypoints, repair the start
4. **Full reconnect** — fall back to `connectRectangles`

### Critical limitation: NO obstacle avoidance

ManhattanLayout routes connections **only between source and target rectangles**. It does NOT:

- Route around intermediate elements
- Avoid crossing other connections
- Consider the positions of other shapes in the diagram

The routing is purely geometric between the two connected shapes. This is a fundamental design decision — obstacle avoidance would require global knowledge and be computationally expensive.

---

## 12. Behavior modules (auto-wiring)

**Source:** `bpmn-js/lib/features/modeling/behavior/index.js`

### All registered behaviors

| Behavior                             | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| **AppendBehavior**                   | Provides default position when `appendShape` has no position                 |
| **CreateBehavior**                   | Reparents from Lane to Participant on shape create                           |
| **DropOnFlowBehavior**               | Splits a SequenceFlow and inserts shape when dropped on flow                 |
| **CreateParticipantBehavior**        | Sizes participant to fit existing elements, forces hovering process          |
| **AttachEventBehavior**              | Replaces IntermediateCatchEvent with BoundaryEvent when attached             |
| **BoundaryEventBehavior**            | Removes boundary events from ReceiveTask when connected to EventBasedGateway |
| **LabelBehavior**                    | Creates/updates external labels on shape/connection create                   |
| **AdaptiveLabelPositioningBehavior** | Repositions external labels to avoid overlaps                                |
| **LayoutConnectionBehavior**         | Updates Associations connected to Connections when connection moves          |
| **ReplaceConnectionBehavior**        | Replaces SequenceFlow ↔ MessageFlow on cross-pool moves                      |
| **MessageFlowBehavior**              | Updates message flow anchors on participant collapse/expand                  |
| **EventBasedGatewayBehavior**        | Removes duplicate incoming flows on event-based gateway targets              |
| **DataInputAssociationBehavior**     | Manages fake targetRef for DataInputAssociation (schema compliance)          |
| **DataStoreBehavior**                | Moves DataStoreReference to correct parent scope                             |
| **CompensateBoundaryEventBehavior**  | Manages single compensation activity connection                              |
| **ResizeBehavior**                   | Enforces minimum dimensions on resize                                        |
| **SubProcessPlaneBehavior**          | Manages collapsed subprocess drill-down planes                               |
| **GroupBehavior**                    | Creates CategoryValue for Group elements                                     |
| **IsHorizontalFix**                  | Ensures isHorizontal is set on pools/lanes                                   |
| **ImportDockingFix**                 | Fixes connection docking on import                                           |

### DropOnFlowBehavior — inserting into flows

When you call `modeling.createShape(shape, position, sequenceFlow)` with a SequenceFlow as the parent:

1. The flow is split at the insertion point
2. Source → new shape connection is created (reuses original flow)
3. New shape → target connection is created (new flow)
4. Waypoints are recalculated for both connections

```js
// Drop a task onto an existing sequence flow
const task = elementFactory.createShape({ type: 'bpmn:Task' });
modeling.createShape(task, { x: 340, y: 120 }, existingSequenceFlow);
// Result: source ──→ task ──→ target (original flow split)
```

---

## 13. Positioning inside subprocesses and participants

### Subprocesses

Elements inside expanded subprocesses use coordinates relative to the **canvas** (not the subprocess). The subprocess acts as a visual container, and `BpmnAutoResize` ensures it grows to fit:

```js
// Create expanded subprocess
const subProcessBO = bpmnFactory.create('bpmn:SubProcess', {
  triggeredByEvent: false,
  isExpanded: true,
});
const subProcess = elementFactory.createShape({
  type: 'bpmn:SubProcess',
  businessObject: subProcessBO,
  isExpanded: true,
});
modeling.createShape(subProcess, { x: 400, y: 300 }, process);
// SubProcess bounds: (225, 200) to (575, 400) — 350×200 default

// Add start event INSIDE the subprocess
const start = elementFactory.createShape({ type: 'bpmn:StartEvent' });
modeling.createShape(start, { x: 275, y: 300 }, subProcess);
// Position is canvas-absolute, but start becomes child of subProcess
```

**Auto-resize**: When elements are added or moved inside a subprocess, `BpmnAutoResize` automatically expands the subprocess bounds to fit with padding (default ~20px).

### Event subprocesses

```js
const eventSubProcessBO = bpmnFactory.create('bpmn:SubProcess', {
  triggeredByEvent: true,
  isExpanded: true,
});
const eventSubProcess = elementFactory.createShape({
  type: 'bpmn:SubProcess',
  businessObject: eventSubProcessBO,
  isExpanded: true,
});
modeling.createShape(eventSubProcess, { x: 300, y: 500 }, process);

// Timer start event inside event subprocess
const timerStart = elementFactory.createShape({
  type: 'bpmn:StartEvent',
  eventDefinitionType: 'bpmn:TimerEventDefinition',
});
modeling.createShape(timerStart, { x: 200, y: 500 }, eventSubProcess);
```

### Participants (pools)

When creating the first participant, the existing process elements are wrapped:

```js
const participant = elementFactory.createParticipantShape();
// CreateParticipantBehavior computes bounds to fit existing elements
// with padding: { top: 20, right: 20, bottom: 20, left: 50 }
modeling.createShape(participant, { x: 400, y: 200 }, process);
// → Converts to collaboration, wraps existing elements
```

### Boundary events

```js
const boundaryEvent = elementFactory.createShape({
  type: 'bpmn:BoundaryEvent',
  eventDefinitionType: 'bpmn:ErrorEventDefinition',
});
// Position is on the border of the host task
modeling.createShape(boundaryEvent, { x: 450, y: 240 }, hostTask, { attach: true });
// x=450 is on the right edge of a task at x=350..450
// y=240 is on the bottom edge of a task at y=160..240
```

---

## 14. Collaborations — pools, lanes, message flows

### Creating a collaboration from scratch

```js
// Method 1: Create participant on process → auto-converts to collaboration
const participant = elementFactory.createParticipantShape();
modeling.createShape(participant, { x: 400, y: 200 }, process);

// Method 2: Create participant with explicit process
const participant = elementFactory.createParticipantShape({
  type: 'bpmn:Participant',
  isExpanded: true,
});
modeling.createShape(participant, { x: 400, y: 200 }, process);
```

### Adding collapsed (partner) pools

```js
const collapsed = elementFactory.createParticipantShape({
  type: 'bpmn:Participant',
  isExpanded: false, // → collapsed pool (thin bar, 400×60)
});
modeling.createShape(collapsed, { x: 400, y: 500 }, rootElement);
```

### Message flows

```js
// Cross-pool connections auto-detect as MessageFlow
modeling.connect(elementInPool1, elementInPool2);
// → creates bpmn:MessageFlow

// Or to/from collapsed pool
modeling.connect(elementInPool1, collapsedParticipant);
```

### Lanes

```js
// Add lane to participant
modeling.addLane(participant, 'bottom'); // or 'top'

// Split a lane into multiple
modeling.splitLane(lane, 2); // splits into 2 equal lanes
```

### CreateParticipantBehavior — auto-sizing

When creating the first participant on a process with existing elements:

```js
function getParticipantBounds(shape, childrenBBox) {
  // Computes bounds that enclose all existing children
  // with padding: top=20, right=20, bottom=20, left=50
  // left=50 accounts for the pool header label
}
```

---

## 15. Patterns for complex diagrams

### Linear chain with autoPlace

```js
const start = elementFactory.createShape({ type: 'bpmn:StartEvent' });
modeling.createShape(start, { x: 200, y: 200 }, process);

const task1 = elementFactory.createShape({ type: 'bpmn:UserTask' });
autoPlace.append(start, task1); // positioned right of start, connected

const task2 = elementFactory.createShape({ type: 'bpmn:ServiceTask' });
autoPlace.append(task1, task2); // positioned right of task1, connected

const end = elementFactory.createShape({ type: 'bpmn:EndEvent' });
autoPlace.append(task2, end); // positioned right of task2, connected
```

### Gateway branching (exclusive)

```js
// Create gateway after a task
const gateway = elementFactory.createShape({ type: 'bpmn:ExclusiveGateway' });
autoPlace.append(previousTask, gateway);

// Branch 1 — autoPlace handles the first branch
const approveTask = elementFactory.createShape({ type: 'bpmn:UserTask' });
autoPlace.append(gateway, approveTask);
// Position: right of gateway, center-aligned

// Branch 2 — autoPlace shifts down via findFreePosition
const rejectTask = elementFactory.createShape({ type: 'bpmn:UserTask' });
autoPlace.append(gateway, rejectTask);
// Position: right of gateway, shifted ~80-110px below branch 1

// Branch 3 — shifts down again
const escalateTask = elementFactory.createShape({ type: 'bpmn:UserTask' });
autoPlace.append(gateway, escalateTask);
// Position: right of gateway, shifted further down
```

### Manual positioning for symmetric branches

For a clean symmetric gateway split, use manual positioning:

```js
const gateway = elementFactory.createShape({ type: 'bpmn:ExclusiveGateway' });
modeling.createShape(gateway, { x: 500, y: 200 }, process);
modeling.connect(previousTask, gateway);

// Symmetric branches
const taskA = elementFactory.createShape({ type: 'bpmn:Task' });
modeling.createShape(taskA, { x: 700, y: 100 }, process); // above center
modeling.connect(gateway, taskA);

const taskB = elementFactory.createShape({ type: 'bpmn:Task' });
modeling.createShape(taskB, { x: 700, y: 300 }, process); // below center
modeling.connect(gateway, taskB);

// Merge gateway
const mergeGw = elementFactory.createShape({ type: 'bpmn:ExclusiveGateway' });
modeling.createShape(mergeGw, { x: 900, y: 200 }, process);
modeling.connect(taskA, mergeGw);
modeling.connect(taskB, mergeGw);
```

### Parallel branches

```js
const parallelSplit = elementFactory.createShape({ type: 'bpmn:ParallelGateway' });
autoPlace.append(previousTask, parallelSplit);

const branch1 = elementFactory.createShape({ type: 'bpmn:Task' });
const branch2 = elementFactory.createShape({ type: 'bpmn:Task' });

// Manual positioning for parallel branches
modeling.createShape(branch1, { x: 700, y: 100 }, process);
modeling.createShape(branch2, { x: 700, y: 300 }, process);
modeling.connect(parallelSplit, branch1);
modeling.connect(parallelSplit, branch2);

const parallelJoin = elementFactory.createShape({ type: 'bpmn:ParallelGateway' });
modeling.createShape(parallelJoin, { x: 900, y: 200 }, process);
modeling.connect(branch1, parallelJoin);
modeling.connect(branch2, parallelJoin);
```

### Multiple elements at once

```js
const shapes = [
  elementFactory.createShape({ type: 'bpmn:StartEvent' }),
  elementFactory.createShape({ type: 'bpmn:UserTask' }),
];
modeling.createElements(shapes, { x: 300, y: 200 }, process);
// Elements are placed relative to each other within the group
```

### Subprocess with internal flow

```js
// Create expanded subprocess
const subProcess = elementFactory.createShape({
  type: 'bpmn:SubProcess',
  isExpanded: true,
});
modeling.createShape(subProcess, { x: 500, y: 300 }, process);
// Bounds: 325..675 x 200..400 (350×200 default)

// Add elements inside — use absolute canvas coordinates
const subStart = elementFactory.createShape({ type: 'bpmn:StartEvent' });
modeling.createShape(subStart, { x: 370, y: 300 }, subProcess);

const subTask = elementFactory.createShape({ type: 'bpmn:UserTask' });
modeling.createShape(subTask, { x: 500, y: 300 }, subProcess);
modeling.connect(subStart, subTask);

const subEnd = elementFactory.createShape({ type: 'bpmn:EndEvent' });
modeling.createShape(subEnd, { x: 620, y: 300 }, subProcess);
modeling.connect(subTask, subEnd);
// AutoResize may expand subprocess if elements extend beyond bounds
```

---

## 16. Limitations and gaps

### Fundamental limitations

1. **No obstacle avoidance in ManhattanLayout**
   - Connections route only between source and target rectangles
   - They will freely cross other shapes and connections
   - For complex diagrams, connections may visually overlap with elements

2. **No global layout capability**
   - There's no built-in way to arrange an entire diagram
   - `autoPlace` works element-by-element from a source, not globally
   - For full diagram layout, you need ELK, dagre, or another external engine

3. **Gateway fan-out is directional, not symmetric**
   - `findFreePosition` shifts elements in one direction (down for horizontal)
   - Cannot create symmetric splits (e.g. one branch up, one branch down)
   - Manual positioning required for symmetric gateway patterns

4. **No cross-connection avoidance**
   - When multiple connections share a path, they will overlap
   - No automatic spacing between parallel connections

### Gaps requiring custom code

1. **Symmetric gateway branches**: `autoPlace` always fans out downward. For symmetric diamond patterns, manually compute positions.

2. **Merge gateways**: `autoPlace.append` from multiple sources to the same target won't automatically position the merge gateway optimally. Manually compute the vertical center of the branches.

3. **Pool height synchronization**: When adding lanes or elements, pool heights need manual management. `AutoResize` helps but doesn't synchronize across pools in a collaboration.

4. **Connection label placement**: ManhattanLayout doesn't account for labels. `AdaptiveLabelPositioningBehavior` helps but can still produce suboptimal results.

5. **Backward connections (loops)**: `autoPlace` always places elements forward. For loop-back connections, manually position elements and connect them. The BpmnLayouter handles loop routing (clockwise/counter-clockwise) once the connection exists.

6. **Consistent spacing across parallel paths**: When building parallel branches, `getConnectedDistance` provides adaptive spacing per-connection but doesn't ensure global consistency. You may get different horizontal spacing on different branches.

### What works well without ELK

- **Linear sequences**: `autoPlace.append()` produces clean left-to-right chains
- **Simple branching**: First 2-3 branches from a gateway position well
- **Boundary events**: Positioning and connection routing are well-handled
- **Message flows**: Straight or manhattan routing between pools works
- **Connection routing**: BpmnLayouter produces good manhattan routes for individual connections
- **Adaptive spacing**: `getConnectedDistance` keeps spacing consistent per element

### When you need ELK

- Diagrams with more than ~15-20 elements
- Complex branching with multiple merge points
- Diagrams requiring minimal connection crossings
- Nested subprocesses with internal flow
- Reorganizing existing diagrams
- Any scenario requiring global layout optimization
