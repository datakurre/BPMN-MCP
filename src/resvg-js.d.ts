declare module '@resvg/resvg-js' {
  export class Resvg {
    constructor(svg: string, options?: any);
    render(): ResvgRenderResult;
  }
  export interface ResvgRenderResult {
    asPng(): Uint8Array;
    width: number;
    height: number;
  }
}
