/* ============================================================
 * gl.js —— 轻量 WebGL 三维引擎（无外部依赖）
 *  · 透视相机（阻尼跟随 / 轨道 / 抖动）
 *  · 前向渲染：方向光 + 半球环境光 + 4 点光 + 菲涅尔边缘光 + 雾
 *  · 材质：自发光 / 半透明 / 加性混合 / 程序纹理
 *  · GPU 点精灵粒子系统（柔光贴图）
 *  · 后处理：亮部提取 → 两级高斯模糊 → 合成（Bloom + 色调映射 + 暗角 + 颗粒）
 *  · 屏幕空间拾取（包围球投影）
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 数学 ---------------- */
  var M4 = {
    ident: function () { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    persp: function (fovy, asp, n, f) {
      var t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
      return o;
    },
    lookAt: function (e, c, up) {
      var z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]),
        -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]),
        -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]);
    },
    mul: function (a, b) {
      var o = new Float32Array(16);
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
        var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
      return o;
    },
    /* 矩阵 × 列向量 */
    xform: function (m, v) {
      var o = [0, 0, 0, 0];
      for (var r = 0; r < 4; r++) {
        o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * (v[3] === undefined ? 1 : v[3]);
      }
      return o;
    },
    compose: function (p, r, s) {
      var cx = Math.cos(r[0]), sx = Math.sin(r[0]);
      var cy = Math.cos(r[1]), sy = Math.sin(r[1]);
      var cz = Math.cos(r[2]), sz = Math.sin(r[2]);
      var m = new Float32Array(16);
      m[0] = (cy * cz + sy * sx * sz) * s[0];
      m[1] = (cx * sz) * s[0];
      m[2] = (cy * sx * sz - sy * cz) * s[0];
      m[4] = (sy * sx * cz - cy * sz) * s[1];
      m[5] = (cx * cz) * s[1];
      m[6] = (sy * sz + cy * sx * cz) * s[1];
      m[8] = (cy * sx) * s[2] * -1 + (sy * cx) * s[2];
      m[9] = (-sx) * s[2];
      m[10] = (cy * cx) * s[2];
      m[15] = 1;
      m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
      return m;
    },
    trs: function (p, r, s) {
      /* 标准 TRS（列主序） */
      var cx = Math.cos(r[0]), sx = Math.sin(r[0]);
      var cy = Math.cos(r[1]), sy = Math.sin(r[1]);
      var cz = Math.cos(r[2]), sz = Math.sin(r[2]);
      var rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
      var ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
      var rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      var m = M4.mul(M4.mul(rz, ry), rx);
      for (var i = 0; i < 3; i++) { m[i] *= s[0]; m[4 + i] *= s[1]; m[8 + i] *= s[2]; }
      m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
      return m;
    }
  };
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* ---------------- 网格生成 ---------------- */
  function Mesh(gl, pos, nrm, uv, idx, mode) {
    this.gl = gl;
    this.vb = gl.createBuffer(); this.nb = gl.createBuffer(); this.tb = gl.createBuffer(); this.ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    var big = pos.length / 3 > 65535;
    this.u32 = big && !!gl.getExtension('OES_element_index_uint');
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.u32 ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
    this.count = idx.length;
    this.mode = mode || gl.TRIANGLES;
  }

  function sphere(seg, ring, r) {
    r = r || 1; seg = seg || 28; ring = ring || 18;
    var p = [], n = [], u = [], ix = [];
    for (var y = 0; y <= ring; y++) {
      var v = y / ring, phi = v * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      for (var x = 0; x <= seg; x++) {
        var uu = x / seg, th = uu * Math.PI * 2, st = Math.sin(th), ct = Math.cos(th);
        var nx = sp * ct, ny = cp, nz = sp * st;
        p.push(nx * r, ny * r, nz * r); n.push(nx, ny, nz); u.push(uu, 1 - v);
      }
    }
    for (var yy = 0; yy < ring; yy++) for (var xx = 0; xx < seg; xx++) {
      var a = yy * (seg + 1) + xx, b = a + seg + 1;
      ix.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { p: p, n: n, u: u, i: ix };
  }
  function box(w, h, d) {
    w /= 2; h /= 2; d /= 2;
    var f = [
      [[1, 0, 0], [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d]]],
      [[-1, 0, 0], [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]]],
      [[0, 1, 0], [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]]],
      [[0, -1, 0], [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]]],
      [[0, 0, 1], [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]]],
      [[0, 0, -1], [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d]]]
    ];
    var p = [], n = [], u = [], i = [], k = 0;
    f.forEach(function (face) {
      face[1].forEach(function (v, j) {
        p.push(v[0], v[1], v[2]); n.push(face[0][0], face[0][1], face[0][2]);
        u.push(j < 2 ? j : (j === 2 ? 1 : 0), j === 0 || j === 3 ? 0 : 1);
      });
      i.push(k, k + 1, k + 2, k, k + 2, k + 3); k += 4;
    });
    return { p: p, n: n, u: u, i: i };
  }
  function plane(w, h, seg) {
    seg = seg || 1; w /= 2; h /= 2;
    var p = [], n = [], u = [], i = [], k = 0;
    for (var y = 0; y <= seg; y++) for (var x = 0; x <= seg; x++) {
      var uu = x / seg, vv = y / seg;
      p.push((uu - .5) * 2 * w, 0, (vv - .5) * 2 * h); n.push(0, 1, 0); u.push(uu, vv);
    }
    for (var yy = 0; yy < seg; yy++) for (var xx = 0; xx < seg; xx++) {
      var a = yy * (seg + 1) + xx, b = a + seg + 1;
      i.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { p: p, n: n, u: u, i: i };
  }
  function torus(R, r, seg, side) {
    seg = seg || 40; side = side || 16;
    var p = [], n = [], u = [], i = [];
    for (var a = 0; a <= seg; a++) {
      var uu = a / seg, th = uu * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      for (var b = 0; b <= side; b++) {
        var vv = b / side, ph = vv * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
        var nx = ct * cp, ny = sp, nz = st * cp;
        p.push((R + r * cp) * ct, r * sp, (R + r * cp) * st);
        n.push(nx, ny, nz); u.push(uu, vv);
      }
    }
    for (var aa = 0; aa < seg; aa++) for (var bb = 0; bb < side; bb++) {
      var i0 = aa * (side + 1) + bb, i1 = i0 + side + 1;
      i.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
    }
    return { p: p, n: n, u: u, i: i };
  }
  function ring2d(rIn, rOut, seg) {
    seg = seg || 40;
    var p = [], n = [], u = [], i = [];
    for (var a = 0; a <= seg; a++) {
      var uu = a / seg, th = uu * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      p.push(c * rIn, 0, s * rIn); n.push(0, 1, 0); u.push(uu, 0);
      p.push(c * rOut, 0, s * rOut); n.push(0, 1, 0); u.push(uu, 1);
    }
    for (var k = 0; k < seg; k++) {
      var a0 = k * 2;
      i.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    return { p: p, n: n, u: u, i: i };
  }
  function cylinder(r, h, seg, cap) {
    seg = seg || 24; h = h || 1;
    var p = [], n = [], u = [], i = [], k = 0;
    for (var a = 0; a <= seg; a++) {
      var uu = a / seg, th = uu * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      p.push(c * r, -h / 2, s * r); n.push(c, 0, s); u.push(uu, 0);
      p.push(c * r, h / 2, s * r); n.push(c, 0, s); u.push(uu, 1);
    }
    for (var b = 0; b < seg; b++) { var i0 = b * 2; i.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); }
    if (cap) {
      [1, -1].forEach(function (sgn) {
        var c0 = p.length / 3;
        p.push(0, sgn * h / 2, 0); n.push(0, sgn, 0); u.push(.5, .5);
        for (var a2 = 0; a2 <= seg; a2++) {
          var th2 = a2 / seg * Math.PI * 2;
          p.push(Math.cos(th2) * r, sgn * h / 2, Math.sin(th2) * r);
          n.push(0, sgn, 0); u.push(.5 + .5 * Math.cos(th2), .5 + .5 * Math.sin(th2));
        }
        for (var c2 = 1; c2 <= seg; c2++) {
          if (sgn > 0) i.push(c0, c0 + c2, c0 + c2 + 1); else i.push(c0, c0 + c2 + 1, c0 + c2);
        }
      });
    }
    return { p: p, n: n, u: u, i: i };
  }
  function cone(r, h, seg) {
    seg = seg || 24;
    var p = [], n = [], u = [], i = [];
    p.push(0, h / 2, 0); n.push(0, 1, 0); u.push(.5, .5);
    for (var a = 0; a <= seg; a++) {
      var th = a / seg * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      p.push(c * r, -h / 2, s * r);
      var nn = norm([c, r / h, s]); n.push(nn[0], nn[1], nn[2]); u.push(a / seg, 0);
    }
    for (var b = 1; b <= seg; b++) i.push(0, b, b + 1);
    return { p: p, n: n, u: u, i: i };
  }
  function capsule(r, h, seg) {
    /* 由球 + 柱 + 球 合并近似（用于人形/伞柄） */
    var a = sphere(seg, Math.max(4, (seg / 2) | 0), r), b = cylinder(r, h, seg, false), c = sphere(seg, Math.max(4, (seg / 2) | 0), r);
    var off1 = a.p.length / 3, off2 = off1 + b.p.length / 3;
    var p = a.p.slice(), n = a.n.slice(), u = a.u.slice(), i = a.i.slice();
    for (var k = 0; k < b.p.length; k += 3) { p.push(b.p[k], b.p[k + 1], b.p[k + 2]); }
    for (var k2 = 0; k2 < b.n.length; k2++) n.push(b.n[k2]);
    for (var k3 = 0; k3 < b.u.length; k3++) u.push(b.u[k3]);
    b.i.forEach(function (v) { i.push(v + off1); });
    for (var k4 = 0; k4 < c.p.length; k4 += 3) { p.push(c.p[k4], c.p[k4 + 1], c.p[k4 + 2]); }
    for (var k5 = 0; k5 < c.n.length; k5++) n.push(c.n[k5]);
    for (var k6 = 0; k6 < c.u.length; k6++) u.push(c.u[k6]);
    c.i.forEach(function (v) { i.push(v + off2); });
    return { p: p, n: n, u: u, i: i };
  }
  function lines(points) {
    var p = [], n = [], u = [], i = [];
    points.forEach(function (pt, k) {
      p.push(pt[0], pt[1], pt[2]); n.push(0, 1, 0); u.push(0, 0); i.push(k);
    });
    return { p: p, n: n, u: u, i: i };
  }

  /* ---------------- 着色器 ---------------- */
  var VS_MAIN = [
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;',
    'uniform mat4 uProj, uView, uModel;',
    'varying vec3 vN; varying vec3 vW; varying vec2 vUV;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos,1.0);',
    '  vW = w.xyz; vN = mat3(uModel) * aNrm; vUV = aUV;',
    '  gl_Position = uProj * uView * w;',
    '}'
  ].join('\n');

  var FS_MAIN = [
    'precision highp float;',
    'varying vec3 vN; varying vec3 vW; varying vec2 vUV;',
    'uniform vec3 uColor, uEmis, uCam; uniform float uRough, uMetal, uAlpha, uRim, uUnlit;',
    'uniform vec3 uDir; uniform vec3 uSky, uGround;',
    'uniform vec3 uLPos[4]; uniform vec3 uLCol[4]; uniform float uLInt[4]; uniform int uLCount;',
    'uniform vec3 uFogCol; uniform float uFogDen; uniform sampler2D uTex; uniform float uUseTex;',
    'uniform float uTime;',
    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uCam - vW);',
    '  vec3 base = uColor;',
    '  if(uUseTex > 0.5){ base *= texture2D(uTex, vUV).rgb; }',
    '  if(uUnlit > 0.5){ gl_FragColor = vec4(base + uEmis, uAlpha); return; }',
    '  vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5) * base;',
    '  vec3 L = normalize(uDir);',
    '  float ndl = max(dot(N, L), 0.0);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N, H), 0.0), mix(4.0, 96.0, 1.0 - uRough)) * (1.0 - uRough) * (0.3 + uMetal);',
    '  vec3 col = amb + base * ndl * 0.85 + vec3(1.0) * spec;',
    '  for(int i=0;i<4;i++){',
    '    if(i >= uLCount) break;',
    '    vec3 d = uLPos[i] - vW; float dist = length(d);',
    '    vec3 ld = d / max(dist, 0.001);',
    '    float att = uLInt[i] / (1.0 + 0.09 * dist + 0.032 * dist * dist);',
    '    float df = max(dot(N, ld), 0.0);',
    '    vec3 hv = normalize(ld + V);',
    '    float sp = pow(max(dot(N, hv), 0.0), mix(8.0, 80.0, 1.0 - uRough)) * (1.0 - uRough);',
    '    col += uLCol[i] * (base * df * 0.9 + sp * 0.8) * att;',
    '  }',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  col += uRim * fres * vec3(0.75, 0.85, 1.0);',
    '  col += uEmis;',
    '  float fd = length(uCam - vW) * uFogDen;',
    '  col = mix(col, uFogCol, clamp(fd, 0.0, 0.85));',
    '  gl_FragColor = vec4(col, uAlpha);',
    '}'
  ].join('\n');

  var VS_PART = [
    'attribute vec3 aPos; attribute vec2 aData; attribute vec4 aCol;',
    'uniform mat4 uProj, uView; uniform float uScale;',
    'varying vec4 vCol;',
    'void main(){',
    '  vec4 v = uView * vec4(aPos,1.0);',
    '  gl_Position = uProj * v;',
    '  gl_PointSize = max(1.0, aData.x * uScale / max(-v.z, 0.1));',
    '  vCol = aCol;',
    '}'
  ].join('\n');
  var FS_PART = [
    'precision mediump float; varying vec4 vCol;',
    'void main(){',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = length(d) * 2.0;',
    '  float a = smoothstep(1.0, 0.0, r);',
    '  a *= a;',
    '  gl_FragColor = vec4(vCol.rgb * a, a * vCol.a);',
    '}'
  ].join('\n');

  var VS_QUAD = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }';
  var FS_BRIGHT = [
    'precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform float uThresh;',
    'void main(){ vec3 c = texture2D(uTex, vUV).rgb;',
    '  float l = dot(c, vec3(0.2126,0.7152,0.0722));',
    '  float k = max(l - uThresh, 0.0) / max(l, 0.001);',
    '  gl_FragColor = vec4(c * k, 1.0); }'
  ].join('\n');
  var FS_BLUR = [
    'precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir;',
    'void main(){',
    '  vec3 s = texture2D(uTex, vUV).rgb * 0.227;',
    '  s += (texture2D(uTex, vUV + uDir * 1.3846).rgb + texture2D(uTex, vUV - uDir * 1.3846).rgb) * 0.316;',
    '  s += (texture2D(uTex, vUV + uDir * 3.2307).rgb + texture2D(uTex, vUV - uDir * 3.2307).rgb) * 0.070;',
    '  gl_FragColor = vec4(s, 1.0); }'
  ].join('\n');
  var FS_COMP = [
    'precision mediump float; varying vec2 vUV;',
    'uniform sampler2D uScene, uB1, uB2; uniform float uBloom, uTime, uVig, uGrain;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
    'void main(){',
    '  vec3 c = texture2D(uScene, vUV).rgb;',
    '  vec3 b = texture2D(uB1, vUV).rgb * 0.65 + texture2D(uB2, vUV).rgb * 0.85;',
    '  c += b * uBloom;',
    '  c = c / (c + vec3(0.86)) * 1.28;',           /* 色调映射 */
    '  c = pow(c, vec3(0.92));',
    '  float d = distance(vUV, vec2(0.5));',
    '  c *= mix(1.0, smoothstep(0.92, 0.28, d), uVig);',
    '  c += (hash(vUV * 512.0 + uTime) - 0.5) * uGrain;',
    '  gl_FragColor = vec4(c, 1.0); }'
  ].join('\n');

  function sh(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('shader:', gl.getShaderInfoLog(s));
    return s;
  }
  function prog(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
    /* 固定属性槽位：0 位置 / 1 法线或附加数据 / 2 UV 或颜色 */
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNrm');
    gl.bindAttribLocation(p, 2, 'aUV');
    gl.bindAttribLocation(p, 1, 'aData');
    gl.bindAttribLocation(p, 2, 'aCol');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn('link:', gl.getProgramInfoLog(p));
    return p;
  }

  /* ---------------- 渲染器 ---------------- */
  function create(canvas) {
    var opts = { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return null;

    var R = {
      gl: gl, canvas: canvas, w: 1, h: 1, dpr: Math.min(global.devicePixelRatio || 1, 1.75),
      objs: [], parts: [], t: 0,
      camera: { pos: [0, 2.2, 7], target: [0, 0, 0], up: [0, 1, 0], fov: 50 * Math.PI / 180, damping: 0, shake: 0 },
      dir: [0.4, 0.9, 0.35], sky: [0.34, 0.42, 0.58], ground: [0.12, 0.11, 0.14],
      fog: { color: [0.06, 0.08, 0.12], density: 0.012 },
      lights: [], bloom: 1.0, vignette: 0.85, grain: 0.035, exposure: 1
    };

    R.pMain = prog(gl, VS_MAIN, FS_MAIN);
    R.pPart = prog(gl, VS_PART, FS_PART);
    R.pBright = prog(gl, VS_QUAD, FS_BRIGHT);
    R.pBlur = prog(gl, VS_QUAD, FS_BLUR);
    R.pComp = prog(gl, VS_QUAD, FS_COMP);

    R.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    /* 柔光贴图（粒子用） */
    R.softTex = makeSoftTex(gl, 64);

    /* FBO */
    function mkFBO(w, h) {
      var fb = gl.createFramebuffer(), tx = gl.createTexture(), rb = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tx: tx, rb: rb, w: w, h: h };
    }
    function mkFBOc(w, h) {
      var fb = gl.createFramebuffer(), tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tx: tx, w: w, h: h };
    }

    R.resize = function () {
      var r = canvas.getBoundingClientRect();
      var w = Math.max(320, Math.floor(r.width * R.dpr)), h = Math.max(240, Math.floor(r.height * R.dpr));
      if (w === R.w && h === R.h) return;
      R.w = w; R.h = h; canvas.width = w; canvas.height = h;
      if (R.scene) { gl.deleteFramebuffer(R.scene.fb); gl.deleteTexture(R.scene.tx); gl.deleteRenderbuffer(R.scene.rb); }
      R.scene = mkFBO(w, h);
      var w2 = Math.max(2, w >> 1), h2 = Math.max(2, h >> 1), w4 = Math.max(2, w >> 2), h4 = Math.max(2, h >> 2);
      [['b1', w2, h2], ['p1', w2, h2], ['b2', w4, h4], ['p2', w4, h4]].forEach(function (cfg) {
        var k = cfg[0];
        if (R[k]) { gl.deleteFramebuffer(R[k].fb); gl.deleteTexture(R[k].tx); }
        R[k] = mkFBOc(cfg[1], cfg[2]);
      });
    };
    R.resize();

    /* ---- 物体 ---- */
    R.meshCache = {};
    R.mesh = function (kind) {
      var key = kind.join('_');
      if (R.meshCache[key]) return R.meshCache[key];
      var g = kind[0] === 'sphere' ? sphere(kind[1], kind[2], kind[3]) :
        kind[0] === 'box' ? box(kind[1], kind[2], kind[3]) :
          kind[0] === 'plane' ? plane(kind[1], kind[2], kind[3] || 1) :
            kind[0] === 'torus' ? torus(kind[1], kind[2], kind[3], kind[4]) :
              kind[0] === 'ring' ? ring2d(kind[1], kind[2], kind[3]) :
                kind[0] === 'cyl' ? cylinder(kind[1], kind[2], kind[3], kind[4]) :
                  kind[0] === 'cone' ? cone(kind[1], kind[2], kind[3]) :
                    kind[0] === 'capsule' ? capsule(kind[1], kind[2], kind[3]) :
                      kind[0] === 'lines' ? lines(kind[1]) : sphere(16, 12, 1);
      var m = new Mesh(gl, g.p, g.n, g.u, g.i, kind[0] === 'lines' ? gl.LINES : gl.TRIANGLES);
      R.meshCache[key] = m;
      return m;
    };

    R.add = function (kind, mat, o) {
      o = o || {};
      var obj = {
        mesh: R.mesh(kind),
        pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0], scale: o.scale || [1, 1, 1],
        mat: Object.assign({
          color: [1, 1, 1], emissive: [0, 0, 0], rough: .5, metal: .0, alpha: 1,
          rim: .12, unlit: 0, tex: null, additive: false, depthWrite: true, radius: 1
        }, mat || {}),
        visible: true, spin: o.spin || null, user: o.user || null
      };
      R.objs.push(obj);
      return obj;
    };
    R.remove = function (o) { var i = R.objs.indexOf(o); if (i >= 0) R.objs.splice(i, 1); };
    R.clear = function () { R.objs.length = 0; R.parts.forEach(function (p) { p.dispose && p.dispose(); }); R.parts.length = 0; R.lights.length = 0; };

    /* ---- 粒子系统 ---- */
    R.particles = function (n, o) {
      o = o || {};
      var ps = {
        n: n, pos: new Float32Array(n * 3), data: new Float32Array(n * 2), col: new Float32Array(n * 4),
        gl: gl, additive: o.additive !== false, size: o.size || 26
      };
      ps.bp = gl.createBuffer(); ps.bd = gl.createBuffer(); ps.bc = gl.createBuffer();
      ps.upload = function () {
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bp); gl.bufferData(gl.ARRAY_BUFFER, ps.pos, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bd); gl.bufferData(gl.ARRAY_BUFFER, ps.data, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bc); gl.bufferData(gl.ARRAY_BUFFER, ps.col, gl.DYNAMIC_DRAW);
      };
      ps.set = function (i, x, y, z, size, r, g, b, a) {
        ps.pos[i * 3] = x; ps.pos[i * 3 + 1] = y; ps.pos[i * 3 + 2] = z;
        ps.data[i * 2] = size; ps.data[i * 2 + 1] = 0;
        ps.col[i * 4] = r; ps.col[i * 4 + 1] = g; ps.col[i * 4 + 2] = b; ps.col[i * 4 + 3] = a;
      };
      ps.dispose = function () { gl.deleteBuffer(ps.bp); gl.deleteBuffer(ps.bd); gl.deleteBuffer(ps.bc); };
      ps.upload();
      R.parts.push(ps);
      return ps;
    };

    R.light = function (pos, color, intensity) {
      var l = { pos: pos, color: color, intensity: intensity === undefined ? 3 : intensity };
      R.lights.push(l); return l;
    };

    /* ---- 拾取：把世界坐标投影到画布像素 ---- */
    R.project = function (p) {
      var v = M4.xform(R.view, [p[0], p[1], p[2], 1]);
      var z = v[3] || 1;
      var x = v[0] / z, y = v[1] / z;
      return { x: (x * .5 + .5) * R.w / R.dpr, y: (.5 - y * .5) * R.h / R.dpr, z: z };
    };
    /* 屏幕空间半径（像素） */
    R.screenRadius = function (p, r) {
      var a = R.project([p[0] - r, p[1], p[2]]), b = R.project([p[0] + r, p[1], p[2]]);
      return Math.max(6, Math.abs(b.x - a.x));
    };
    /* 命中测试：返回距离中心最近的可见物体 */
    R.pick = function (cx, cy, objs, pad) {
      var best = null, bestD = 1e9;
      (objs || R.objs).forEach(function (o) {
        if (!o.visible || !o.pickable) return;
        var pr = R.project(o.pos);
        var rr = R.screenRadius(o.pos, o.mat.radius * (o.scale[0] || 1)) * (pad || 1);
        var d = Math.hypot(pr.x - cx, pr.y - cy);
        if (d < rr && d < bestD) { bestD = d; best = o; }
      });
      return best;
    };

    /* ---- 渲染 ---- */
    function bindMesh(m) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.tb); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
    }

    R.render = function (dt) {
      R.t += dt;
      R.resize();
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.fb);
      gl.viewport(0, 0, R.w, R.h);
      gl.clearColor(R.fog.color[0], R.fog.color[1], R.fog.color[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);   /* 双面渲染，避免程序化几何的绕序问题 */

      var cam = R.camera;
      if (cam.shake > 0) {
        cam.shake = Math.max(0, cam.shake - dt * 1.6);
      }
      var sh = cam.shake * .06;
      var eye = [cam.pos[0] + (Math.random() - .5) * sh, cam.pos[1] + (Math.random() - .5) * sh, cam.pos[2] + (Math.random() - .5) * sh];
      var proj = M4.persp(cam.fov, R.w / R.h, .1, 220);
      var view = M4.lookAt(eye, cam.target, cam.up);
      R.view = view; R.proj = proj; R.eye = eye;

      var lights = R.lights.slice(0, 4);
      var lp = new Float32Array(12), lc = new Float32Array(12), li = new Float32Array(4);
      lights.forEach(function (l, i) {
        lp[i * 3] = l.pos[0]; lp[i * 3 + 1] = l.pos[1]; lp[i * 3 + 2] = l.pos[2];
        lc[i * 3] = l.color[0]; lc[i * 3 + 1] = l.color[1]; lc[i * 3 + 2] = l.color[2];
        li[i] = l.intensity;
      });

      /* --- 不透明 --- */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(R.pMain);
      var P = R.pMain;
      gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uProj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uView'), false, view);
      gl.uniform3fv(gl.getUniformLocation(P, 'uCam'), new Float32Array(eye));
      gl.uniform3fv(gl.getUniformLocation(P, 'uDir'), new Float32Array(norm(R.dir)));
      gl.uniform3fv(gl.getUniformLocation(P, 'uSky'), new Float32Array(R.sky));
      gl.uniform3fv(gl.getUniformLocation(P, 'uGround'), new Float32Array(R.ground));
      gl.uniform3fv(gl.getUniformLocation(P, 'uLPos'), lp);
      gl.uniform3fv(gl.getUniformLocation(P, 'uLCol'), lc);
      gl.uniform1fv(gl.getUniformLocation(P, 'uLInt'), li);
      gl.uniform1i(gl.getUniformLocation(P, 'uLCount'), lights.length);
      gl.uniform3fv(gl.getUniformLocation(P, 'uFogCol'), new Float32Array(R.fog.color));
      gl.uniform1f(gl.getUniformLocation(P, 'uFogDen'), R.fog.density);
      gl.uniform1f(gl.getUniformLocation(P, 'uTime'), R.t);
      gl.uniform1i(gl.getUniformLocation(P, 'uTex'), 0);

      R.objs.forEach(function (o) {
        if (!o.visible || o.mat.additive) return;
        if (o.spin) { o.rot[0] += o.spin[0] * dt; o.rot[1] += o.spin[1] * dt; o.rot[2] += o.spin[2] * dt; }
        drawObj(P, o);
      });

      /* --- 加性发光体 --- */
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      R.objs.forEach(function (o) {
        if (!o.visible || !o.mat.additive) return;
        if (o.spin) { o.rot[0] += o.spin[0] * dt; o.rot[1] += o.spin[1] * dt; o.rot[2] += o.spin[2] * dt; }
        drawObj(P, o);
      });

      /* --- 粒子 --- */
      gl.useProgram(R.pPart);
      var PP = R.pPart;
      gl.uniformMatrix4fv(gl.getUniformLocation(PP, 'uProj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(PP, 'uView'), false, view);
      gl.uniform1f(gl.getUniformLocation(PP, 'uScale'), R.h * .5 / R.dpr);
      R.parts.forEach(function (ps) {
        gl.blendFunc(gl.SRC_ALPHA, ps.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bp); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bd); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, ps.bc); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, ps.n);
      });
      gl.depthMask(true);

      /* --- 后处理 --- */
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
      gl.enableVertexAttribArray(0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.ONE, gl.ZERO);

      function pass(p, target, tex, setUniforms) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.viewport(0, 0, target.w, target.h);
        gl.useProgram(p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
        setUniforms(p);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      pass(R.pBright, R.b1, R.scene.tx, function (p) { gl.uniform1f(gl.getUniformLocation(p, 'uThresh'), .58); });
      pass(R.pBlur, R.p1, R.b1.tx, function (p) { gl.uniform2f(gl.getUniformLocation(p, 'uDir'), 1.2 / R.p1.w, 0); });
      pass(R.pBlur, R.b1, R.p1.tx, function (p) { gl.uniform2f(gl.getUniformLocation(p, 'uDir'), 0, 1.2 / R.b1.h); });
      pass(R.pBlur, R.p2, R.b1.tx, function (p) { gl.uniform2f(gl.getUniformLocation(p, 'uDir'), 2.4 / R.p2.w, 0); });
      pass(R.pBlur, R.b2, R.p2.tx, function (p) { gl.uniform2f(gl.getUniformLocation(p, 'uDir'), 0, 2.4 / R.b2.h); });

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, R.w, R.h);
      gl.useProgram(R.pComp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.scene.tx);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.b1.tx);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.b2.tx);
      gl.uniform1i(gl.getUniformLocation(R.pComp, 'uScene'), 0);
      gl.uniform1i(gl.getUniformLocation(R.pComp, 'uB1'), 1);
      gl.uniform1i(gl.getUniformLocation(R.pComp, 'uB2'), 2);
      gl.uniform1f(gl.getUniformLocation(R.pComp, 'uBloom'), R.bloom);
      gl.uniform1f(gl.getUniformLocation(R.pComp, 'uTime'), R.t);
      gl.uniform1f(gl.getUniformLocation(R.pComp, 'uVig'), R.vignette);
      gl.uniform1f(gl.getUniformLocation(R.pComp, 'uGrain'), R.grain);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
    };

    function drawObj(P, o) {
      var m = o.mat;
      gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uModel'), false, M4.trs(o.pos, o.rot, o.scale));
      gl.uniform3fv(gl.getUniformLocation(P, 'uColor'), new Float32Array(m.color));
      gl.uniform3fv(gl.getUniformLocation(P, 'uEmis'), new Float32Array(m.emissive));
      gl.uniform1f(gl.getUniformLocation(P, 'uRough'), m.rough);
      gl.uniform1f(gl.getUniformLocation(P, 'uMetal'), m.metal);
      gl.uniform1f(gl.getUniformLocation(P, 'uAlpha'), m.alpha);
      gl.uniform1f(gl.getUniformLocation(P, 'uRim'), m.rim);
      gl.uniform1f(gl.getUniformLocation(P, 'uUnlit'), m.unlit ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(P, 'uUseTex'), m.tex ? 1 : 0);
      gl.depthMask(!m.additive && m.depthWrite !== false);   /* 加性发光体不写深度 */
      if (m.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.tex); }
      bindMesh(o.mesh);
      gl.drawElements(o.mesh.mode, o.mesh.count, o.mesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }

    return R;
  }

  function makeSoftTex(gl, s) {
    var c = document.createElement('canvas'); c.width = c.height = s;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.4, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /* 程序纹理：把 2D canvas 变成纹理 */
  function texFromCanvas(R, cv) {
    var gl = R.gl;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  global.GL = {
    create: create, texFromCanvas: texFromCanvas,
    mat4: M4, sphere: sphere, box: box, plane: plane, torus: torus,
    ring: ring2d, cylinder: cylinder, cone: cone, capsule: capsule, lines: lines,
    norm: norm, cross: cross, sub: sub
  };
})(window);
