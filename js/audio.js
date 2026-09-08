/* ============================================================
 * audio.js —— 音频引擎
 *  1) BGM：Web Audio 程序化生成的分层环境音乐（和声垫 + 琶音 + 低频）
 *  2) 天气层：雨 / 风 / 虫鸣 / 雪 的噪声氛围，随剧集切换
 *  3) 音效：打字、点击、种子凝聚、成功、失败
 *  4) 外部音频：若 assets/audio/ 下放了同名文件，则优先使用文件
 * ============================================================ */
(function (global) {
  'use strict';

  var A = {
    ctx: null, ready: false, started: false,
    music: true, sfxOn: true, musicVol: .68,
    master: null, busMusic: null, busSfx: null, busAmb: null, verb: null,
    nodes: [], timer: null, step: 0, mood: 'dusk', weather: 'clear',
    amb: null, chordIdx: 0
  };

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (A.ctx) return true;
    try {
      var C = global.AudioContext || global.webkitAudioContext;
      if (!C) return false;
      A.ctx = new C();
      A.master = A.ctx.createGain(); A.master.gain.value = 0.9;
      A.master.connect(A.ctx.destination);

      A.busMusic = A.ctx.createGain(); A.busMusic.gain.value = 0.34;
      A.busSfx = A.ctx.createGain(); A.busSfx.gain.value = 0.7;
      A.busAmb = A.ctx.createGain(); A.busAmb.gain.value = 0.0;

      /* 混响 */
      A.verb = A.ctx.createConvolver();
      A.verb.buffer = impulse(2.6, 2.2);
      var verbGain = A.ctx.createGain(); verbGain.gain.value = 0.45;
      A.verb.connect(verbGain); verbGain.connect(A.master);

      A.busMusic.connect(A.master); A.busMusic.connect(A.verb);
      A.busSfx.connect(A.master); A.busSfx.connect(A.verb);
      A.busAmb.connect(A.master);
      A.ready = true;
      return true;
    } catch (e) { return false; }
  }

  function impulse(dur, decay) {
    var rate = A.ctx.sampleRate, len = Math.floor(rate * dur);
    var buf = A.ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function resume() {
    if (!init()) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
  }

  /* ---------------- 音效 ---------------- */
  function tone(o) {
    if (!A.sfxOn || !init()) return;
    try {
      var t = A.ctx.currentTime;
      var osc = A.ctx.createOscillator(), g = A.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.v || .06, t + (o.a || .015));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
      var dest = o.bus || A.busSfx;
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + o.d + .05);
    } catch (e) { }
  }

  var SFX = {
    click: function () { tone({ f: 520, f2: 380, d: .09, type: 'sine', v: .05 }); },
    type: function () { tone({ f: 900 + Math.random() * 160, d: .02, type: 'triangle', v: .012 }); },
    open: function () { tone({ f: 300, f2: 460, d: .18, type: 'triangle', v: .05 }); },
    close: function () { tone({ f: 460, f2: 260, d: .16, type: 'triangle', v: .04 }); },
    seed: function () {
      tone({ f: 660, d: .5, type: 'sine', v: .08 });
      setTimeout(function () { tone({ f: 990, d: .9, type: 'sine', v: .07 }); }, 130);
      setTimeout(function () { tone({ f: 1320, d: 1.2, type: 'sine', v: .04 }); }, 280);
    },
    good: function () { tone({ f: 720, f2: 1080, d: .22, type: 'sine', v: .06 }); },
    bad: function () { tone({ f: 220, f2: 160, d: .26, type: 'sawtooth', v: .04 }); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        setTimeout(function () { tone({ f: f, d: .5, type: 'sine', v: .07 }); }, i * 110);
      });
    },
    star: function (i) { tone({ f: 440 * Math.pow(1.0595, (i % 12) * 2), d: .35, type: 'sine', v: .05 }); }
  };

  /* ---------------- 天气噪声层 ---------------- */
  function noiseBuffer(sec) {
    var rate = A.ctx.sampleRate, len = rate * sec;
    var buf = A.ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function setWeather(w) {
    if (!init()) return;
    A.weather = w;
    if (A.amb) {
      try { A.amb.src.stop(); } catch (e) { }
      try { A.amb.src.disconnect(); } catch (e) { }
      A.amb = null;
    }
    var cfg = {
      rain: { type: 'bandpass', f: 1400, q: .7, g: .16, lfo: .0 },
      snow: { type: 'lowpass', f: 500, q: 1, g: .05, lfo: .05 },
      fog: { type: 'lowpass', f: 260, q: 1, g: .07, lfo: .03 },
      fireflies: { type: 'bandpass', f: 3200, q: 6, g: .05, lfo: 1.6 },
      leaves: { type: 'bandpass', f: 900, q: 1.4, g: .07, lfo: .25 },
      stars: { type: 'highpass', f: 5200, q: 1, g: .025, lfo: .08 },
      motes: { type: 'bandpass', f: 700, q: 2, g: .04, lfo: .18 },
      clear: null
    }[w];
    A.busAmb.gain.setTargetAtTime(cfg ? .9 : 0, A.ctx.currentTime, .8);
    if (!cfg) return;

    var src = A.ctx.createBufferSource();
    src.buffer = noiseBuffer(4); src.loop = true;
    var flt = A.ctx.createBiquadFilter();
    flt.type = cfg.type; flt.frequency.value = cfg.f; flt.Q.value = cfg.q;
    var g = A.ctx.createGain(); g.gain.value = cfg.g;
    src.connect(flt); flt.connect(g); g.connect(A.busAmb);
    /* 缓慢起伏 */
    var lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
    lfo.frequency.value = .07 + Math.random() * .1; lg.gain.value = cfg.g * .5;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.start();
    A.amb = { src: src, lfo: lfo };
  }

  /* ---------------- BGM：分层环境音乐 ---------------- */
  /* 五声音阶（相对根音的半音数） */
  var PENTA = [0, 2, 4, 7, 9];
  var MOODS = {
    dawn: { root: 62, prog: [0, 5, 3, 4], bpm: 62, bright: 1800, padType: 'triangle' },   // D
    day: { root: 64, prog: [0, 4, 5, 3], bpm: 70, bright: 2400, padType: 'triangle' },    // E
    dusk: { root: 57, prog: [0, 3, 5, 4], bpm: 56, bright: 1300, padType: 'sine' },       // A
    night: { root: 55, prog: [0, 5, 2, 4], bpm: 48, bright: 900, padType: 'sine' }        // G
  };
  var WEATHER_MOOD = { rain: 'night', snow: 'dusk', fog: 'dawn', fireflies: 'night', leaves: 'day', stars: 'night' };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function setMood(mood, weather) {
    if (!init()) return;
    A.mood = MOODS[mood] ? mood : 'dusk';
    if (weather) setWeather(weather);
  }

  function pad(freq, dur, type, bright, vol) {
    var t = A.ctx.currentTime;
    var o1 = A.ctx.createOscillator(), o2 = A.ctx.createOscillator();
    var g = A.ctx.createGain(), f = A.ctx.createBiquadFilter();
    o1.type = type; o2.type = type;
    o1.frequency.value = freq; o2.frequency.value = freq * 1.005;
    f.type = 'lowpass'; f.frequency.value = bright; f.Q.value = .6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * .35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    /* 滤波缓慢开合 */
    var lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
    lfo.frequency.value = .05 + Math.random() * .08; lg.gain.value = bright * .35;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start(t); lfo.stop(t + dur);

    o1.connect(f); o2.connect(f); f.connect(g); g.connect(A.busMusic);
    o1.start(t); o2.start(t); o1.stop(t + dur + .1); o2.stop(t + dur + .1);
  }

  function pluck(freq, vol, delay) {
    var t = A.ctx.currentTime + (delay || 0);
    var o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(A.busMusic);
    o.start(t); o.stop(t + 1.2);
  }

  function bass(freq, dur) {
    var t = A.ctx.currentTime;
    var o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(.10, t + .4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.busMusic);
    o.start(t); o.stop(t + dur + .1);
  }

  function tick() {
    if (!A.music || !A.ready) return;
    try {
      var M = MOODS[A.mood] || MOODS.dusk;
      var deg = M.prog[A.chordIdx % M.prog.length];
      var root = M.root + deg - 12;

      if (A.step % 4 === 0) {
        /* 每 4 拍换和弦：三音垫 + 低音 */
        pad(mtof(root + 12), 8.5, M.padType, M.bright, .075);
        pad(mtof(root + 19), 8.5, M.padType, M.bright * .8, .05);
        pad(mtof(root + 24), 8.5, M.padType, M.bright * .9, .04);
        bass(mtof(root - 12), 8.0);
        A.chordIdx++;
      }
      /* 琶音点缀 */
      if (Math.random() < .55) {
        var n = PENTA[(Math.random() * PENTA.length) | 0];
        var oct = (Math.random() < .4 ? 24 : 12);
        pluck(mtof(root + n + oct), .045, Math.random() * .6);
      }
      A.step++;
    } catch (e) { }
  }

  /* 音乐音量：0~1，映射到音乐总线（默认 .68 ≈ 原来的 .34 响度） */
  function mGain() { return .5 * (A.musicVol == null ? .68 : A.musicVol); }
  function setMusicVol(v) {
    v = Math.max(0, Math.min(1, Number(v) || 0));
    A.musicVol = v;
    if (!init()) return;
    if (A.started) A.busMusic.gain.setTargetAtTime((A.music && v > 0) ? mGain() : 0, A.ctx.currentTime, .15);
  }

  function startBGM() {
    if (!init()) return;
    resume();
    if (A.started) { A.busMusic.gain.setTargetAtTime(A.music ? mGain() : 0, A.ctx.currentTime, .5); return; }
    A.started = true;
    A.busMusic.gain.setTargetAtTime(A.music ? mGain() : 0, A.ctx.currentTime, 2.0);
    tick();
    var period = 2400;
    A.timer = setInterval(tick, period);
  }

  function setMusic(on) {
    A.music = on;
    if (!init()) return;
    A.busMusic.gain.setTargetAtTime(on ? mGain() : 0, A.ctx.currentTime, .5);
    if (on) startBGM();
  }
  function setSfx(on) { A.sfxOn = on; }

  /* ---------------- 外部音频文件（可选） ---------------- */
  /* 若在 assets/audio/ 放置 bgm_dawn.mp3 / voice_角色名.mp3 等，会优先播放文件 */
  var fileCache = {};
  function playFile(url, loop, bus) {
    if (!init() || fileCache[url] === false) return null;
    try {
      var el = new Audio(url);
      el.loop = !!loop;
      el.volume = loop ? .5 : .9;
      el.play().then(function () { fileCache[url] = true; }).catch(function () { fileCache[url] = false; });
      return el;
    } catch (e) { fileCache[url] = false; return null; }
  }

  global.Audio2 = {
    init: init, resume: resume,
    startBGM: startBGM, setMusic: setMusic, setSfx: setSfx, setMusicVol: setMusicVol,
    setMood: setMood, setWeather: setWeather,
    sfx: SFX, playFile: playFile,
    state: A
  };
})(window);
