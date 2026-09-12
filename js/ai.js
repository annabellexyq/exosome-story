/* ============================================================
 * ai.js —— 内容生成接入层（窗外信使 · 专属一集）
 * 用「玩家生辰八字 + 一个内容生成 API」实时生成：
 *   · 剧情对话（旁白 / 周怀明 / 温澈 交替）
 *   · 一枚记忆种子 + 科学事实
 *   · 背景画面描述（可选：调用文生图 API 得到背景图）
 *
 * 留空位：未配置 API 时自动降级到本地模板生成，游戏照常运行。
 * 安全提示：纯前端直连会暴露 Key，正式上线请走服务端代理。
 * ============================================================ */
window.EXOAI = (function () {
  'use strict';

  var CFG_KEY = 'exo_ai_cfg_v1';
  var DEFAULT_CFG = {
    baseUrl: '',        // 内容生成 API（OpenAI 兼容），如 https://api.deepseek.com/v1
    apiKey: '',
    model: 'deepseek-chat',
    imgBaseUrl: '',     // 文生图接口（OpenAI 兼容 images/generations，可选）
    imgKey: '',
    imgModel: ''
  };

  var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  var ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  var SX = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

  // 十二「节」（按公历时间顺序）：[月, 日, 月支]，近似到日，够生成使用
  var JIE_LIST = [
    [1, 6, 1], [2, 4, 2], [3, 6, 3], [4, 5, 4], [5, 6, 5], [6, 6, 6],
    [7, 7, 7], [8, 8, 8], [9, 8, 9], [10, 8, 10], [11, 7, 11], [12, 7, 0]
  ];

  /* ---------------- 配置 ---------------- */
  function getConfig() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { raw = null; }
    var c = {};
    for (var k in DEFAULT_CFG) c[k] = (raw && raw[k] != null) ? raw[k] : DEFAULT_CFG[k];
    return c;
  }
  function setConfig(patch) {
    var c = getConfig();
    for (var k in (patch || {})) if (patch[k] != null) c[k] = patch[k];
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { }
    return c;
  }
  function configured() { var c = getConfig(); return !!(c.baseUrl && c.apiKey); }

  /* ---------------- 生辰八字（简化推算） ---------------- */
  function jdn(y, m, d) {
    var a = Math.floor((14 - m) / 12), y2 = y + 4800 - a, m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4)
      - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  }
  function gzIndex(gan, zhi) { for (var s = 0; s < 60; s++) if (s % 10 === gan && s % 12 === zhi) return s; return 0; }

  /** 出生（公历，北京时间）→ 四柱八字（简化：年柱以 2/4 为界，月柱用节的近似日期） */
  function baziFrom(y, m, d, h) {
    var yy = y, mm = m, dd = d;
    if (h >= 23) { var t = new Date(Date.UTC(yy, mm - 1, dd) + 86400000); yy = t.getUTCFullYear(); mm = t.getUTCMonth() + 1; dd = t.getUTCDate(); }

    // 年柱
    var beforeLichun = (mm < 2) || (mm === 2 && dd < 4);
    var yGZ = ((beforeLichun ? yy - 1 : yy) - 4) % 60; if (yGZ < 0) yGZ += 60;
    var yGan = yGZ % 10;

    // 月柱：按公历时间顺序，找最后一个已过的「节」
    var monthZhi = 0; // 默认子月（小寒之前）
    for (var i = 0; i < JIE_LIST.length; i++) {
      var j = JIE_LIST[i];
      if ((mm > j[0]) || (mm === j[0] && dd >= j[1])) monthZhi = j[2];
    }
    var yinGan = (yGan * 2 + 2) % 10;
    var mGan = (yinGan + ((monthZhi - 2 + 12) % 12)) % 10;

    // 日柱
    var dGZ = ((jdn(yy, mm, dd) + 49) % 60 + 60) % 60;
    var dGan = dGZ % 10;

    // 时柱
    var hZhi = Math.floor(((h + 1) % 24) / 2);
    var hGan = ((dGan % 5) * 2 + hZhi) % 10;

    var pillars = [
      GAN[yGZ % 10] + ZHI[yGZ % 12],
      GAN[mGan] + ZHI[monthZhi],
      GAN[dGZ % 10] + ZHI[dGZ % 12],
      GAN[hGan] + ZHI[hZhi]
    ];
    return {
      y: y, m: m, d: d, h: h,
      year: pillars[0], month: pillars[1], day: pillars[2], hour: pillars[3],
      shengxiao: SX[yGZ % 12],
      text: pillars.join(' ')
    };
  }

  /* ---------------- OpenAI 兼容调用 ---------------- */
  async function chat(messages, temperature) {
    var c = getConfig();
    if (!c.baseUrl || !c.apiKey) throw new Error('未配置内容生成 API');
    var res = await fetch(c.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
      body: JSON.stringify({
        model: c.model,
        temperature: (temperature == null ? 0.9 : temperature),
        messages: messages
      })
    });
    if (!res.ok) {
      var t = await res.text().catch(function () { return ''; });
      throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 120));
    }
    var data = await res.json();
    return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  /** 文生图（可选，OpenAI 兼容）：返回图片 URL；未配置 / 失败返回 null */
  async function generateBg(prompt) {
    var c = getConfig();
    if (!c.imgBaseUrl || !c.imgKey || !prompt) return null;
    try {
      var res = await fetch(c.imgBaseUrl.replace(/\/+$/, '') + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.imgKey },
        body: JSON.stringify({ model: c.imgModel || undefined, prompt: prompt, n: 1, size: '1024x1024' })
      });
      if (!res.ok) return null;
      var data = await res.json();
      var d0 = data && data.data && data.data[0];
      if (!d0) return null;
      return d0.url || (d0.b64_json ? ('data:image/png;base64,' + d0.b64_json) : null);
    } catch (e) { return null; }
  }

  /* ---------------- 生成一集 ---------------- */
  function buildPrompt(bz) {
    return [
      '你是互动叙事《窗外信使 · 外泌体与蓝夜》的编剧。',
      '故事：一位老人周怀明把一生拆成十六枚「记忆种子」，交给守在窗边的年轻人温澈；主题是外泌体、记忆与告别，基调安静、克制、温柔。',
      '',
      '请依据下面这位玩家的生辰八字，创作【一集专属番外】：',
      '生辰八字（四柱）：' + bz.text + '（生肖 ' + bz.shengxiao + '，生于 ' + bz.y + '年' + bz.m + '月' + bz.d + '日 ' + bz.h + '时）',
      '',
      '要求：',
      '1. 一集 = 一段窗外氛围 + 8~14 句对话（旁白 / 周怀明 / 温澈 交替）+ 一枚记忆种子。',
      '2. 让季节、天气、光影呼应这个生辰（例如冬生多雪、夜生多星、秋生多雾），并点到「外泌体像一封信」的意象。',
      '3. 只输出一个严格 JSON 对象（不要 markdown 代码块），字段：',
      '{',
      '  "title": "2~6字集名",',
      '  "sub": "第X枚种子 · 一句话主题",',
      '  "season": "spring|summer|autumn|winter",',
      '  "weather": "clear|rain|snow|fog|motes|fireflies|leaves|stars",',
      '  "tod": "dawn|day|dusk|night",',
      '  "motes": 0~10 的整数,',
      '  "bgPrompt": "一句画面描述（用于生成窗外背景）",',
      '  "lines": [ {"w":"旁白|周怀明|温澈","t":"台词"} ],',
      '  "seed": {"name":"2~4字","color":"#rrggbb","fact":"一句关于外泌体的真实科学事实"}',
      '}'
    ].join('\n');
  }

  function parseJson(text) {
    var s = String(text || '').replace(/```json?/gi, '').replace(/```/g, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < 0) throw new Error('返回内容不是 JSON');
    return JSON.parse(s.slice(a, b + 1));
  }

  var ALLOWED_W = { '旁白': 1, '周怀明': 1, '温澈': 1 };
  function normalize(json, bz, bgUrl) {
    var season = ['spring', 'summer', 'autumn', 'winter'].indexOf(json.season) >= 0 ? json.season : 'autumn';
    var weather = ['clear', 'rain', 'snow', 'fog', 'motes', 'fireflies', 'leaves', 'stars'].indexOf(json.weather) >= 0 ? json.weather : 'clear';
    var tod = ['dawn', 'day', 'dusk', 'night'].indexOf(json.tod) >= 0 ? json.tod : 'dusk';
    var motes = (typeof json.motes === 'number') ? Math.max(0, Math.min(10, Math.round(json.motes))) : 4;

    var steps = [];
    var lines = Array.isArray(json.lines) ? json.lines : [];
    lines.forEach(function (ln) {
      var w = String((ln && ln.w) || '旁白').trim();
      var t = String((ln && ln.t) || '').trim();
      if (!t) return;
      if (w === '旁白' || !ALLOWED_W[w]) steps.push({ k: 'narr', t: t });
      else steps.push({ k: 'say', w: w, t: t });
    });
    if (!steps.length) steps.push({ k: 'narr', t: '窗外很静，风把山谷吹得像一封慢慢展开的信。' });

    var seed = json.seed || {};
    steps.push({
      k: 'seed',
      name: String(seed.name || '信').slice(0, 6),
      color: /^#[0-9a-fA-F]{6}$/.test(seed.color || '') ? seed.color : '#8fb6ff',
      fact: String(seed.fact || '外泌体是细胞释放的微小囊泡，像一封封信，把消息从一处送到另一处。')
    });

    return {
      id: 'ai-' + bz.text.replace(/\s/g, '') + '-' + (Date.now() % 100000),
      n: 'AI',
      title: String(json.title || '专属一集').slice(0, 12),
      sub: String(json.sub || ('生于 ' + bz.text)),
      sc: { img: bgUrl || 'assets/bg/ep15.png', tod: tod, weather: weather, season: season, motes: motes },
      steps: steps,
      aiBazi: bz.text,
      source: bgUrl ? 'api+bg' : 'api'
    };
  }

  /** 生成专属一集：优先 API；失败则抛错，由调用方降级 */
  async function generateEpisode(bz) {
    var json = parseJson(await chat([{ role: 'user', content: buildPrompt(bz) }], 0.9));
    var bgUrl = null;
    try { bgUrl = await generateBg(json.bgPrompt); } catch (e) { bgUrl = null; }
    return normalize(json, bz, bgUrl);
  }

  /* ---------------- 本地降级：不联网也能得到一集 ---------------- */
  var FALLBACK = {
    spring: { title: '春信', weather: 'clear', tod: 'dawn', seed: '初绿', color: '#79c2b6', scene: '雾' },
    summer: { title: '夏夜', weather: 'fireflies', tod: 'night', seed: '萤火', color: '#e8d68a', scene: '萤火' },
    autumn: { title: '秋雾', weather: 'fog', tod: 'dusk', seed: '桂香', color: '#d98b8b', scene: '雾' },
    winter: { title: '冬雪', weather: 'snow', tod: 'day', seed: '初雪', color: '#bcd2f0', scene: '雪' }
  };
  function fallbackEpisode(bz) {
    var m = bz.m;
    var season = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'autumn' : 'winter';
    var f = FALLBACK[season];
    var steps = [
      { k: 'narr', t: '窗外的光换了颜色。老人说，每一年的这个时节，都像有人替他把信重新投了一次。' },
      { k: 'say', w: '周怀明', t: '你生于' + bz.year + '年、' + bz.month + '月。这个日子，天是有脾气的。' },
      { k: 'say', w: '温澈', t: '您怎么知道？' },
      { k: 'say', w: '周怀明', t: '八字里写着呢。生辰不同，窗外的景就不同。' },
      { k: 'narr', t: '山谷里浮起薄薄的' + f.scene + '，像谁把一封封信轻轻排开。' },
      { k: 'say', w: '周怀明', t: '外泌体也是这样。它不创造什么，只把一处的消息，送到另一处。' },
      { k: 'say', w: '温澈', t: '那我这一枚，寄给谁？' },
      { k: 'say', w: '周怀明', t: '寄给将来的你。他会需要这封信的。' },
      { k: 'seed', name: f.seed, color: f.color, fact: '外泌体存在于血液、唾液、乳汁等各种体液中——身体里的「信」，一直在流动。' }
    ];
    return {
      id: 'local-' + bz.text.replace(/\s/g, ''),
      n: 'AI',
      title: f.title,
      sub: '生辰专属 · ' + bz.text,
      sc: { img: 'assets/bg/ep15.png', tod: f.tod, weather: f.weather, season: season, motes: 5 },
      steps: steps,
      aiBazi: bz.text,
      source: 'local-fallback'
    };
  }

  /* ---------------- UI 绑定 ---------------- */
  function $(id) { return document.getElementById(id); }

  function updateBaziPreview() {
    var y = +($('aiYear').value || 0), m = +($('aiMonth').value || 0), d = +($('aiDay').value || 0);
    var hv = $('aiHour').value;
    var h = (hv === '' ? NaN : +hv);
    if (!y || !m || !d || isNaN(h) || h < 0 || h > 23) {
      $('aiBazi').textContent = '填好出生时间，这里会显示你的四柱八字';
      return null;
    }
    if (m > 12 || d > 31) { $('aiBazi').textContent = '日期似乎不太对，再看看'; return null; }
    var bz = baziFrom(y, m, d, h);
    $('aiBazi').innerHTML = '你的四柱：<b>' + bz.text + '</b> · 属' + bz.shengxiao;
    return bz;
  }

  function openAiPanel() {
    var ov = document.getElementById('overlay');
    Array.prototype.forEach.call(ov.querySelectorAll('.panel'), function (p) { p.classList.remove('show'); });
    $('panelAI').classList.add('show');
    ov.classList.remove('hidden');
    var c = getConfig();
    if (c.baseUrl) $('aiBaseUrl').value = c.baseUrl;
    if (c.model) $('aiModel').value = c.model;
    if (c.imgBaseUrl) $('aiImgUrl').value = c.imgBaseUrl;
    updateBaziPreview();
  }
  function closeAiPanel() {
    try { $('panelAI').classList.remove('show'); } catch (e) { }
    var ov = document.getElementById('overlay');
    ov.classList.add('hidden');
  }
  function setStatus(t, kind) {
    var el = $('aiStatus');
    if (!el) return;
    el.textContent = t || '';
    el.className = 'ai-status' + (kind ? ' ' + kind : '');
  }

  async function generateAndPlay() {
    var bz = updateBaziPreview();
    if (!bz) { setStatus('请先填好出生年 / 月 / 日 / 时', 'warn'); return; }

    var patch = {
      baseUrl: ($('aiBaseUrl').value || '').trim(),
      model: ($('aiModel').value || '').trim() || 'deepseek-chat',
      imgBaseUrl: ($('aiImgUrl').value || '').trim()
    };
    var key = ($('aiKey').value || '').trim();
    if (key) patch.apiKey = key;
    var imgKey = ($('aiImgKey').value || '').trim();
    if (imgKey) patch.imgKey = imgKey;
    setConfig(patch);
    $('aiKey').value = ''; $('aiImgKey').value = '';

    var ep;
    if (configured()) {
      setStatus('正在实时生成你的专属一集…', '');
      try {
        ep = await generateEpisode(bz);
        setStatus('生成完成 · 由内容生成 API 实时产出', 'ok');
      } catch (e) {
        setStatus('API 生成失败，已降级本地生成：' + (e && e.message ? e.message : e), 'warn');
        ep = fallbackEpisode(bz);
      }
    } else {
      setStatus('未配置 API · 使用本地生成', '');
      ep = fallbackEpisode(bz);
    }
    if (!ep) { setStatus('生成失败，请重试', 'warn'); return; }
    closeAiPanel();
    if (window.EXO_STORY && window.EXO_STORY.playEpisode) {
      window.EXO_STORY.playEpisode(ep);
    } else {
      setStatus('剧情引擎未就绪（EXO_STORY 缺失）', 'warn');
    }
  }

  function initUI() {
    var btn = $('btnAIStory');
    if (btn) btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); openAiPanel();
    });
    var gen = $('aiGen'); if (gen) gen.addEventListener('click', generateAndPlay);
    var cancel = $('aiCancel'); if (cancel) cancel.addEventListener('click', closeAiPanel);
    ['aiYear', 'aiMonth', 'aiDay', 'aiHour'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('input', updateBaziPreview);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();

  return {
    getConfig: getConfig, setConfig: setConfig, configured: configured,
    baziFrom: baziFrom, generateEpisode: generateEpisode, fallbackEpisode: fallbackEpisode
  };
})();
