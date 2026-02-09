# Common BPMN MCP Workflows

Example tool-call sequences for frequently needed BPMN modelling patterns.

---

## 1. Create a simple sequential process

Build a Start → Task → End flow from scratch.

```
1. create_bpmn_diagram        → { name: "Order Processing" }
2. add_bpmn_element           → { elementType: "bpmn:StartEvent", name: "Order Received" }
3. add_bpmn_element           → { elementType: "bpmn:UserTask",   name: "Review Order", afterElementId: "<startId>" }
4. add_bpmn_element           → { elementType: "bpmn:EndEvent",   name: "Done", afterElementId: "<taskId>" }
5. layout_bpmn_diagram        → { }
6. export_bpmn                → { format: "xml" }
```

`afterElementId` auto-positions the new element to the right and
creates a connecting sequence flow in one step.

---

## 2. Insert a task into an existing flow

Add a step between two already-connected elements without
manually deleting/reconnecting flows.

```
1. list_bpmn_elements         → find the flow ID between the two elements
2. add_bpmn_element            → { flowId: "<flowId>", elementType: "bpmn:UserTask", name: "Verify Data" }
```

The tool splits the sequence flow, creates the new element at the
midpoint, and reconnects both sides. If there isn't enough
horizontal space, downstream elements are automatically shifted
right.

---

## 3. Add a parallel branch (fork and join)

Create two tasks that execute in parallel.

```
1. add_bpmn_element           → { elementType: "bpmn:ParallelGateway", name: "Fork",  afterElementId: "<precedingTaskId>" }
2. add_bpmn_element           → { elementType: "bpmn:ServiceTask",     name: "Send Email",       afterElementId: "<forkGatewayId>", autoConnect: false }
3. add_bpmn_element           → { elementType: "bpmn:ServiceTask",     name: "Update Inventory",  afterElementId: "<forkGatewayId>", autoConnect: false }
4. connect_bpmn_elements      → { sourceElementId: "<forkGatewayId>",  targetElementId: "<emailTaskId>" }
5. connect_bpmn_elements      → { sourceElementId: "<forkGatewayId>",  targetElementId: "<inventoryTaskId>" }
6. add_bpmn_element           → { elementType: "bpmn:ParallelGateway", name: "Join" }
7. connect_bpmn_elements      → { sourceElementId: "<emailTaskId>",      targetElementId: "<joinGatewayId>" }
8. connect_bpmn_elements      → { sourceElementId: "<inventoryTaskId>",  targetElementId: "<joinGatewayId>" }
9. layout_bpmn_diagram        → { }   ← cleans up the parallel branches
```

---

## 4. Add an exclusive decision gateway

Route the flow based on a condition.

```
1. add_bpmn_element           → { elementType: "bpmn:ExclusiveGateway", name: "Order valid?", afterElementId: "<reviewTaskId>" }
2. add_bpmn_element           → { elementType: "bpmn:ServiceTask", name: "Process Order" }
3. add_bpmn_element           → { elementType: "bpmn:EndEvent",    name: "Rejected" }
4. connect_bpmn_elements      → { sourceElementId: "<gatewayId>", targetElementId: "<processTaskId>",
                                   label: "Yes", conditionExpression: "${valid == true}" }
5. connect_bpmn_elements      → { sourceElementId: "<gatewayId>", targetElementId: "<rejectedEndId>",
                                   label: "No", isDefault: true }
6. layout_bpmn_diagram        → { }
```

---

## 5. Add a user form to a task

Attach generated task form fields to a UserTask.

```
1. set_bpmn_form_data         → {
     elementId: "<userTaskId>",
     fields: [
       { id: "name",    label: "Full Name", type: "string",  validation: [{ name: "required" }] },
       { id: "email",   label: "Email",     type: "string",  validation: [{ name: "required" }] },
       { id: "amount",  label: "Amount",    type: "long",    validation: [{ name: "min", config: "1" }] },
       { id: "urgent",  label: "Urgent?",   type: "boolean", defaultValue: "false" },
       { id: "priority", label: "Priority",  type: "enum",
         values: [{ id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }] }
     ]
   }
```

---

## 6. Attach a boundary timer event

Interrupt a task after a timeout.

```
1. add_bpmn_element           → { elementType: "bpmn:BoundaryEvent", hostElementId: "<userTaskId>",
                                   name: "Timeout" }
2. set_bpmn_event_definition  → { elementId: "<boundaryEventId>",
                                   eventDefinitionType: "bpmn:TimerEventDefinition",
                                   properties: { timeDuration: "PT24H" } }
3. add_bpmn_element           → { elementType: "bpmn:EndEvent", name: "Escalated" }
4. connect_bpmn_elements      → { sourceElementId: "<boundaryEventId>", targetElementId: "<escalatedEndId>" }
```

---

## 7. Create a collaboration diagram (pool with external partner)

Model message exchange between your process and an external system.
In Camunda 7, only one pool is executable; additional pools are
collapsed to document message endpoints.

```
1. create_bpmn_collaboration  → {
     participants: [
       { name: "Order Service", collapsed: false, width: 800 },
       { name: "Payment Provider", collapsed: true }
     ]
   }
2. add_bpmn_element           → (build process inside "Order Service" pool)
   ...
3. connect_bpmn_elements      → { sourceElementId: "<sendTaskId>",
                                   targetElementId: "<paymentPoolId>" }
   (auto-detects MessageFlow for cross-pool connection)
```

---

## 8. Add error handling with an event subprocess

Handle errors that can occur anywhere in the process scope.

```
1. add_bpmn_element           → { elementType: "bpmn:SubProcess", name: "Error Handler" }
2. set_bpmn_element_properties → { elementId: "<subProcessId>",
                                    properties: { triggeredByEvent: true, isExpanded: true } }
3. add_bpmn_element           → { elementType: "bpmn:StartEvent", name: "Error Caught",
                                   participantId: "<subProcessId>" }
4. set_bpmn_event_definition  → { elementId: "<errorStartId>",
                                   eventDefinitionType: "bpmn:ErrorEventDefinition",
                                   errorRef: { id: "Error_Timeout", name: "Timeout", errorCode: "ERR_TIMEOUT" } }
5. add_bpmn_element           → { elementType: "bpmn:ServiceTask", name: "Notify Admin",
                                   afterElementId: "<errorStartId>" }
6. add_bpmn_element           → { elementType: "bpmn:EndEvent", name: "Handled",
                                   afterElementId: "<notifyTaskId>" }
```

---

## 9. Configure an external service task (Camunda 7)

```
1. add_bpmn_element            → { elementType: "bpmn:ServiceTask", name: "Send Invoice" }
2. set_bpmn_element_properties → { elementId: "<serviceTaskId>",
                                    properties: {
                                      "camunda:type": "external",
                                      "camunda:topic": "send-invoice"
                                    } }
3. set_bpmn_input_output_mapping → { elementId: "<serviceTaskId>",
                                      inputParameters:  [{ name: "orderId", value: "${orderId}" }],
                                      outputParameters: [{ name: "invoiceId", value: "${invoiceId}" }] }
```

---

## 10. Multi-instance (parallel loop) over a collection

```
1. set_bpmn_loop_characteristics → { elementId: "<taskId>",
                                      loopType: "parallel",
                                      collection: "items",
                                      elementVariable: "item" }
```

---

## Tips

- **Use `layout_bpmn_diagram` after structural changes** (adding
  gateways, parallel branches) to get a clean automatic layout.
- **Avoid full layout** on diagrams with careful manual positioning,
  boundary events, or custom labels. Use `scopeElementId` or
  `elementIds` for partial re-layout instead.
- **Use `add_bpmn_element` with `flowId`** instead of the manual 3-step pattern
  (delete flow → add element → reconnect) when adding a step into an
  existing flow.
- **Validate before exporting:** `export_bpmn` runs bpmnlint by
  default and blocks on errors. Use `validate_bpmn_diagram` to
  preview issues before export.
- **Batch operations** with `batch_bpmn_operations` to reduce
  round-trips when building complex diagrams.
