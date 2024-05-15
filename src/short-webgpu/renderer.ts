import { Mat4 } from "./index";
import type {
  RenderObject,
  RenderBindGroup,
  RenderPipeline,
  UpdateData,
} from './index';

/**
 * ## Renderer
 * Primary object for storing all render data and 
 * reducing WebGPU API calls to simple js functions.
 * 
 * ### Usage:
 * ```js
 * import { Renderer, Primitive } from 'basic-webgpu';
 * 
 * const renderer = await Renderer.init(canvas);
 * const pipe1 = renderer.addPipeline2D(shader);
 * const shape = Primitive.cube(20);
 * const obj1 = renderer.addObject2D(pipe1, shape.vertices, shape.uvs, shape.normals);
 * renderer.update(obj1, [0, 10, 0]);
 * 
 * renderer.draw();
 * ```
 */
class Renderer {
  // private properties
  #device: GPUDevice;
  #format: GPUTextureFormat;
  #context: GPUCanvasContext;
  #msaa: GPUTexture;
  #zbuffer: GPUTexture;
  #width: number;
  #height: number;
  // public properties
  limits: GPUSupportedLimits;
  cameraPos: [number, number, number] = [0, 0, -300];
  pipelines: Array<RenderPipeline> = [];
  clearColor: GPUColorDict = { r:0, g:0, b:0, a:1 };

  constructor(d:GPUDevice, f:GPUTextureFormat, c:GPUCanvasContext, m:GPUTexture, z:GPUTexture, w:number, h:number) {
    this.#device = d;
    this.#format = f;
    this.#context = c;
    this.#msaa = m;
    this.#zbuffer = z;
    this.#width = w;
    this.#height = h;
    this.limits = d.limits;
  }
  // initialize WebGPU connection
  static async init(canvas: HTMLCanvasElement | null): Promise<Renderer> {
    if (!canvas) throw new Error("No canvas provided");
    // test webgpu compatibility
    if (!navigator.gpu) throw new Error("WebGPU not supported on this browser");

    // attach to gpu
    const adapter: GPUAdapter | null = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No GPUAdapter found");
    const device = await adapter.requestDevice();

    // configure canvas
    const context = canvas?.getContext("webgpu");
    if (!context) throw new Error("Could not get canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    // create texture for MSAA antialiasing
    const msaaTexture: GPUTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount: 4,
      format: format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    // create texture for z-buffer
    const zbufferTexture: GPUTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth32float',
      sampleCount: 4,
      mipLevelCount: 1,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    })

    // retain initialized components
    return new Renderer(
      device,
      format,
      context,
      msaaTexture,
      zbufferTexture,
      canvas.width,
      canvas.height,
    );
  }
  // load image bitmap
  async loadTexture(url: string): Promise<ImageBitmap> {
    const blob = await fetch(url).then(x => x.blob());
    const bitmap: ImageBitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    return bitmap;
  }
  // change clear color
  updateClearRGB(r: number, g: number, b: number, a?: number) {
    this.clearColor.r = r ? Math.floor(r)/255 : 0;
    this.clearColor.g = g ? Math.floor(g)/255 : 0;
    this.clearColor.b = b ? Math.floor(b)/255 : 0;
    this.clearColor.a = a ? Math.floor(a)/255 : 1;
  }
  // change canvas size
  updateCanvas(w: number, h: number) {
    if (!this.#device) throw new Error("Renderer not initialized");
    // create texture for MSAA antialiasing
    const msaaTexture = this.#device.createTexture({
      label: "multi-sample-texture",
      size: [w, h],
      sampleCount: 4,
      format: this.#format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    // create texture for z-buffer
    const zbufferTexture: GPUTexture = this.#device.createTexture({
      label: "z-buffer-texture",
      size: [w, h],
      format: 'depth32float',
      sampleCount: 4,
      mipLevelCount: 1,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    })
    this.#msaa = msaaTexture;
    this.#zbuffer = zbufferTexture;
    this.#width = w;
    this.#height = h;
  }
  // change camera position
  updateCamera(x: number, y: number, z: number) {
    this.cameraPos[0] = x;
    this.cameraPos[1] = y;
    this.cameraPos[2] = z;
  }
  /**
   * Creates rendering pipeline to feed render objects into
   * - Bind groups/uniforms are bundled together with the pipeline
   * - Uses dynamic offsets for buffers to optimize memory usage
   * 
   * @param {string} shader wgsl shader as a string
   * @param {number} maxObjCount keep low to minimize memory consumption
   * @returns {number} pipeline id (required for creating render objects)
   */
  addPipeline(shader:string, maxObjCount:number, bitmap?: ImageBitmap): number {
    if (!this.#device) throw new Error("Renderer not initialized");
    const shaderModule: GPUShaderModule = this.#device.createShaderModule({
      label: "shader-module",
      code: shader
    });
    // create pipeline
    const bindGroupLayout: GPUBindGroupLayout = this.#device.createBindGroupLayout({
      label: "bind-group-0-layout",
      entries: [
        { // mvp matrix
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { hasDynamicOffset:true }
        },
        { // texture
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        { // texture sampler
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type:'filtering' }
        }
      ]
    });
    const pipelineLayout: GPUPipelineLayout = this.#device.createPipelineLayout({
      label: "render-pipeline-layout",
      bindGroupLayouts: [bindGroupLayout]
    });
    const blendMode: GPUBlendComponent = {
      srcFactor: 'src-alpha',
      dstFactor: 'one-minus-src-alpha',
    };
    const pipeline: GPURenderPipeline = this.#device.createRenderPipeline({
      label: "render-pipeline",
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [
          { // position
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, format: "float32x3", offset: 0 }]
          },
          { // uv coords
            arrayStride: 8,
            attributes: [{ shaderLocation: 1, format: "float32x2", offset: 0 }]
          },
          { // normal
            arrayStride: 12,
            attributes: [{ shaderLocation: 2, format: "float32x3", offset: 0 }]
          },
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.#format, blend: {color: blendMode, alpha: blendMode} }]
      },
      multisample: {
        count: 4,
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      // primitive: {
      //   cullMode: 'back' // culls back-facing tris, breaks self-transparency
      // }
    });
    // create bind group
    const bindGroup = this.addBindGroup(pipeline, maxObjCount, bitmap);
    // add to cache
    const pipe: RenderPipeline = {
      pipe: pipeline,
      objects: [],
      bindGroup0: bindGroup,
    };
    this.pipelines.push(pipe);
    return (this.pipelines.length - 1);
  }
  // create bind group
  addBindGroup(pipeline: GPURenderPipeline, maxObjCount:number, bitmap?: ImageBitmap): RenderBindGroup {
    // create uniform buffers
    const minStrideSize: number = this.limits.minUniformBufferOffsetAlignment;
    const mvpBuffer: GPUBuffer = this.#device.createBuffer({
      label: "mvp-struct-uniform",
      size: minStrideSize * maxObjCount,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // create texture
    const texture: GPUTexture = this.#device.createTexture({
      label: 'texture-input',
      format: 'rgba8unorm',
      size: [bitmap?.width ?? this.#width, bitmap?.height ?? this.#height],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (bitmap) {
      this.#device.queue.copyExternalImageToTexture(
        { source: bitmap, flipY: true },
        { texture },
        { width: bitmap.width, height: bitmap.height }
      );
    }
    // create sampler
    const sampler: GPUSampler = this.#device.createSampler({
      label: "texture-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      lodMinClamp: 0,
      lodMaxClamp: 1,
      maxAnisotropy: 1
    });
    // -- TODO: intake custom uniforms
    // create bind group
    const mvpSize: number = 4 * 4 * 4 * 3; // mat4 32bit/4byte floats
    const bindGroup: GPUBindGroup = this.#device.createBindGroup({
      label: "bind-group-0",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: { buffer: mvpBuffer, size: mvpSize }},
        {binding: 1, resource: texture.createView()},
        {binding: 2, resource: sampler},
      ]
    });
    const out: RenderBindGroup = {
      base: bindGroup,
      entries: [mvpBuffer],
      texture: texture
    }
    return out;
  }
  // create buffers for render object
  addObject(
    pipelineId: number,
    verts: Array<[number, number, number]>,
    uvs?: Array<[number, number]>,
    normals?: Array<[number, number, number]>,
    customBind?: boolean,
  ): number {
    if (!this.#device) throw new Error("Renderer not initialized");
    if (verts.length < 3) throw new Error("Not enough vertices");
    // create vertex buffer
    let vlen = verts.length;
    const vertices = new Float32Array(vlen * 3);
    for (let i=0; i<verts.length; i++) {
      vertices[i*3] = verts[i][0];
      vertices[i*3+1] = verts[i][1];
      vertices[i*3+2] = verts[i][2];
    }
    const vertexBuffer: GPUBuffer = this.#device.createBuffer({
      label: "vertex-buffer",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(vertexBuffer, 0, vertices);
    // create uv buffer
    const uvMap = new Float32Array(vlen * 2);
    if (uvs && uvs.length > 0) {
      for (let i=0; i<uvs.length; i++) {
        uvMap[i*2] = uvs[i][0];
        uvMap[i*2+1] = uvs[i][1];
      }
    }
    const uvBuffer: GPUBuffer = this.#device.createBuffer({
      label: "uv-buffer",
      size: uvMap.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(uvBuffer, 0, uvMap);
    // create normals buffer
    const normalMap = new Float32Array(vlen * 3);
    if (normals && normals.length > 0) {
      for (let i=0; i<normals.length; i++) {
        normalMap[i*3] = normals[i][0];
        normalMap[i*3+1] = normals[i][1];
        normalMap[i*3+2] = normals[i][2];
      }
    }
    const normalBuffer: GPUBuffer = this.#device.createBuffer({
      label: "normal-buffer",
      size: normalMap.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(normalBuffer, 0, normalMap);
    // save to cache
    const pipe = this.pipelines[pipelineId];
    const id = pipe.objects.length;
    const obj: RenderObject = {
      visible: true,
      vertexBuffer,
      uvBuffer,
      normalBuffer,
      vertexCount: vlen,
      pipelineIndex: id,
    }
    // custom bind group
    if (customBind) {
      const pipeline = this.pipelines[pipelineId];
      const bind = this.addBindGroup(pipeline.pipe, 1);
      obj.customBindGroup = bind;
    }
    pipe.objects.push(obj);
    this.updateObject({ pipelineId, objectId:id });
    return id;
  }
  // update buffers for render object
  updateObject(input: UpdateData) {
    const { pipelineId, objectId, translate, visible, rotateAxis, rotateDeg, scale, camera } = input;
    if (!this.#device) throw new Error("Renderer not initialized");
    const dpipe = this.pipelines[pipelineId];
    if (!dpipe) throw new Error(`Could not find pipeline ${pipelineId}`);
    const obj = dpipe.objects[objectId];
    if (!obj) throw new Error(`Could not find object ${objectId}`);
    
    obj.visible = visible ?? true;
    // model matrix
    const modelt: Float32Array = Mat4.translate(translate?.[0] || 0, translate?.[1] || 0, translate?.[2] || 0);
    const modelr: Float32Array = Mat4.rotate(rotateAxis || [0,0,1], (rotateDeg || 0) * Math.PI / 180);
    const models: Float32Array = Mat4.scale(scale?.[0] || 1, scale?.[1] || 1, scale?.[2] || 1);
    const model: Float32Array = Mat4.multiply(modelt, Mat4.multiply(modelr, models));
    // view matrix
    const view: Float32Array = Mat4.translate(this.cameraPos[0], this.cameraPos[1], this.cameraPos[2]);
    // projection matrix
    const w2 = this.#width/2;
    const h2 = this.#height/2;
    let proj: Float32Array;
    if (camera?.type === "persp") proj = Mat4.perspective(camera.fovY, w2/h2, camera.near, camera.far);
    else proj = Mat4.ortho(-w2, w2, -h2, h2);
    // join everything together
    const mat4Size: number = 4 * 4;
    const mvpSize: number = 4 * 4 * 3; // mat4 32bit/4byte floats
    const mvp = new Float32Array(mvpSize);
    for (let i=0; i<mvpSize; i++) {
      if (i < mat4Size) mvp[i] = model[i];
      else if (i < mat4Size * 2) mvp[i] = view[i - mat4Size];
      else mvp[i] = proj[i - mat4Size*2];
    }
    const stride = this.limits.minStorageBufferOffsetAlignment;
    this.#device.queue.writeBuffer(dpipe.bindGroup0.entries[0], stride * obj.pipelineIndex, mvp);
    if (obj.customBindGroup?.entries && obj.customBindGroup?.texture) {
      // TODO: not working
      const encoder: GPUCommandEncoder = this.#device.createCommandEncoder({ label: "debug-encoder" });
      const buffer: GPUBuffer = this.#device.createBuffer({
        label: "depth-transfer-buffer",
        size: 512 * 512 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
      encoder.copyTextureToBuffer(
        { texture: this.#zbuffer },
        { buffer, bytesPerRow: 512 * 4 },
        { width: this.#zbuffer.width, height: this.#zbuffer.height }
      );
      encoder.copyBufferToTexture(
        { buffer, bytesPerRow: 512 * 4 },
        { texture: obj.customBindGroup.texture },
        { width: 512, height: 512 }
      )
      this.#device.queue.submit([encoder.finish()]);
    }
  }
  // render to canvas
  draw() {
    if (!this.#device) throw new Error("Renderer not initialized");
    // create new command encoder (consumed at the end)
    const encoder: GPUCommandEncoder = this.#device.createCommandEncoder({ label: "draw-encoder" });
    const pass: GPURenderPassEncoder = encoder.beginRenderPass({
      label: "draw-pass",
      colorAttachments: [{
        view: this.#msaa.createView(),
        resolveTarget: this.#context.getCurrentTexture().createView(),
        clearValue: this.clearColor,
        loadOp: "clear",
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: this.#zbuffer.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      }
    });
    this.pipelines.forEach(pipeline => {
      if (pipeline.objects.length < 1) return;
      pipeline.objects.forEach(obj => {
        if (!obj.visible) return;
        const stride = this.limits.minUniformBufferOffsetAlignment;
        pass.setPipeline(pipeline.pipe);
        pass.setVertexBuffer(0, obj.vertexBuffer);
        pass.setVertexBuffer(1, obj.uvBuffer);
        pass.setVertexBuffer(2, obj.normalBuffer);
        if (obj.customBindGroup) pass.setBindGroup(0, obj.customBindGroup.base, [0]);
        else pass.setBindGroup(0, pipeline.bindGroup0.base, [stride * obj.pipelineIndex]);
        pass.draw(obj.vertexCount);
      });
    })
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
  }
};

export default Renderer;