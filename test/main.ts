import { Renderer, Primitives, Vec } from '../src';
import type { Camera, UniformDescription } from '../src';
import shader1 from './basic.wgsl?raw';
import shader2 from "./showtx.wgsl?raw";

// const
const BASE_URL: string = import.meta.env.BASE_URL;

// get HTML elements
const canvas: HTMLCanvasElement | null = document.getElementById("canvas") as HTMLCanvasElement;
const uilog: HTMLElement | null = document.getElementById("log");
const scrollable: HTMLElement | null = document.getElementById("log-scroll");
const btn: HTMLElement | null = document.getElementById("btn-1");
const btn2: HTMLElement | null = document.getElementById("btn-2");
const btn3: HTMLElement | null = document.getElementById("btn-3");

// util function to print to UI
function log(msg: string): void {
  if (uilog) uilog.innerHTML += `<li>${(new Date()).toLocaleTimeString()}: ${msg}</li>`;
  if (scrollable) scrollable.scrollTo(0, scrollable.scrollHeight);
}

async function main() {
  try {
    log("Starting Quickdraw");
    // initialize renderer
    const renderer = await Renderer.init(canvas);
    // change background color
    renderer.updateClearRGB(15, 20, 30);
    // object properties
    let rot: number = 60;
    let raxis: [number, number, number] = [1, 0.6, 0.3];
    // create pipeline
    const tx1: number = await renderer.addTexture(400, 400, BASE_URL + '/logo.png');
    const tx2: number = await renderer.addTexture(512, 512, undefined, true);
    const custom: Array<UniformDescription> = [
      { bindSlot: 0, visibility: 'fragment', type: 'vec3f' },
      { bindSlot: 1, visibility: 'fragment', type: 'f32' }
    ]
    const pipe1 = renderer.addPipeline(shader2, 10, { textureId: tx2 });
    const pipe2 = renderer.addPipeline(shader1, 100, { textureId: tx1, uniforms:custom });
    
    // create pcamera
    const cam1: Camera = renderer.makeCamera("persp", { fovY:80, translate:[0,0,300] });
    const cam2: Camera = renderer.makeCamera("persp", { fovY:80, translate:[0,0,200] });
    // create objects
    const poly = Primitives.regPolygon(250, 32);
    const polyId = renderer.addObject(pipe1, poly.vertices, poly.uvs, poly.normals);
    for (let i=0; i<99; i++) {
      const size = 20 + (i%7) * 5;
      const cube = Primitives.cube(size, size, size);
      renderer.addObject(pipe2, cube.vertices, cube.uvs, cube.normals);
    }
    // update obj parameters
    function update(redraw:boolean = false) {
      // update properties
      if (!redraw) rot += 2;
      renderer.updateObject({
        pipelineId: pipe1,
        objectId: polyId, 
        translate: [0, 0, -100],
        rotateAxis: [0, 1, 0],
        rotateDeg: rot * 0.2,
        camera: cam2
      });
      for (let i=0; i<10; i++) {
        for (let j=0; j<10; j++) {
          if (i === 9 && j === 9) continue;
          renderer.updateObject({
            pipelineId: pipe2,
            objectId: i*10 + j,
            translate: [
              250 - i * 50, 
              50 * Math.sin(i + j * 0.5 + rot * 0.01) + 50 * j - 250, 
              100 * Math.cos(i + j + rot * 0.01)
            ],
            rotateAxis: raxis,
            rotateDeg: rot,
            camera: cam1,
            uniformData: [
              Vec.colorRGB(100 + 100 * Math.sin(rot * 0.02), 200, 100 + 100 * Math.cos(rot * 0.02)),
              new Float32Array([0.8])
            ]
          });
        }
      }
      // render to texture
      renderer.render([pipe2], tx2);
      // render to canvas
      renderer.render([pipe1, pipe2]);
    }
    update(true);
    log("Drew to canvas");
  
    // button event listeners
    let intervalHolder: ReturnType<typeof setInterval> | null = null;
    btn?.addEventListener("click", () => {
      update();
      log("Drew to canvas");
    });
    btn2?.addEventListener("click", () => {
      if (intervalHolder) {
        log("Stop continuous drawing");
        window.clearInterval(intervalHolder);
        intervalHolder = null;
        return;
      }
      intervalHolder = window.setInterval(update, 15);
      log("Drawing to canvas continuously");
    });
    btn3?.addEventListener("click", () => {
      if (canvas) {
        canvas.width = canvas.width === 680 ? 512 : 680;
        renderer.updateCanvas(canvas.width, canvas.height);
        renderer.updateTextureSize(tx2, pipe1, canvas.width, canvas.height, true);
        update(true);
        log("Resized canvas");
      }
    });
    // start with animation on
    btn2?.click();
  
  } catch (err) {
    console.log(err);
    log(`${err}`);
  }
}

main();