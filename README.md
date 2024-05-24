# WebGPU Quickdraw

Custom renderer library for simplifying working with WebGPU.

The goal of this library is to dramatically reduce the setup time required
to start using WebGPU by pre-including common requirements for graphics setups,
without completely abstracting away the WebGPU architecture.

An exception is bind group configuration, which was bundled together with the
pipeline creation process due to how tightly linked the two are and the difficulty
in creating a generic pipeline that can support any bind group layout.

This library **<u>is not</u>** meant to account for every possible combination
of WebGPU capabilities, and allow every possible configuration for users.
If you require a more complex or specific configuration not covered by my
implementation, feel free to take the source code and extend it to cover your 
use case.

Some utility functions are included (like primitive shapes) for ease of use.

### Usage:

All WebGPU configurations have been reduced to the absolute lowest possible number of lines.

```js
import { Renderer, Primitive } from 'webgpu-quickdraw';
import shader from './shader.wgsl?raw';
const canvas = document.querySelector('#canvas');

// initialize WebGPU connection to GPU
const renderer = await Renderer.init(canvas);

// create new pipeline
const pipe1 = renderer.addPipeline(shader);

// create new object
const shape = Primitive.cube(20, 20, 20);
const obj1 = renderer.addObject(pipe1, shape.vertices, shape.uvs, shape.normals);

// update object
renderer.updateObject({ pipelineId: pipe1, objectId: obj1, position: [0, 10, 0]});

// render to canvas
renderer.render([pipe1]);
```

Note: Primitives is only to help generate the vertex, uv, and normal arrays.
It does not retain any information regarding the output shape.


Shaders are expected to be WGSL, passed in as a string. You can learn more about WGSL
here: https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html, but if you are
familiar with GLSL, it should be a relatively simple transition.

Default shader configuration:
```rust
@group(0) @binding(0) var<uniform> mvp: MVP;
@group(0) @binding(1) var texture: texture_2d<f32>;
@group(0) @binding(2) var txSampler: sampler;

// custom uniforms:
@group(1) @binding({{bindSlot}}) var<uniform> {{varName}}: {{varType}};

struct MVP {
  model: mat4x4<f32>,
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
}

struct VertIn {
  @location(0) pos: vec3f,
  @location(1) uv: vec2f,
  @location(2) normal: vec3f,
}

struct VertOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
}

@vertex // can be optionally renamed via pipeline options
fn vertexMain(input: VertIn) -> VertOut {
  var out: VertOut;
  let mvpMat = mvp.proj * mvp.view * mvp.model;
  out.pos = mvpMat * vec4f(input.pos, 1);
  out.uv = input.uv;
  out.normal = input.normal;
  return out;
}

@fragment // can be optionally renamed via pipeline options
fn fragmentMain(input: VertOut) -> @location(0) vec4f {
  return vec4f(input.normal, 1.0);
}
```

### Features:
- support for reusing pipelines
- support for canvas resizing
- multiple render objects
- alpha channel transparency
- depth buffer z-indexing
- multi-sampled anti-aliasing (4x)
- pre-built mvp transforms for vertex shader
- intakes uv buffer for VBO
- intakes normal buffer for VBO
- intakes texture for uv mapping
- intakes custom uniforms
- can output into textures for post processing

### To-do:
- instancing of objects
- more primitive shapes
- 3d model importing
- compute shaders?

<img src="https://sinsinkun.github.io/webgpu-quickdraw/screenshot2.png" width="400px" />

Transparency, MSAA, depth buffer, and texture mapping pre-included

<img src="https://sinsinkun.github.io/webgpu-quickdraw/screenshot.png" width="400px" />

1000 cubes renders with 2ms GPU computation time

### Acknowledgements

Copied some matrix functions from [wgpu-matrix](https://github.com/greggman/wgpu-matrix) to reduce dependencies