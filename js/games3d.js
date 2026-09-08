/* ============================================================
 * games3d.js —— 十六集互动玩法（WebGL 三维版）
 * 依赖 gl.js。若浏览器不支持 WebGL，MG 会自动降级到 microgames.js 的二维版。
 * ============================================================ */
(function (global) {
  'use strict';

  var lineSeq = 0;

  /* ---------- 通用构件 ---------- */
  function orb(R, x, y, z, col, r, opts) {
    opts = opts || {};
    var core = R.add(['sphere', 20, 14, 1], {
      color: col, emissive: col, rough: .15, metal: .1, alpha: 1,
      rim: .5, additive: !!opts.additive, radius: r, unlit: opts.unlit ? 1 : 0
    }, { pos: [x, y, z], scale: [r, r, r] });
    var shell = R.add(['sphere', 16, 10, 1], {
      color: col, emissive: [col[0] * .5, col[1] * .5, col[2] * .5],
      rough: 1, alpha: .22, rim: 1, additive: true, radius: r * 2.4
    }, { pos: [x, y, z], scale: [r * 2.4, r * 2.4, r * 2.4] });
    var light = opts.light === false ? null : R.light([x, y, z], col, opts.intensity === undefined ? 2.2 : opts.intensity);
    return {
      core: core, shell: shell, light: light, dead: false, born: 0,
      set: function (nx, ny, nz) {
        core.pos[0] = shell.pos[0] = nx; core.pos[1] = shell.pos[1] = ny; core.pos[2] = shell.pos[2] = nz;
        if (light) { light.pos[0] = nx; light.pos[1] = ny; light.pos[2] = nz; }
      },
      scale: function (s) {
        core.scale = [r * s, r * s, r * s];
        shell.scale = [r * 2.4 * s, r * 2.4 * s, r * 2.4 * s];
      },
      alpha: function (a) { core.mat.alpha = a; shell.mat.alpha = a * .22; if (light) light.intensity = 2.2 * a; },
      color: function (c) { core.mat.color = c; core.mat.emissive = c; shell.mat.color = c; if (light) light.color = c; },
      pos: core.pos,
      dispose: function () { R.remove(core); R.remove(shell); if (light) R.lights.splice(R.lights.indexOf(light), 1); }
    };
  }

  function ground(R, col, size) {
    return R.add(['plane', size || 60, size || 60, 1], {
      color: col || [.07, .08, .11], rough: .95, metal: 0, rim: .04, radius: 1
    }, { pos: [0, -1.2, 0] });
  }

  function stars(R, n, spread, col) {
    var ps = R.particles(n, { additive: true, size: 26 });
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      var r = spread * (.6 + Math.random() * .4);
      ps.pos[i * 3] = Math.cos(a) * Math.cos(b) * r;
      ps.pos[i * 3 + 1] = Math.sin(b) * r * .6 + 2;
      ps.pos[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r;
      ps.data[i * 2] = 6 + Math.random() * 14;
      var c = col || [.8, .88, 1];
      ps.col[i * 4] = c[0]; ps.col[i * 4 + 1] = c[1]; ps.col[i * 4 + 2] = c[2]; ps.col[i * 4 + 3] = .5 + Math.random() * .5;
    }
    ps.upload();
    return ps;
  }

  function burst(R, x, y, z, col, n, spd) {
    var ps = R.particles(n, { additive: true, size: 30 });
    var vx = [], vy = [], vz = [];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), s = spd * (.3 + Math.random());
      vx.push(Math.sin(b) * Math.cos(a) * s); vy.push(Math.cos(b) * s); vz.push(Math.sin(b) * Math.sin(a) * s);
      ps.set(i, x, y, z, 10 + Math.random() * 16, col[0], col[1], col[2], 1);
    }
    ps.upload();
    return { ps: ps, vx: vx, vy: vy, vz: vz, life: 0 };
  }
  function stepBurst(b, dt) {
    b.life += dt;
    for (var i = 0; i < b.ps.n; i++) {
      b.ps.pos[i * 3] += b.vx[i] * dt; b.ps.pos[i * 3 + 1] += b.vy[i] * dt; b.ps.pos[i * 3 + 2] += b.vz[i] * dt;
      b.vy[i] -= dt * 1.2;
      b.ps.col[i * 4 + 3] = Math.max(0, 1 - b.life / 1.1);
    }
    b.ps.upload();
    return b.life < 1.2;
  }

  function curvePts(fn, n) {
    var out = [];
    for (var i = 0; i <= n; i++) out.push(fn(i / n));
    return out;
  }

  function segMesh(R, a, b, r, col, alpha) {
    var dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    var len = Math.hypot(dir[0], dir[1], dir[2]) || .001;
    var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    /* 把 +Y 轴对齐到 dir：pitch = acos(dy/len)，yaw = atan2(dx, dz) */
    var rot = [Math.atan2(Math.hypot(dir[0], dir[2]), dir[1]), Math.atan2(dir[0], dir[2]), 0];
    return R.add(['cyl', r, len, 8, false], {
      color: col, emissive: [col[0] * .45, col[1] * .45, col[2] * .45],
      rough: .4, alpha: alpha === undefined ? 1 : alpha, rim: .5, radius: Math.max(r, len * .5)
    }, { pos: mid, rot: rot });
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ============================================================
   * 十六个玩法
   * setup(R, api) -> {update(dt,inp), tap?, down?, up?, move?, drag?}
   * ============================================================ */
  var GAMES = {

    /* E01 采集晨光 —— 雾谷里接住八颗光 */
    morning: {
      title: '接住晨光', hint: '点住飘动的光球，在雾散之前收集八颗',
      setup: function (R, api) {
        R.camera.pos = [0, 1.6, 6.2]; R.camera.target = [0, .3, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.85, .72, .5]; R.ground = [.12, .11, .1];
        R.fog = { color: [.36, .32, .28], density: .028 };
        ground(R, [.13, .14, .12], 70);
        var mist = R.particles(120, { additive: true, size: 90 });
        for (var i = 0; i < 120; i++) {
          mist.set(i, (Math.random() - .5) * 34, Math.random() * 4 - 1.1, (Math.random() - .5) * 26,
            120 + Math.random() * 160, 1, .86, .7, .045 + Math.random() * .05);
        }
        mist.upload();
        var orbs = [], got = 0, time = 24, bursts = [];
        for (var k = 0; k < 9; k++) {
          var o = orb(R, (Math.random() - .5) * 8, .5 + Math.random() * 2.6, (Math.random() - .5) * 4, [1, .85, .55], .17, { intensity: 1.6 });
          o.pickable = true; o.v = [(Math.random() - .5) * .8, (Math.random() - .5) * .5, (Math.random() - .5) * .6];
          orbs.push(o);
        }
        return {
          update: function (dt, inp) {
            time -= dt;
            for (var i = 0; i < orbs.length; i++) {
              var o = orbs[i]; if (o.dead) continue;
              var p = o.pos;
              p[0] += o.v[0] * dt; p[1] += o.v[1] * dt; p[2] += o.v[2] * dt;
              if (Math.abs(p[0]) > 4.4) o.v[0] *= -1;
              if (p[1] < .2 || p[1] > 3.4) o.v[1] *= -1;
              if (Math.abs(p[2]) > 2.2) o.v[2] *= -1;
              o.set(p[0], p[1], p[2]);
              o.scale(1 + .14 * Math.sin(R.t * 3 + i));
              o.core.pickable = true; o.core.mat.radius = .17;
            }
            bursts = bursts.filter(stepBurstStep);
            function stepBurstStep(b) { return stepBurst(b, dt); }
            api.hud('晨光 ' + got + ' / 8', time / 24);
            if (got >= 8) api.done({ ok: true });
            if (time <= 0) api.done({ ok: got >= 5 });
          },
          tap: function (x, y) {
            var hitObj = R.pick(x, y, orbs.map(function (o) { return o.core; }), 1.9);
            if (!hitObj) return;
            var o = orbs.filter(function (q) { return q.core === hitObj; })[0];
            if (!o || o.dead) return;
            o.dead = true; got++; api.collect(1);
            bursts.push(burst(R, o.pos[0], o.pos[1], o.pos[2], [1, .9, .6], 22, 2.6));
            o.dispose();
            api.sfx('star', got);
          }
        };
      }
    },

    /* E02 一起呼吸 —— 光环共振 */
    breathe: {
      title: '一起呼吸', hint: '按住随光环吸气，在光带里停住，松开呼气，累积三秒',
      setup: function (R, api) {
        R.camera.pos = [0, 1.2, 5.4]; R.camera.target = [0, .1, 0]; R.camera.fov = 50 * Math.PI / 180;
        R.sky = [.28, .38, .62]; R.ground = [.06, .08, .12];
        R.fog = { color: [.07, .1, .18], density: .045 };
        ground(R, [.05, .07, .1], 60);
        stars(R, 90, 26, [.6, .72, 1]);
        var halo = R.add(['torus', 1.5, .045, 64, 8], {
          color: [.75, .88, 1], emissive: [.3, .45, .75], rough: .3, rim: .8, radius: 1.6
        }, { pos: [0, .1, 0], rot: [Math.PI / 2, 0, 0] });
        var band = R.add(['torus', 1.5, .09, 64, 8], {
          color: [1, .88, .6], emissive: [.9, .72, .35], rough: .5, alpha: .16, additive: true, rim: 1, radius: 1.6
        }, { pos: [0, .1, 0], rot: [Math.PI / 2, 0, 0] });
        var core = orb(R, 0, .1, 0, [.7, .85, 1], .22, { intensity: 3 });
        var dust = R.particles(70, { additive: true, size: 24 });
        for (var i = 0; i < 70; i++) {
          var a = Math.random() * 6.283, rr = 1.2 + Math.random() * 2.4;
          dust.set(i, Math.cos(a) * rr, Math.random() * 2.4 - .6, Math.sin(a) * rr, 8 + Math.random() * 14, .7, .84, 1, .35);
        }
        dust.upload();
        var ph = 0, down = false, acc = 0, hold = 0;
        return {
          update: function (dt) {
            ph += dt * 1.7;
            var cyc = (Math.sin(ph) + 1) / 2;
            var rad = .5 + cyc * 1.45;
            var lo = .5 + .74 * 1.45, hi = .5 + .93 * 1.45;
            hold += (down ? dt * 3 : -dt * 3); hold = Math.max(0, Math.min(1, hold));
            var inb = rad >= lo && rad <= hi;
            acc += (inb && down ? dt : -dt * .35); acc = Math.max(0, Math.min(3, acc));
            var s = rad / 1.5;
            halo.scale = [s, s, 1]; band.scale = [lo / 1.5 + .1, lo / 1.5 + .1, 1];
            halo.mat.emissive = inb ? [1, .8, .45] : [.3, .45, .75];
            band.mat.alpha = inb ? .34 : .14;
            core.scale(1 + .5 * cyc + .25 * hold);
            core.alpha(.55 + .45 * cyc);
            for (var i = 0; i < dust.n; i++) {
              var a2 = i / dust.n * 6.283 + R.t * .2;
              var rr2 = rad * (1.1 + .5 * Math.sin(R.t + i));
              dust.pos[i * 3] = Math.cos(a2) * rr2;
              dust.pos[i * 3 + 2] = Math.sin(a2) * rr2;
              dust.col[i * 4 + 3] = .12 + .3 * (1 - Math.abs(rad / 1.95 - .7));
            }
            dust.upload();
            api.hud((inb ? '吸 —— 停' : (cyc > .5 ? '呼' : '吸')) + ' · 共振 ' + acc.toFixed(1) + ' / 3.0 秒', acc / 3);
            if (acc >= 3) api.done({ ok: true });
          },
          down: function () { down = true; }, up: function () { down = false; }
        };
      }
    },

    /* E03 显影 —— 暗房红灯下浮出四张相纸 */
    photo: {
      title: '显影', hint: '逐张轻触相纸，让影像在显影液里浮出来',
      setup: function (R, api) {
        R.camera.pos = [0, 2.0, 4.4]; R.camera.target = [0, .55, 0]; R.camera.fov = 48 * Math.PI / 180;
        R.sky = [.28, .12, .1]; R.ground = [.05, .03, .03];
        R.dir = [0, 1, .2];
        R.fog = { color: [.1, .04, .04], density: .05 };
        ground(R, [.06, .045, .04], 40);
        R.light([0, 2.4, 2.2], [1, .25, .18], 3.2);          /* 暗房红灯 */
        var water = R.add(['plane', 9, 9, 1], {
          color: [.12, .1, .1], emissive: [.05, .02, .02], rough: .12, metal: .8, alpha: .85, rim: .3, radius: 4
        }, { pos: [0, .02, 0] });
        var tiles = [];
        for (var i = 0; i < 4; i++) {
          var x = -1.35 + (i % 2) * 2.7, z = -.75 + ((i / 2) | 0) * 1.5;
          var t = R.add(['plane', 1.9, 1.35, 1], {
            color: [.5, .48, .44], emissive: [0, 0, 0], rough: .8, rim: .2, radius: 1.2
          }, { pos: [x, .06, z], rot: [-Math.PI / 2 + .12, 0, (Math.random() - .5) * .2] });
          t.pickable = true; t.d = 0;
          tiles.push(t);
        }
        var time = 22, bursts = [];
        return {
          update: function (dt) {
            time -= dt;
            var done = 0;
            for (var i = 0; i < tiles.length; i++) {
              var t = tiles[i];
              t.d = Math.min(1, t.d + dt * .12 * .0 + 0);   /* 只由点击推进 */
              var d = t.d;
              t.mat.color = [.18 + .62 * d, .17 + .58 * d, .16 + .52 * d];
              t.mat.emissive = [.30 * d, .24 * d, .18 * d];
              t.mat.rough = .85 - .5 * d;
              t.pos[1] = .06 + .04 * d;
              if (d >= 1) done++; api.collect(1);
            }
            water.mat.emissive = [.05 + .02 * Math.sin(R.t * 2), .02, .02];
            bursts = bursts.filter(function (b) { return stepBurst(b, dt); });
            api.hud('已显影 ' + done + ' / 4', time / 22);
            if (done >= 4) api.done({ ok: true });
            if (time <= 0) api.done({ ok: done >= 3 });
          },
          tap: function (x, y) {
            var t = R.pick(x, y, tiles, 1.15);
            if (!t) return;
            t.d = Math.min(1, t.d + .34);
            bursts.push(burst(R, t.pos[0], t.pos[1] + .2, t.pos[2], [1, .8, .5], 12, 1.4));
            api.sfx('good');
          }
        };
      }
    },

    /* E04 汽笛与坡度 —— 给列车加压翻过山口 */
    train: {
      title: '汽笛与坡度', hint: '按住给锅炉加压，松开泄压，把气压稳在绿区，陪列车翻过山口',
      setup: function (R, api) {
        R.camera.pos = [0, 2.6, 9]; R.camera.target = [0, 1.1, 0]; R.camera.fov = 50 * Math.PI / 180;
        R.sky = [.62, .68, .72]; R.ground = [.1, .12, .1];
        R.dir = [.5, .9, .3];
        R.fog = { color: [.55, .6, .65], density: .022 };
        ground(R, [.13, .16, .12], 120);
        for (var m = 0; m < 7; m++) {
          var h = 4 + Math.random() * 6;
          R.add(['cone', 3 + Math.random() * 2.5, h, 6], {
            color: [.16, .22, .2], rough: 1, rim: .07, radius: h * .6
          }, { pos: [-26 + m * 9 + Math.random() * 4, -1.2 + h / 2, -14 - Math.random() * 8], rot: [0, Math.random(), 0] });
        }
        /* 铁轨 */
        R.add(['box', 120, .12, .28], { color: [.22, .2, .18], rough: .8, rim: .1, radius: 60 }, { pos: [0, -1.05, 1.4] });
        R.add(['box', 120, .12, .28], { color: [.22, .2, .18], rough: .8, rim: .1, radius: 60 }, { pos: [0, -1.05, 2.4] });
        /* 列车 */
        var train = R.add(['box', 5.2, 1.6, 1.9], { color: [.18, .3, .26], emissive: [.02, .05, .04], rough: .55, metal: .35, rim: .2, radius: 3 }, { pos: [0, -.2, 1.9] });
        var cab = R.add(['box', 1.8, 2.1, 1.9], { color: [.14, .24, .22], rough: .5, metal: .4, rim: .2, radius: 1.3 }, { pos: [-2.6, .05, 1.9] });
        var lamp = orb(R, 3.1, .5, 1.9, [1, .9, .6], .16, { intensity: 2.4 });
        var stack = R.add(['cyl', .3, 1.3, 12, true], { color: [.1, .1, .1], rough: .7, rim: .2, radius: .8 }, { pos: [-2.2, 1.4, 1.9] });
        var steam = R.particles(90, { additive: true, size: 60 });
        for (var s = 0; s < 90; s++) steam.set(s, -2.2, 2.2, 1.9, 40, 1, 1, 1, 0);
        steam.upload();
        var sLife = new Float32Array(90), sVel = [];
        for (var q = 0; q < 90; q++) sLife[q] = Math.random();
        var press = .3, band = .5, acc = 0, down = false, tt = 0, x = 0;
        return {
          update: function (dt) {
            tt += dt; band = .5 + Math.sin(tt * .7) * .26;
            press += (down ? dt * .38 : -dt * .30); press = Math.max(0, Math.min(1, press));
            var inb = Math.abs(press - band) < .11;
            acc += (inb ? dt : -dt * .6); acc = Math.max(0, Math.min(5, acc));
            x -= dt * (2 + press * 6);
            if (x < -60) x = 60;
            train.pos[0] = x; cab.pos[0] = x - 2.6; stack.pos[0] = x - 2.2;
            lamp.set(x + 3.1, .5, 1.9);
            lamp.alpha(.6 + .4 * press);
            /* 蒸汽 */
            for (var i = 0; i < steam.n; i++) {
              sLife[i] -= dt * (.35 + Math.random() * .1);
              if (sLife[i] <= 0) {
                sLife[i] = 1;
                steam.set(i, x - 2.2 + (Math.random() - .5) * .4, 2.0, 1.9 + (Math.random() - .5) * .4, 30, .95, .96, .98, .38);
                sVel[i] = [.4 + Math.random() * .8 * press, .8 + Math.random() * .7, (Math.random() - .5) * .3];
              } else {
                steam.pos[i * 3] += (sVel[i] ? sVel[i][0] : .5) * dt;
                steam.pos[i * 3 + 1] += (sVel[i] ? sVel[i][1] : .9) * dt;
                steam.pos[i * 3 + 2] += (sVel[i] ? sVel[i][2] : 0) * dt;
                steam.data[i * 2] += dt * 26;
                steam.col[i * 4 + 3] = Math.max(0, sLife[i] * .34);
              }
            }
            steam.upload();
            R.camera.pos[0] = lerp(R.camera.pos[0], x * .18, .05);
            api.hud('气压 ' + Math.round(press * 100) + '% · 稳住 ' + acc.toFixed(1) + ' / 5.0 秒' + (inb ? '（正合适）' : ''), acc / 5);
            if (acc >= 5) api.done({ ok: true });
            if (tt > 34) api.done({ ok: acc >= 3 });
          },
          down: function () { down = true; }, up: function () { down = false; }
        };
      }
    },

    /* E05 对焦 —— 显微镜下的星 */
    focus: {
      title: '对焦', hint: '左右拖动对焦环，让视野里的光点收拢成星',
      setup: function (R, api) {
        R.camera.pos = [0, 0, 5.2]; R.camera.target = [0, 0, 0]; R.camera.fov = 46 * Math.PI / 180;
        R.sky = [.16, .2, .32]; R.ground = [.04, .05, .08];
        R.fog = { color: [.03, .05, .09], density: .02 };
        var lens = R.add(['torus', 2.6, .5, 64, 10], { color: [.1, .12, .16], rough: .5, rim: .35, radius: 3 }, { pos: [0, 0, .6] });
        var ps = R.particles(34, { additive: true, size: 40 });
        var base = [];
        for (var i = 0; i < 34; i++) {
          var a = i / 34 * 6.283 * 3, rr = .5 + (i % 6) * .32;
          base.push([Math.cos(a) * rr, Math.sin(a * 1.3) * rr * .8, (i % 5) * .2 - .4]);
          ps.set(i, base[i][0], base[i][1], base[i][2], 12, .75, .88, 1, .8);
        }
        ps.upload();
        var f = .1, target = .62, ph = 0, acc = 0;
        return {
          update: function (dt) {
            ph += dt * .55; target = .5 + Math.sin(ph) * .42;
            var blur = Math.abs(f - target);
            acc += (blur < .07 ? dt : -dt * .8); acc = Math.max(0, Math.min(1.5, acc));
            for (var i = 0; i < ps.n; i++) {
              var wob = blur * 1.5;
              ps.pos[i * 3] = base[i][0] * (1 + Math.sin(R.t * 2 + i) * wob * .3) + Math.sin(R.t * .7 + i) * wob;
              ps.pos[i * 3 + 1] = base[i][1] * (1 + Math.cos(R.t * 1.7 + i) * wob * .3) + Math.cos(R.t * .8 + i) * wob;
              ps.data[i * 2] = 9 + blur * 170;
              ps.col[i * 4 + 3] = .95 - blur * .55;
            }
            ps.upload();
            lens.rot[2] = f * 3;
            api.hud('清晰度 ' + Math.max(0, Math.round((1 - blur) * 100)) + '% · 拖动画面左右对焦', acc / 1.4);
            if (acc >= 1.35) api.done({ ok: true });
          },
          move: function (x, y, down) { if (down) f = Math.max(0, Math.min(1, x / (R.canvas.clientWidth || 900))); },
          tap: function (x) { f = Math.max(0, Math.min(1, x / (R.canvas.clientWidth || 900))); }
        };
      }
    },

    /* E06 连星 —— 把同色的星连起来 */
    starpairs: {
      title: '连星', hint: '点亮颜色相同的两颗星，把它们连成一条线',
      setup: function (R, api) {
        R.camera.pos = [0, 1.0, 7.4]; R.camera.target = [0, 0, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.2, .28, .5]; R.ground = [.04, .05, .09];
        R.fog = { color: [.04, .06, .12], density: .02 };
        stars(R, 140, 30, [.7, .8, 1]);
        var cols = [[1, .72, .36], [.49, .66, .85], [.47, .76, .71], [.85, .54, .54]];
        var starsArr = [], pos = [];
        for (var i = 0; i < 8; i++) pos.push([(i % 4 - 1.5) * 1.9, ((i / 4) | 0) * -1.6 + .8, (Math.random() - .5) * 1.2]);
        pos.sort(function () { return Math.random() - .5; });
        for (var j = 0; j < 8; j++) {
          var o = orb(R, pos[j][0], pos[j][1], pos[j][2], cols[(j / 2) | 0], .17, { intensity: 1.4 });
          o.core.pickable = true; o.core.mat.radius = .17;
          o.ci = (j / 2) | 0; o.on = false; o.base = pos[j];
          starsArr.push(o);
        }
        var sel = null, pairs = 0, tries = 0, lines = [];
        return {
          update: function (dt) {
            for (var i = 0; i < starsArr.length; i++) {
              var o = starsArr[i];
              o.set(o.base[0], o.base[1] + Math.sin(R.t * 1.2 + i) * .12, o.base[2]);
              o.scale((o.on ? 1.25 : 1) * (1 + .08 * Math.sin(R.t * 2.4 + i)));
            }
            lines.forEach(function (l) { l.mat.emissive = [.9, .82, .6]; });
            api.hud('已连成 ' + pairs + ' / 4 条 · 试了 ' + tries + ' 次', pairs / 4);
            if (pairs >= 4) api.done({ ok: true, tries: tries });
          },
          tap: function (x, y) {
            var hitO = R.pick(x, y, starsArr.map(function (o) { return o.core; }), 2.0);
            if (!hitO) return;
            var o = starsArr.filter(function (q) { return q.core === hitO; })[0];
            if (!o || o.on) return;
            if (!sel) { sel = o; o.on = true; o.color([1, 1, 1]); api.sfx('click'); }
            else if (sel.ci === o.ci) {
              o.on = true; pairs++; api.collect(1);
              var col = cols[o.ci];
              lines.push(segMesh(R, sel.pos, o.pos, .022, col, .85));
              sel = null; api.sfx('star', pairs);
            } else {
              sel.on = false; sel.color(cols[sel.ci]); tries++; sel = null; api.sfx('bad');
            }
          }
        };
      }
    },

    /* E07 信使航线 —— 引导囊泡穿过膜孔 */
    vesicle: {
      title: '信使航线', hint: '轻点给囊泡一点上浮的力，穿过五道膜孔，送到对岸',
      setup: function (R, api) {
        R.camera.pos = [0, 1.0, 8.2]; R.camera.target = [0, 0, 0]; R.camera.fov = 54 * Math.PI / 180;
        R.sky = [.18, .3, .48]; R.ground = [.05, .08, .12];
        R.fog = { color: [.05, .09, .16], density: .026 };
        var tunnel = [];
        for (var i = 0; i < 5; i++) {
          var x = -5.2 + i * 2.6;
          var t = R.add(['torus', 1.35, .13, 48, 10], {
            color: [.35, .55, .7], emissive: [.12, .3, .45], rough: .35, rim: .6, radius: 1.5
          }, { pos: [x, (Math.random() - .5) * 1.6, 0], rot: [0, Math.PI / 2, 0] });
          t.pass = false; t.cy = t.pos[1];
          tunnel.push(t);
        }
        var b = { x: -6.6, y: 0, vy: 0 };
        var ves = orb(R, b.x, b.y, 0, [.75, .93, 1], .2, { intensity: 3 });
        var trail = R.particles(60, { additive: true, size: 26 });
        for (var k2 = 0; k2 < 60; k2++) trail.set(k2, b.x, 0, 0, 10, .7, .9, 1, 0);
        trail.upload();
        var ti = 0;
        return {
          update: function (dt) {
            b.vy += dt * 1.6; b.vy = Math.max(-4, Math.min(4, b.vy));
            b.y += b.vy * dt * 3.2; b.x += dt * 2.6;
            if (b.y > 2.4) { b.y = 2.4; b.vy = .4; }
            if (b.y < -2.4) { b.y = -2.4; b.vy = -.4; }
            ves.set(b.x, b.y, 0);
            ves.scale(1 + .12 * Math.sin(R.t * 6));
            trail.set(ti, b.x - .1, b.y, 0, 14, .6, .85, 1, .5);
            ti = (ti + 1) % trail.n;
            for (var q = 0; q < trail.n; q++) if (trail.col[q * 4 + 3] > 0) trail.col[q * 4 + 3] -= dt * .55;
            trail.upload();
            var passed = 0;
            for (var i = 0; i < tunnel.length; i++) {
              var t = tunnel[i];
              t.rot[2] += dt * .6;
              if (!t.pass && Math.abs(b.x - t.pos[0]) < .35 && Math.abs(b.y - t.cy) < 1.2) {
                t.pass = true; t.mat.emissive = [.3, .95, .7]; api.sfx('star', i);
              }
              if (t.pass) passed++; api.collect(1);
            }
            R.camera.pos[0] = lerp(R.camera.pos[0], b.x * .35, .04);
            api.hud('穿过膜孔 ' + passed + ' / 5', b.x / 7.4 + .5);
            if (b.x > 7.4) api.done({ ok: passed >= 3, passed: passed });
          },
          tap: function () { b.vy = -3.0; api.sfx('type'); }
        };
      }
    },

    /* E08 接住萤火 —— 拖动玻璃瓶 */
    fireflies: {
      title: '接住萤火', hint: '拖动玻璃罐左右移动，接住八只萤火',
      setup: function (R, api) {
        R.camera.pos = [0, 1.6, 6.4]; R.camera.target = [0, .4, 0]; R.camera.fov = 54 * Math.PI / 180;
        R.sky = [.16, .2, .34]; R.ground = [.06, .09, .07];
        R.dir = [.2, .9, .4];
        R.fog = { color: [.05, .07, .1], density: .03 };
        ground(R, [.07, .1, .07], 60);
        for (var g = 0; g < 12; g++) {
          R.add(['cone', .16, 1.1 + Math.random(), 5], { color: [.1, .16, .12], rough: 1, rim: .1, radius: .8 },
            { pos: [(Math.random() - .5) * 12, -.7, -1 - Math.random() * 6], rot: [0, Math.random(), (Math.random() - .5) * .3] });
        }
        /* 玻璃罐 */
        var jar = R.add(['cyl', .85, 1.5, 22, false], {
          color: [.7, .85, .95], emissive: [.05, .1, .12], rough: .08, metal: .1, alpha: .22, rim: 1.1, radius: 1
        }, { pos: [0, -.5, 2.2] });
        var jarBase = R.add(['cyl', .87, .12, 22, true], { color: [.3, .35, .4], rough: .5, rim: .3, radius: .9 }, { pos: [0, -1.2, 2.2] });
        var flies = [], got = 0, time = 28, spawn = 0, bursts = [];
        function mk() {
          var o = orb(R, (Math.random() - .5) * 8, 3.2, (Math.random() - .5) * 2 + 1.6, [1, .92, .5], .13, { intensity: 1.5 });
          o.vy = -.5 - Math.random() * .5; o.vx = (Math.random() - .5) * .4; o.ph = Math.random() * 6.283;
          return o;
        }
        for (var i = 0; i < 4; i++) flies.push(mk());
        return {
          update: function (dt) {
            time -= dt; spawn -= dt;
            if (spawn <= 0 && flies.length < 6) { flies.push(mk()); spawn = .9; }
            for (var i = flies.length - 1; i >= 0; i--) {
              var f = flies[i]; f.ph += dt * 3;
              f.pos[0] += f.vx * dt + Math.sin(f.ph) * dt * .5;
              f.pos[1] += f.vy * dt;
              f.set(f.pos[0], f.pos[1], f.pos[2]);
              f.alpha(.45 + .55 * Math.pow(.5 + .5 * Math.sin(f.ph * 1.4), 3));
              if (f.pos[1] < -.4 && Math.abs(f.pos[0] - jar.pos[0]) < .9 && Math.abs(f.pos[2] - 2.2) < 1.2) {
                got++; api.collect(1); bursts.push(burst(R, f.pos[0], f.pos[1], f.pos[2], [1, .9, .5], 18, 2.2));
                f.dispose(); flies.splice(i, 1); api.sfx('star', got); continue;
              }
              if (f.pos[1] < -1.6) { f.dispose(); flies.splice(i, 1); }
            }
            bursts = bursts.filter(function (b) { return stepBurst(b, dt); });
            jar.mat.emissive = [.05 + got * .02, .1 + got * .02, .12];
            api.hud('瓶中 ' + got + ' / 8 · 拖动画面左右移动罐子', time / 28);
            if (got >= 8) api.done({ ok: true });
            if (time <= 0) api.done({ ok: got >= 5 });
          },
          move: function (x) {
            var w = R.canvas.clientWidth || 900;
            var t = (x / w - .5) * 9.2;
            jar.pos[0] = jarBase.pos[0] = Math.max(-4.4, Math.min(4.4, t));
          }
        };
      }
    },

    /* E09 浇花 —— 水珠装满时点一下 */
    orchid: {
      title: '浇花', hint: '每株花的水珠转到亮区时轻点它，早了晚了都算洒了，浇好三株',
      setup: function (R, api) {
        R.camera.pos = [0, 1.5, 5.2]; R.camera.target = [0, .5, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.55, .62, .5]; R.ground = [.1, .12, .09];
        R.dir = [.4, .9, .4];
        R.fog = { color: [.12, .15, .12], density: .02 };
        ground(R, [.11, .14, .1], 50);
        var fl = [];
        for (var i = 0; i < 3; i++) {
          var x = -2.6 + i * 2.6;
          var pot = R.add(['cyl', .45, .6, 16, true], { color: [.42, .3, .22], rough: .85, rim: .2, radius: .6 }, { pos: [x, -.9, 0] });
          var stem = R.add(['cyl', .05, 1.6, 8, false], { color: [.2, .38, .22], rough: .8, rim: .2, radius: .85 }, { pos: [x, .1, 0] });
          var group = { x: x, f: Math.random() * .6, sp: .3 + Math.random() * .16, done: false, petals: [], pot: pot, stem: stem };
          for (var p = 0; p < 5; p++) {
            var a = p / 5 * 6.283;
            var pet = R.add(['sphere', 12, 8, 1], {
              color: [.86, .78, .86], emissive: [.05, .03, .06], rough: .6, rim: .35, radius: .3
            }, { pos: [x + Math.cos(a) * .26, .95, Math.sin(a) * .26], scale: [.24, .12, .16], rot: [0, -a, .3] });
            group.petals.push(pet);
          }
          var heart = orb(R, x, 1.0, 0, [1, .85, .45], .1, { intensity: .8 });
          group.heart = heart;
          /* 水珠环 */
          var ring = R.add(['torus', .55, .035, 40, 8], { color: [.55, .75, .95], emissive: [.1, .25, .4], rough: .4, rim: .5, radius: .7 }, { pos: [x, 1.55, 0], rot: [Math.PI / 2, 0, 0] });
          var drop = orb(R, x + .55, 1.55, 0, [.6, .82, 1], .1, { intensity: 1 });
          group.ring = ring; group.drop = drop;
          group.hit = R.add(['sphere', 10, 8, 1], { color: [1, 1, 1], alpha: 0, unlit: 1, additive: true, radius: .9 }, { pos: [x, .6, 0], scale: [.9, .9, .9] });
          group.hit.pickable = true;
          fl.push(group);
        }
        var time = 34;
        return {
          update: function (dt) {
            time -= dt;
            var done = 0;
            for (var i = 0; i < fl.length; i++) {
              var g = fl[i];
              if (!g.done) { g.f += g.sp * dt; if (g.f >= 1.18) g.f = 0; }
              else done++; api.collect(1);
              var good = g.f > .84 && g.f < 1.04;
              var a = g.f / 1.18 * 6.283;
              g.drop.set(g.x + Math.cos(a - 1.57) * .55, 1.55, Math.sin(a - 1.57) * .55);
              g.drop.alpha(good ? 1 : .55);
              g.drop.color(good ? [1, .85, .4] : [.6, .82, 1]);
              g.ring.mat.emissive = g.done ? [.3, .8, .5] : (good ? [.9, .7, .25] : [.1, .25, .4]);
              g.heart.alpha(g.done ? .9 + .1 * Math.sin(R.t * 3) : .35);
              for (var p = 0; p < g.petals.length; p++) {
                var s = g.done ? 1.25 : (1 + .05 * Math.sin(R.t * 2 + p));
                g.petals[p].scale = [.24 * s, .12 * s, .16 * s];
              }
            }
            api.hud('浇好 ' + done + ' / 3 株', time / 34);
            if (done >= 3) api.done({ ok: true });
            if (time <= 0) api.done({ ok: done >= 2 });
          },
          tap: function (x, y) {
            var hitO = R.pick(x, y, fl.map(function (g) { return g.hit; }), 1.1);
            if (!hitO) return;
            var g = fl.filter(function (q) { return q.hit === hitO; })[0];
            if (!g || g.done) return;
            if (g.f > .84 && g.f < 1.04) { g.done = true; api.sfx('good'); }
            else { g.f = 0; api.sfx('bad'); }
          }
        };
      }
    },

    /* E10 助它升高 —— 穿云而上 */
    launch: {
      title: '助它升高', hint: '不断轻点，给发光体一点向上的力，别让它落回屋檐下',
      setup: function (R, api) {
        R.camera.pos = [0, 0, 7]; R.camera.target = [0, 0, 0]; R.camera.fov = 56 * Math.PI / 180;
        R.sky = [.35, .28, .5]; R.ground = [.08, .06, .12];
        R.fog = { color: [.14, .12, .22], density: .018 };
        stars(R, 160, 34, [.85, .8, 1]);
        var clouds = [];
        for (var i = 0; i < 9; i++) {
          clouds.push(R.add(['plane', 7 + Math.random() * 5, 3 + Math.random() * 2, 1], {
            color: [.7, .66, .8], emissive: [.1, .09, .14], rough: 1, alpha: .17, additive: false, rim: .3, radius: 5
          }, { pos: [(Math.random() - .5) * 9, -4 + i * 3.4, -2 - Math.random() * 4], rot: [Math.PI / 2, 0, Math.random()] }));
        }
        var b = { y: -3.6, vy: 0 };
        var o = orb(R, 0, b.y, 0, [1, .88, .55], .22, { intensity: 4 });
        var trail = R.particles(70, { additive: true, size: 30 });
        var ti = 0;
        for (var q = 0; q < 70; q++) trail.set(q, 0, b.y, 0, 12, 1, .85, .5, 0);
        trail.upload();
        var alt = 0, time = 24, taps = 0;
        return {
          update: function (dt) {
            time -= dt;
            b.vy += dt * 2.0; b.y += b.vy * dt * 4.2;
            if (b.y > 15) b.y = 15;
            if (b.y < -3.6) { b.y = -3.6; b.vy = -.2; }
            alt = Math.max(alt, (b.y + 3.6) / 18.6);
            o.set(Math.sin(R.t * 1.3) * .3, b.y, 0);
            o.scale(1 + .15 * Math.sin(R.t * 7));
            trail.set(ti, Math.sin(R.t * 1.3) * .3, b.y - .2, 0, 16, 1, .8, .5, .55);
            ti = (ti + 1) % trail.n;
            for (var k = 0; k < trail.n; k++) if (trail.col[k * 4 + 3] > 0) trail.col[k * 4 + 3] -= dt * .5;
            trail.upload();
            R.camera.pos[1] = lerp(R.camera.pos[1], b.y + 1.2, .06);
            R.camera.target[1] = lerp(R.camera.target[1], b.y, .08);
            api.hud('升高 ' + Math.round(alt * 100) + '%', alt);
            if (alt >= .97) api.done({ ok: true, taps: taps });
            if (time <= 0) api.done({ ok: alt >= .7 });
          },
          tap: function () { b.vy = -3.4; taps++; api.collect(1); api.sfx('type'); }
        };
      }
    },

    /* E11 撑伞 —— 替两个人挡雨 */
    umbrella: {
      title: '撑伞', hint: '拖动伞左右移动，替两个人挡住这场雨，撑满十五秒',
      setup: function (R, api) {
        R.camera.pos = [0, 1.9, 6.6]; R.camera.target = [0, .5, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.42, .5, .58]; R.ground = [.09, .11, .12];
        R.dir = [.3, .9, .3];
        R.fog = { color: [.3, .36, .42], density: .03 };
        ground(R, [.1, .12, .13], 60);
        var p1 = R.add(['capsule', .22, .9, 12], { color: [.72, .68, .62], rough: .8, rim: .2, radius: .8 }, { pos: [-.45, -.2, 0] });
        var h1 = R.add(['sphere', 14, 10, 1], { color: [.78, .72, .66], rough: .7, rim: .25, radius: .3 }, { pos: [-.45, .62, 0], scale: [.24, .27, .24] });
        var p2 = R.add(['capsule', .17, .62, 12], { color: [.6, .66, .7], rough: .8, rim: .2, radius: .6 }, { pos: [.4, -.45, 0] });
        var h2 = R.add(['sphere', 14, 10, 1], { color: [.66, .7, .74], rough: .7, rim: .25, radius: .26 }, { pos: [.4, .18, 0], scale: [.2, .22, .2] });
        var umb = R.add(['cone', 1.6, .8, 24], { color: [.85, .55, .3], emissive: [.12, .05, .02], rough: .5, rim: .35, radius: 1.7 }, { pos: [0, 2.0, 0], rot: [Math.PI, 0, 0] });
        var pole = R.add(['cyl', .045, 2.6, 8, false], { color: [.3, .25, .2], rough: .6, rim: .2, radius: 1.3 }, { pos: [0, .75, 0] });
        var rain = R.particles(260, { additive: false, size: 22 });
        var ry = [], rz = [];
        for (var i = 0; i < 260; i++) {
          rain.set(i, (Math.random() - .5) * 14, Math.random() * 8 - 1, (Math.random() - .5) * 5, 6 + Math.random() * 8, .72, .82, .95, .5);
          ry[i] = -6 - Math.random() * 5;
        }
        rain.upload();
        var acc = 0, wet = 0, ux = 0;
        return {
          update: function (dt) {
            acc += dt;
            umb.pos[0] = pole.pos[0] = ux;
            for (var i = 0; i < rain.n; i++) {
              rain.pos[i * 3 + 1] += ry[i] * dt;
              if (rain.pos[i * 3 + 1] < -1.2) {
                rain.pos[i * 3] = (Math.random() - .5) * 14;
                rain.pos[i * 3 + 1] = 7.5;
                rain.pos[i * 3 + 2] = (Math.random() - .5) * 5;
                ry[i] = -6 - Math.random() * 4;
              }
              if (rain.pos[i * 3 + 1] < 1.75 && rain.pos[i * 3 + 1] > 1.55) {
                if (Math.abs(rain.pos[i * 3] - ux) < 1.5 && Math.abs(rain.pos[i * 3 + 2]) < 1.6) {
                  rain.pos[i * 3 + 1] = 1.5; ry[i] = 0; rain.col[i * 4 + 3] = 0;
                  setTimeout((function (idx) { return function () { rain.col[idx * 4 + 3] = .5; ry[idx] = -6; rain.pos[idx * 3 + 1] = 7.5; }; })(i), 60);
                } else if (Math.abs(rain.pos[i * 3]) < .9 && Math.abs(rain.pos[i * 3 + 2]) < 1) {
                  wet += .14;
                }
              }
            }
            rain.upload();
            api.hud('撑住 ' + acc.toFixed(1) + ' / 15.0 秒 · 淋湿 ' + Math.round(wet), acc / 15);
            if (acc >= 15) api.done({ ok: wet < 26, wet: wet });
            if (wet >= 26) api.done({ ok: false, wet: wet });
          },
          move: function (x) {
            var w = R.canvas.clientWidth || 900;
            ux = Math.max(-3.6, Math.min(3.6, (x / w - .5) * 9));
          }
        };
      }
    },

    /* E12 描一封信 —— 跟着光点走完笔画 */
    trace: {
      title: '描一封信', hint: '按住不放，让指尖跟着光点走完这封信的笔画',
      setup: function (R, api) {
        R.camera.pos = [0, 1.0, 5.6]; R.camera.target = [0, .6, 0]; R.camera.fov = 50 * Math.PI / 180;
        R.sky = [.2, .24, .4]; R.ground = [.05, .06, .1];
        R.fog = { color: [.06, .08, .14], density: .03 };
        stars(R, 70, 22, [.7, .78, 1]);
        function path(t) {
          var a = t * 6.283;
          return [Math.sin(a) * 1.7 + Math.sin(a * 3) * .38, .6 + Math.cos(a * 2) * .95, Math.sin(a * 1.5) * .5];
        }
        lineSeq++;
        var pts = curvePts(path, 220);
        R.add(['lines', pts], { color: [.55, .5, .42], unlit: 1, alpha: .35, radius: 1 });
        var head = orb(R, 0, 0, 0, [1, .88, .6], .16, { intensity: 3 });
        var ph = 0, cov = 0, down = false, t = 0;
        return {
          update: function (dt, inp) {
            t += dt; ph += dt * .32; if (ph > 1) ph -= 1;
            var p = path(ph);
            head.set(p[0], p[1], p[2]);
            head.scale(1 + .2 * Math.sin(R.t * 6));
            if (down && Math.hypot(inp.x - R.project(p).x, inp.y - R.project(p).y) < 64) cov = Math.min(1, cov + dt * .5);
            else cov = Math.max(0, cov - dt * .05);
            /* 已描过的部分更亮 */
            api.hud('描过 ' + Math.round(cov * 100) + '%', cov);
            if (cov >= .97) api.done({ ok: true });
            if (t > 70) api.done({ ok: cov > .6 });
          },
          down: function () { down = true; }, up: function () { down = false; }
        };
      }
    },

    /* E13 记方 —— 记住她配试剂的顺序 */
    recipe: {
      title: '记方', hint: '先看一遍顺序，再照着点出来，两轮都对才算记住',
      setup: function (R, api) {
        R.camera.pos = [0, 1.6, 5.4]; R.camera.target = [0, .35, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.55, .62, .66]; R.ground = [.1, .12, .13];
        R.dir = [.3, .9, .4];
        R.fog = { color: [.16, .2, .24], density: .02 };
        ground(R, [.12, .14, .15], 50);
        var shelf = R.add(['box', 6.4, .12, 1.1], { color: [.35, .26, .18], rough: .85, rim: .15, radius: 3.2 }, { pos: [0, -.75, -.4] });
        var cols = [[1, .8, .4], [.5, .8, .95], [.9, .55, .55], [.65, .9, .7], [.8, .65, .95], [.95, .8, .55]];
        var bottles = [];
        for (var i = 0; i < 6; i++) {
          var x = -2.5 + (i % 3) * 2.5, z = -.4 + ((i / 3) | 0) * 1.1;
          var glass = R.add(['cyl', .32, .9, 16, true], {
            color: [.8, .88, .92], emissive: [.03, .05, .06], rough: .1, metal: .2, alpha: .38, rim: 1, radius: .6
          }, { pos: [x, -.2, z] });
          var liq = R.add(['cyl', .26, .52, 14, true], {
            color: cols[i], emissive: [cols[i][0] * .12, cols[i][1] * .12, cols[i][2] * .12], rough: .25, rim: .5, radius: .4
          }, { pos: [x, -.4, z] });
          var hit = R.add(['sphere', 10, 8, 1], { color: cols[i], alpha: 0, unlit: 1, additive: true, radius: .62 }, { pos: [x, -.15, z], scale: [.62, .62, .62] });
          hit.pickable = true;
          bottles.push({ glass: glass, liq: liq, hit: hit, i: i, base: [x, -.2, z] });
        }
        var need = [4, 5], round = 0, seq = [], idx = 0, phase = 'show', timer = 0;
        function newRound() {
          var pool = [0, 1, 2, 3, 4, 5].sort(function () { return Math.random() - .5; });
          seq = pool.slice(0, need[round]); idx = 0; timer = 0; phase = 'show';
        }
        newRound();
        return {
          update: function (dt) {
            timer += dt;
            for (var i = 0; i < bottles.length; i++) {
              var b = bottles[i];
              var on = (phase === 'show' && seq[idx] === i && idx < seq.length);
              var lift = on ? .18 : 0;
              b.glass.pos[1] = b.base[1] + lift; b.liq.pos[1] = b.base[1] - .2 + lift; b.hit.pos[1] = b.base[1] + .05 + lift;
              b.liq.mat.emissive = on ? [cols[i][0] * .9, cols[i][1] * .9, cols[i][2] * .9] : [cols[i][0] * .12, cols[i][1] * .12, cols[i][2] * .12];
              b.glass.mat.rim = on ? 1.6 : 1;
            }
            if (phase === 'show') {
              if (timer > .85) { timer = 0; idx++; if (idx >= seq.length) { phase = 'input'; idx = 0; timer = 0; } }
            }
            api.hud(phase === 'show' ? ('第 ' + (round + 1) + ' 轮 · 记住顺序') : ('第 ' + (round + 1) + ' 轮 · 照着点 ' + (idx + 1) + ' / ' + seq.length), (round * 5 + idx) / 9);
          },
          tap: function (x, y) {
            if (phase !== 'input') return;
            var hitO = R.pick(x, y, bottles.map(function (b) { return b.hit; }), 1.1);
            if (!hitO) return;
            var b = bottles.filter(function (q) { return q.hit === hitO; })[0];
            if (seq[idx] === b.i) {
              idx++; api.collect(1); api.sfx('good');
              if (idx >= seq.length) {
                round++; api.collect(1);
                if (round >= 2) { api.done({ ok: true }); return; }
                newRound();
              }
            } else { round = 0; api.sfx('bad'); newRound(); }
          }
        };
      }
    },

    /* E14 理照片 —— 按年份从早到晚 */
    order: {
      title: '理照片', hint: '把五张照片按年份从早到晚点一遍，帮他把一生排回原处',
      setup: function (R, api) {
        R.camera.pos = [0, 1.7, 5.6]; R.camera.target = [0, .5, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.62, .5, .35]; R.ground = [.09, .08, .07];
        R.dir = [.6, .8, .3];
        R.fog = { color: [.2, .16, .12], density: .03 };
        ground(R, [.11, .1, .09], 60);
        R.light([2.5, 3.2, 2], [1, .85, .6], 3.4);
        var years = [1958, 1963, 1971, 1980, 1994].sort(function () { return Math.random() - .5; });
        var sorted = years.slice().sort(function (a, b) { return a - b; });
        var cards = [];
        for (var i = 0; i < 5; i++) {
          var cv = document.createElement('canvas'); cv.width = 256; cv.height = 340;
          var c2 = cv.getContext('2d');
          var g = c2.createLinearGradient(0, 0, 0, 340);
          g.addColorStop(0, '#efe6d2'); g.addColorStop(1, '#cbbb9d');
          c2.fillStyle = g; c2.fillRect(0, 0, 256, 340);
          c2.fillStyle = 'rgba(90,70,50,.35)';
          c2.beginPath(); c2.arc(128, 150, 62, 0, 6.283); c2.fill();
          c2.fillStyle = 'rgba(70,55,40,.5)';
          c2.beginPath(); c2.moveTo(48, 340); c2.quadraticCurveTo(128, 200, 208, 340); c2.fill();
          c2.fillStyle = 'rgba(60,45,32,.9)'; c2.fillRect(0, 286, 256, 54);
          c2.fillStyle = '#f6ecd8'; c2.font = '30px Georgia,serif'; c2.textAlign = 'center';
          c2.fillText(String(years[i]), 128, 322);
          var tex = global.GL.texFromCanvas(R, cv);
          var x = -2.8 + i * 1.4;
          var card = R.add(['plane', 1.05, 1.4, 1], {
            color: [1, 1, 1], tex: tex, rough: .7, rim: .25, radius: .9
          }, { pos: [x, .55, 0], rot: [0, -.12 + i * .06, 0] });
          card.pickable = true;
          cards.push({ obj: card, y: years[i], base: [x, .55, 0], done: false, shake: 0 });
        }
        var step = 0;
        return {
          update: function (dt) {
            for (var i = 0; i < cards.length; i++) {
              var c = cards[i];
              if (c.shake > 0) { c.shake -= dt * 3; c.obj.pos[0] = c.base[0] + Math.sin(c.shake * 40) * .12; }
              else c.obj.pos[0] = c.base[0];
              c.obj.pos[1] = c.base[1] + Math.sin(R.t * 1.2 + i) * .05 + (c.done ? .18 : 0);
              c.obj.rot[1] = -.12 + i * .06 + (c.done ? 0 : Math.sin(R.t * .8 + i) * .04);
            }
            api.hud('按顺序点出年份 · 已排好 ' + step + ' / 5（最早是 ' + sorted[0] + '）', step / 5);
            if (step >= 5) api.done({ ok: true });
          },
          tap: function (x, y) {
            var hitO = R.pick(x, y, cards.map(function (c) { return c.obj; }), .8);
            if (!hitO) return;
            var c = cards.filter(function (q) { return q.obj === hitO; })[0];
            if (c.done) return;
            if (c.y === sorted[step]) { c.done = true; step++; api.collect(1); api.sfx('star', step); }
            else { c.shake = .5; api.sfx('bad'); }
          }
        };
      }
    },

    /* E15 四季之转 —— 把窗外转到桂花开的那一季 */
    season: {
      title: '四季之转', hint: '左右拖动圆盘，转到桂花开的那一季，停住一秒',
      setup: function (R, api) {
        R.camera.pos = [0, 2.2, 6.4]; R.camera.target = [0, .6, 0]; R.camera.fov = 52 * Math.PI / 180;
        R.sky = [.5, .55, .5]; R.ground = [.09, .11, .09];
        R.dir = [.4, .9, .35];
        R.fog = { color: [.16, .18, .16], density: .02 };
        ground(R, [.12, .15, .11], 60);
        var names = ['春', '夏', '秋', '冬'];
        var cols = [[.55, .78, .5], [.45, .7, .9], [1, .72, .3], [.72, .8, .95]];
        var trunk = R.add(['cyl', .22, 2.4, 10, true], { color: [.28, .2, .14], rough: .9, rim: .15, radius: 1.3 }, { pos: [0, .0, -.5] });
        var branches = [];
        for (var b = 0; b < 7; b++) {
          var a = b / 7 * 6.283;
          branches.push(R.add(['cyl', .07, 1.5, 6, false], { color: [.3, .22, .16], rough: .9, rim: .15, radius: .8 },
            { pos: [Math.cos(a) * .55, .9, -.5 + Math.sin(a) * .55], rot: [Math.cos(a) * .7, 0, -Math.sin(a) * .7] }));
        }
        var blossom = R.particles(160, { additive: true, size: 30 });
        for (var i = 0; i < 160; i++) {
          var a2 = i * 2.4, r2 = .5 + (i % 7) * .22;
          blossom.set(i, Math.cos(a2) * r2, 1.2 + Math.sin(i * 1.7) * .6, -.5 + Math.sin(a2) * r2, 14, 1, .8, .4, 0);
        }
        blossom.upload();
        var dial = R.add(['cyl', 1.6, .16, 40, true], { color: [.34, .28, .2], rough: .5, metal: .5, rim: .4, radius: 1.7 }, { pos: [0, -1.05, 1.6] });
        var marks = [];
        for (var m = 0; m < 4; m++) {
          var am = m / 4 * 6.283;
          marks.push(R.add(['sphere', 12, 8, 1], {
            color: cols[m], emissive: [cols[m][0] * .3, cols[m][1] * .3, cols[m][2] * .3], rough: .4, rim: .6, radius: .22
          }, { pos: [Math.cos(am) * 1.15, -.9, 1.6 + Math.sin(am) * 1.15], scale: [.2, .2, .2] }));
        }
        var pointer = R.add(['cone', .16, .6, 10], { color: [1, .85, .45], emissive: [.6, .45, .1], rough: .3, rim: .6, radius: .35 }, { pos: [1.15, -.75, 1.6], rot: [0, 0, -1.57] });
        var ang = 0, hold = 0, target = 2;
        return {
          update: function (dt) {
            var cur = ((Math.round(ang / (6.283 / 4)) % 4) + 4) % 4;
            var bloom = cur === 2 ? 1 : (cur === 0 ? .55 : cur === 1 ? .2 : 0);
            for (var i = 0; i < blossom.n; i++) {
              blossom.data[i * 2] = 8 + bloom * 22;
              blossom.col[i * 4] = cols[cur][0]; blossom.col[i * 4 + 1] = cols[cur][1]; blossom.col[i * 4 + 2] = cols[cur][2];
              blossom.col[i * 4 + 3] = bloom * (.5 + .5 * Math.sin(R.t * 2 + i));
            }
            blossom.upload();
            R.sky = [lerp(.4, cols[cur][0], .5), lerp(.5, cols[cur][1], .5), lerp(.5, cols[cur][2], .5)];
            dial.rot[1] = ang;
            for (var m = 0; m < 4; m++) {
              var am = m / 4 * 6.283 + ang;
              marks[m].pos[0] = Math.cos(am) * 1.15; marks[m].pos[2] = 1.6 + Math.sin(am) * 1.15;
              var on = (m === cur);
              marks[m].scale = [on ? .3 : .2, on ? .3 : .2, on ? .3 : .2];
              marks[m].mat.emissive = on ? [cols[m][0] * .9, cols[m][1] * .9, cols[m][2] * .9] : [cols[m][0] * .2, cols[m][1] * .2, cols[m][2] * .2];
            }
            pointer.pos[0] = Math.cos(6.283 * 2 / 4 + ang) * 1.15;
            pointer.pos[2] = 1.6 + Math.sin(6.283 * 2 / 4 + ang) * 1.15;
            hold += (cur === target ? dt : -dt * 2); hold = Math.max(0, Math.min(1.2, hold));
            api.hud('拖动画面旋转 · 当前：' + names[cur] + '（桂花在「秋」）', hold);
            if (hold >= 1) api.done({ ok: true });
          },
          drag: function (dx) { ang += dx * .012; }
        };
      }
    },

    /* E16 十六枚种子 —— 把种子送回天上 */
    stars: {
      title: '十六枚种子', hint: '星河里亮起哪一颗，就点哪一颗，把十六枚种子送回天上',
      setup: function (R, api) {
        R.camera.pos = [0, 1.2, 9]; R.camera.target = [0, .6, 0]; R.camera.fov = 56 * Math.PI / 180;
        R.sky = [.16, .2, .38]; R.ground = [.05, .06, .12];
        R.fog = { color: [.05, .07, .14], density: .012 };
        stars(R, 220, 36, [.8, .86, 1]);
        var neb = R.particles(90, { additive: true, size: 200 });
        for (var n0 = 0; n0 < 90; n0++) {
          var a0 = Math.random() * 6.283, r0 = Math.random() * 16;
          neb.set(n0, Math.cos(a0) * r0, 2 + Math.random() * 6, Math.sin(a0) * r0 - 4, 200 + Math.random() * 260, .35, .45, .85, .05);
        }
        neb.upload();
        var list = [], cols = [[1, .88, .5], [.5, .66, .95], [.65, .88, .8], [.9, .62, .62], [1, .8, .6], [.7, .8, 1]];
        for (var i = 0; i < 16; i++) {
          var a = i / 16 * 6.283 * 2.2, r = 1.1 + i * .28;
          var o = orb(R, Math.cos(a) * r, .6 + Math.sin(a * 1.6) * 1.5, Math.sin(a) * r * .55 - 1.5, [.5, .6, .85], .13, { intensity: .5 });
          o.core.pickable = true; o.core.mat.radius = .13;
          o.ci = cols[i % cols.length]; o.on = false; o.base = [Math.cos(a) * r, .6 + Math.sin(a * 1.6) * 1.5, Math.sin(a) * r * .55 - 1.5];
          list.push(o);
        }
        var idx = 0, lit = -1, timer = 0, bursts = [];
        return {
          update: function (dt) {
            timer += dt;
            if (lit < 0 && timer > .3 && idx < 16) { lit = idx; timer = 0; }
            for (var i = 0; i < list.length; i++) {
              var o = list[i];
              o.set(o.base[0], o.base[1] + Math.sin(R.t * 1.1 + i) * .16, o.base[2]);
              var isLit = (i === lit);
              o.scale((o.on ? 1.35 : 1) * (1 + (isLit ? .35 : .08) * Math.sin(R.t * 5)));
              if (!o.on) o.color(isLit ? [1, .96, .85] : [.5, .6, .85]);
            }
            R.camera.pos[0] = Math.sin(R.t * .12) * 2.2;
            R.camera.pos[2] = 9 + Math.cos(R.t * .1) * .8;
            R.camera.target[0] = lerp(R.camera.target[0], idx < 16 ? list[idx].base[0] * .3 : 0, .03);
            bursts = bursts.filter(function (b) { return stepBurst(b, dt); });
            api.hud('送回天上 ' + idx + ' / 16', idx / 16);
            if (idx >= 16) api.done({ ok: true });
          },
          tap: function (x, y) {
            if (lit < 0) return;
            var hitO = R.pick(x, y, [list[lit].core], 2.4);
            if (!hitO) return;
            var o = list[lit];
            o.on = true; o.color(o.ci);
            bursts.push(burst(R, o.base[0], o.base[1], o.base[2], o.ci, 26, 3.2));
            idx++; api.collect(1); lit = -1; timer = 0;
            api.sfx('star', idx);
          }
        };
      }
    }
  };

  /* ---------------- 运行器 ---------------- */
  var current = null;

  function play(id, cv, titleEl, hintEl, hudEl, fillEl) {
    var def = GAMES[id];
    if (!def) return Promise.resolve({ fallback: true });
    var R = null;
    try { R = global.GL.create(cv); } catch (e) { R = null; }
    if (!R) return Promise.resolve({ fallback: true });

    if (titleEl) titleEl.textContent = def.title;
    if (hintEl) hintEl.textContent = def.hint;

    return new Promise(function (resolve) {
      var inp = { x: 0, y: 0, down: false, lx: 0 };
      var last = 0, raf = 0, over = false;

      var api = {
        done: function (r) {
          if (over) return;
          over = true; cancelAnimationFrame(raf); off();
          try { R.clear(); } catch (e) { }
          current = null;
          resolve(r || { ok: true });
        },
        hud: function (txt, v) {
          if (hudEl) hudEl.textContent = txt;
          if (fillEl) fillEl.style.width = Math.max(0, Math.min(1, v || 0)) * 100 + '%';
        },
        sfx: function (k, i) {
          try { global.Audio2 && global.Audio2.sfx[k] && global.Audio2.sfx[k](i || 0); } catch (e) { }
        },
        /* 每真正收集到一枚外泌体：实时累加到左上角，并飞一个光点过去 */
        collect: function (n) { try { if (window.ESCORE && window.ESCORE.gain) window.ESCORE.gain(n || 1); } catch (e) { } },
        R: R
      };

      var g;
      try { g = def.setup(R, api); } catch (e) {
        console.warn('3D setup failed', e);
        api.done({ fallback: true }); return;
      }

      function pos(e) {
        var r = cv.getBoundingClientRect();
        var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        return { x: cx - r.left, y: cy - r.top };
      }
      function onDown(e) { var p = pos(e); inp.x = p.x; inp.y = p.y; inp.lx = p.x; inp.down = true; if (g.down) g.down(p.x, p.y); }
      function onMove(e) {
        var p = pos(e); inp.lx = inp.x; inp.x = p.x; inp.y = p.y;
        if (g.drag && inp.down) g.drag(p.x - inp.lx);
        if (g.move) g.move(p.x, p.y, inp.down);
      }
      function onUp(e) {
        var p = pos(e); inp.down = false; inp.x = p.x; inp.y = p.y;
        if (g.up) g.up(p.x, p.y);
        if (g.tap) g.tap(p.x, p.y);
      }
      function onKey(e) { if (e.code === 'Space' && g.tap) { e.preventDefault(); g.tap(inp.x, inp.y); } }
      function off() {
        cv.removeEventListener('mousedown', onDown); cv.removeEventListener('mousemove', onMove);
        global.removeEventListener('mouseup', onUp);
        cv.removeEventListener('touchstart', onDown); cv.removeEventListener('touchmove', onMoveT);
        global.removeEventListener('touchend', onUp);
        global.removeEventListener('keydown', onKey);
      }
      function onMoveT(e) { e.preventDefault(); onMove(e); }
      cv.addEventListener('mousedown', onDown); cv.addEventListener('mousemove', onMove);
      global.addEventListener('mouseup', onUp);
      cv.addEventListener('touchstart', onDown, { passive: false });
      cv.addEventListener('touchmove', onMoveT, { passive: false });
      global.addEventListener('touchend', onUp);
      global.addEventListener('keydown', onKey);

      function frame(ts) {
        if (over) return;
        var dt = last ? Math.min(.05, (ts - last) / 1000) : .016;
        last = ts;
        g.update(dt, inp, api);
        R.render(dt);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      current = { abort: function () { api.done({ ok: true, skipped: true }); } };
    });
  }

  global.MG3D = {
    play: play,
    abort: function () { if (current) current.abort(); },
    has: function (id) { return !!GAMES[id]; }
  };
})(window);
