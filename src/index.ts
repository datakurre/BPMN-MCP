#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} = require("@modelcontextprotocol/sdk/types.js");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

let BpmnModeler: any;
let jsdomInstance: any;

interface DiagramState {
  modeler: any;
  xml: string;
  elementIdMap: Map<string, string>;
}

// In-memory storage for diagrams (keyed by diagram ID)
const diagrams = new Map<string, DiagramState>();

// Create a headless canvas for bpmn-js
function createHeadlessCanvas(): any {
  if (!jsdomInstance) {
    // Load the browser bundle
    const bpmnJsPath = path.join(__dirname, '../node_modules/bpmn-js/dist/bpmn-modeler.development.js');
    const bpmnJsBundle = fs.readFileSync(bpmnJsPath, 'utf-8');

    // Create jsdom with the script
    jsdomInstance = new JSDOM(
      "<!DOCTYPE html><html><body><div id='canvas'></div></body></html>",
      { runScripts: "outside-only" }
    );

    // Add CSS polyfill
    (jsdomInstance.window as any).CSS = {
      escape: (str: string) => str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
    };

    // Add structuredClone polyfill
    if (!(jsdomInstance.window as any).structuredClone) {
      (jsdomInstance.window as any).structuredClone = function(obj: any) {
        return JSON.parse(JSON.stringify(obj));
      };
    }

    // Add SVGMatrix constructor
    (jsdomInstance.window as any).SVGMatrix = function() {
      return {
        a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
        inverse: function() { return this; },
        multiply: function() { return this; },
        translate: function(x: number, y: number) {
          this.e += x;
          this.f += y;
          return this;
        },
        scale: function(s: number) {
          this.a *= s;
          this.d *= s;
          return this;
        }
      };
    };

    // Add SVG polyfills
    const SVGElement = jsdomInstance.window.SVGElement;
    const SVGGraphicsElement = (jsdomInstance.window as any).SVGGraphicsElement;

    // Polyfill getBBox
    if (SVGElement && !SVGElement.prototype.getBBox) {
      SVGElement.prototype.getBBox = function() {
        return { x: 0, y: 0, width: 100, height: 100 };
      };
    }

    // Polyfill getScreenCTM
    if (SVGElement && !SVGElement.prototype.getScreenCTM) {
      SVGElement.prototype.getScreenCTM = function() {
        return {
          a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
          inverse: function() { return this; },
          multiply: function() { return this; },
          translate: function() { return this; }
        };
      };
    }

    // Polyfill transform property
    const transformProp = {
      get: function(this: any): any {
        if (!this._transform) {
          const transformList = {
            numberOfItems: 0,
            _items: [] as any[],
            consolidate: function() { return null; },
            clear: function() {
              this._items = [];
              this.numberOfItems = 0;
            },
            initialize: function(newItem: any) {
              this._items = [newItem];
              this.numberOfItems = 1;
              return newItem;
            },
            getItem: function(index: number) {
              return this._items[index];
            },
            insertItemBefore: function(newItem: any, index: number) {
              this._items.splice(index, 0, newItem);
              this.numberOfItems = this._items.length;
              return newItem;
            },
            replaceItem: function(newItem: any, index: number) {
              this._items[index] = newItem;
              return newItem;
            },
            removeItem: function(index: number) {
              const item = this._items.splice(index, 1)[0];
              this.numberOfItems = this._items.length;
              return item;
            },
            appendItem: function(newItem: any) {
              this._items.push(newItem);
              this.numberOfItems = this._items.length;
              return newItem;
            },
            createSVGTransformFromMatrix: function(matrix: any) {
              return { type: 1, matrix, angle: 0 };
            }
          };
          this._transform = {
            baseVal: transformList,
            animVal: transformList
          };
        }
        return this._transform;
      }
    };

    if (SVGGraphicsElement) {
      Object.defineProperty(SVGGraphicsElement.prototype, 'transform', transformProp);
    }
    if (SVGElement) {
      Object.defineProperty(SVGElement.prototype, 'transform', transformProp);
    }

    // Polyfill createSVGMatrix and createSVGTransform for SVGSVGElement
    const SVGSVGElement = (jsdomInstance.window as any).SVGSVGElement;
    if (SVGSVGElement) {
      if (!SVGSVGElement.prototype.createSVGMatrix) {
        SVGSVGElement.prototype.createSVGMatrix = function() {
          return {
            a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
            inverse: function() { return this; },
            multiply: function() { return this; },
            translate: function(x: number, y: number) { return this; },
            scale: function(s: number) { return this; }
          };
        };
      }
      if (!SVGSVGElement.prototype.createSVGTransform) {
        SVGSVGElement.prototype.createSVGTransform = function() {
          return {
            type: 0,
            matrix: this.createSVGMatrix(),
            angle: 0,
            setMatrix: function(matrix: any) {},
            setTranslate: function(tx: number, ty: number) {},
            setScale: function(sx: number, sy: number) {},
            setRotate: function(angle: number, cx: number, cy: number) {}
          };
        };
      }
    }

    // Execute the bundle in the jsdom context
    jsdomInstance.window.eval(bpmnJsBundle);

    // Set globals (don't set navigator as it's read-only)
    (global as any).document = jsdomInstance.window.document;
    (global as any).window = jsdomInstance.window;

    // Get BpmnModeler from the window object
    BpmnModeler = (jsdomInstance.window as any).BpmnJS;
  }

  return jsdomInstance.window.document.getElementById("canvas")!;
}

// Create a new BPMN modeler instance
async function createModeler(): Promise<any> {
  const container = createHeadlessCanvas();
  const modeler = new BpmnModeler({ container });

  // Create a minimal BPMN diagram
  const initialXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  await modeler.importXML(initialXml);
  return modeler;
}

// Generate a unique diagram ID
function generateDiagramId(): string {
  return `diagram_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const server = new Server(
  {
    name: "bpmn-js-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_bpmn_diagram",
        description: "Create a new BPMN diagram. Returns a diagram ID that can be used with other tools.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Optional name for the diagram",
            },
          },
        },
      },
      {
        name: "add_bpmn_element",
        description: "Add an element (task, gateway, event, etc.) to a BPMN diagram",
        inputSchema: {
          type: "object",
          properties: {
            diagramId: {
              type: "string",
              description: "The diagram ID returned from create_bpmn_diagram",
            },
            elementType: {
              type: "string",
              enum: [
                "bpmn:StartEvent",
                "bpmn:EndEvent",
                "bpmn:Task",
                "bpmn:UserTask",
                "bpmn:ServiceTask",
                "bpmn:ScriptTask",
                "bpmn:ManualTask",
                "bpmn:BusinessRuleTask",
                "bpmn:SendTask",
                "bpmn:ReceiveTask",
                "bpmn:ExclusiveGateway",
                "bpmn:ParallelGateway",
                "bpmn:InclusiveGateway",
                "bpmn:EventBasedGateway",
                "bpmn:IntermediateCatchEvent",
                "bpmn:IntermediateThrowEvent",
                "bpmn:SubProcess",
              ],
              description: "The type of BPMN element to add",
            },
            name: {
              type: "string",
              description: "The name/label for the element",
            },
            x: {
              type: "number",
              description: "X coordinate for the element (default: 100)",
            },
            y: {
              type: "number",
              description: "Y coordinate for the element (default: 100)",
            },
          },
          required: ["diagramId", "elementType"],
        },
      },
      {
        name: "connect_bpmn_elements",
        description: "Connect two BPMN elements with a sequence flow",
        inputSchema: {
          type: "object",
          properties: {
            diagramId: {
              type: "string",
              description: "The diagram ID",
            },
            sourceElementId: {
              type: "string",
              description: "The ID of the source element",
            },
            targetElementId: {
              type: "string",
              description: "The ID of the target element",
            },
            label: {
              type: "string",
              description: "Optional label for the sequence flow",
            },
          },
          required: ["diagramId", "sourceElementId", "targetElementId"],
        },
      },
      {
        name: "export_bpmn_xml",
        description: "Export a BPMN diagram as XML",
        inputSchema: {
          type: "object",
          properties: {
            diagramId: {
              type: "string",
              description: "The diagram ID",
            },
          },
          required: ["diagramId"],
        },
      },
      {
        name: "export_bpmn_svg",
        description: "Export a BPMN diagram as SVG",
        inputSchema: {
          type: "object",
          properties: {
            diagramId: {
              type: "string",
              description: "The diagram ID",
            },
          },
          required: ["diagramId"],
        },
      },
      {
        name: "list_bpmn_elements",
        description: "List all elements in a BPMN diagram",
        inputSchema: {
          type: "object",
          properties: {
            diagramId: {
              type: "string",
              description: "The diagram ID",
            },
          },
          required: ["diagramId"],
        },
      },
      {
        name: "import_bpmn_xml",
        description: "Import an existing BPMN XML diagram",
        inputSchema: {
          type: "object",
          properties: {
            xml: {
              type: "string",
              description: "The BPMN XML to import",
            },
          },
          required: ["xml"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create_bpmn_diagram": {
        const diagramId = generateDiagramId();
        const modeler = await createModeler();
        const { xml } = await modeler.saveXML({ format: true });

        diagrams.set(diagramId, {
          modeler,
          xml: xml || "",
          elementIdMap: new Map(),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                diagramId,
                message: `Created new BPMN diagram with ID: ${diagramId}`,
              }, null, 2),
            },
          ],
        };
      }

      case "add_bpmn_element": {
        const { diagramId, elementType, name: elementName, x = 100, y = 100 } = args as any;
        const diagram = diagrams.get(diagramId);

        if (!diagram) {
          throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
        }

        const modeling = diagram.modeler.get("modeling");
        const elementFactory = diagram.modeler.get("elementFactory");
        const elementRegistry = diagram.modeler.get("elementRegistry");

        // Get the process element
        const process = elementRegistry.filter((element: any) => {
          return element.type === "bpmn:Process";
        })[0];

        // Create the shape
        const shape = elementFactory.createShape({ type: elementType });
        const createdElement = modeling.createShape(
          shape,
          { x, y },
          process
        );

        // Set the name if provided
        if (elementName) {
          modeling.updateProperties(createdElement, { name: elementName });
        }

        // Store the element ID
        diagram.elementIdMap.set(createdElement.id, elementType);

        // Update stored XML
        const { xml } = await diagram.modeler.saveXML({ format: true });
        diagram.xml = xml || "";

        // Check if this element should typically be connected
        const needsConnection = elementType.includes('Event') || elementType.includes('Task') || elementType.includes('Gateway');
        const hint = needsConnection ? ' (not connected - use connect_bpmn_elements to create sequence flows)' : '';

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                elementId: createdElement.id,
                elementType,
                name: elementName,
                position: { x, y },
                message: `Added ${elementType} to diagram${hint}`,
              }, null, 2),
            },
          ],
        };
      }

      case "connect_bpmn_elements": {
        const { diagramId, sourceElementId, targetElementId, label } = args as any;
        const diagram = diagrams.get(diagramId);

        if (!diagram) {
          throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
        }

        const modeling = diagram.modeler.get("modeling");
        const elementRegistry = diagram.modeler.get("elementRegistry");

        const source = elementRegistry.get(sourceElementId);
        const target = elementRegistry.get(targetElementId);

        if (!source || !target) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Source or target element not found`
          );
        }

        // Create connection
        const connection = modeling.connect(source, target, {
          type: "bpmn:SequenceFlow",
        });

        // Set label if provided
        if (label) {
          modeling.updateProperties(connection, { name: label });
        }

        // Update stored XML
        const { xml } = await diagram.modeler.saveXML({ format: true });
        diagram.xml = xml || "";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                connectionId: connection.id,
                message: `Connected ${sourceElementId} to ${targetElementId}`,
              }, null, 2),
            },
          ],
        };
      }

      case "export_bpmn_xml": {
        const { diagramId } = args as any;
        const diagram = diagrams.get(diagramId);

        if (!diagram) {
          throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
        }

        const { xml } = await diagram.modeler.saveXML({ format: true });

        // Check for disconnected elements
        const elementRegistry = diagram.modeler.get("elementRegistry");
        const elements = elementRegistry.filter((element: any) => {
          return element.type && (element.type.includes('Event') || element.type.includes('Task') || element.type.includes('Gateway'));
        });
        const sequenceFlows = elementRegistry.filter((element: any) => {
          return element.type === "bpmn:SequenceFlow";
        });

        const warnings: string[] = [];
        if (elements.length > 1 && sequenceFlows.length === 0) {
          warnings.push(`⚠️ Note: Diagram has ${elements.length} elements but no sequence flows. Workflows typically need connections between elements. Use connect_bpmn_elements to add flows.`);
        } else if (elements.length > sequenceFlows.length + 1) {
          warnings.push(`💡 Tip: ${elements.length} elements with ${sequenceFlows.length} sequence flows - some elements may be disconnected.`);
        }

        return {
          content: [
            {
              type: "text",
              text: xml || "",
            },
            ...(warnings.length > 0 ? [{
              type: "text" as const,
              text: "\n" + warnings.join("\n"),
            }] : []),
          ],
        };
      }

      case "export_bpmn_svg": {
        const { diagramId } = args as any;
        const diagram = diagrams.get(diagramId);

        if (!diagram) {
          throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
        }

        const { svg } = await diagram.modeler.saveSVG();

        return {
          content: [
            {
              type: "text",
              text: svg || "",
            },
          ],
        };
      }

      case "list_bpmn_elements": {
        const { diagramId } = args as any;
        const diagram = diagrams.get(diagramId);

        if (!diagram) {
          throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
        }

        const elementRegistry = diagram.modeler.get("elementRegistry");
        const elements = elementRegistry.filter((element: any) => {
          // Filter out root elements and connections for cleaner output
          return element.type &&
                 element.type !== "bpmn:Process" &&
                 element.type !== "bpmn:Collaboration" &&
                 element.type !== "label" &&
                 !element.type.includes("BPMNDiagram");
        });

        const elementList = elements.map((element: any) => ({
          id: element.id,
          type: element.type,
          name: element.businessObject?.name || "(unnamed)",
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                elements: elementList,
                count: elementList.length,
              }, null, 2),
            },
          ],
        };
      }

      case "import_bpmn_xml": {
        const { xml } = args as any;
        const diagramId = generateDiagramId();

        const container = createHeadlessCanvas();
        const modeler = new BpmnModeler({ container });

        await modeler.importXML(xml);

        diagrams.set(diagramId, {
          modeler,
          xml,
          elementIdMap: new Map(),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                diagramId,
                message: `Imported BPMN diagram with ID: ${diagramId}`,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Error executing ${name}: ${error.message}`
    );
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BPMN.js MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
