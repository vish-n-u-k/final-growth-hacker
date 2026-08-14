/* fb-widget.js — GrowJin in-app bug reporting widget
 * Triggers: 2s long press OR Ctrl+Shift+B
 * Manual:   window._fbTriggerManual()
 * User ctx: window._fbGetUser = () => ({ id, name, email })
 */
(function () {
  'use strict';

  if (/^\/(login|signup)(\/|$)/.test(window.location.pathname)) return;

  var API = '/api/bug-reports';
  var dpr = window.devicePixelRatio || 1;

  var _images   = [];
  var _activeIdx = 0;
  var _baseImg   = null;
  var _tags      = [];
  var _h2cReady  = false;
  var _h2cLoading = false;

  // ── html2canvas ────────────────────────────────────────────────────────────

  function _loadH2C(cb) {
    if (_h2cReady) { if (cb) cb(); return; }
    if (_h2cLoading) { var t = setInterval(function () { if (_h2cReady) { clearInterval(t); if (cb) cb(); } }, 100); return; }
    _h2cLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = function () { _h2cReady = true; _h2cLoading = false; if (cb) cb(); };
    document.head.appendChild(s);
  }

  // Pre-load after idle
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(function () { _loadH2C(); });
  } else {
    setTimeout(function () { _loadH2C(); }, 2000);
  }

  // ── Long press (mousedown) ─────────────────────────────────────────────────

  var _pressTimer = null;
  var _pressX = 0;
  var _pressY = 0;
  var HOLD_MS = 2000;
  var MOVE_PX = 12;

  var _INTERACTIVE = 'a,button,input,textarea,select,label,[role="button"],[role="tab"],[role="menuitem"]';

  function _onMousedown(e) {
    if (e.button !== 0) return;
    if (e.target.closest(_INTERACTIVE)) return;
    // Don't start if inside the sheet
    if (e.target.closest('#_fbSheet')) return;
    _pressX = e.clientX;
    _pressY = e.clientY;
    _pressTimer = setTimeout(function () { _trigger(); }, HOLD_MS);
  }

  function _onMousemove(e) {
    if (!_pressTimer) return;
    if (Math.hypot(e.clientX - _pressX, e.clientY - _pressY) > MOVE_PX) _cancelPress();
  }

  function _cancelPress() {
    clearTimeout(_pressTimer);
    _pressTimer = null;
  }

  document.addEventListener('mousedown',  _onMousedown, true);
  document.addEventListener('mousemove',  _onMousemove, true);
  document.addEventListener('mouseup',    _cancelPress, true);
  document.addEventListener('mouseleave', _cancelPress, true);
  document.addEventListener('contextmenu', _cancelPress, true);

  // ── Ctrl+Shift+B ──────────────────────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      e.preventDefault();
      _trigger();
    }
  }, true);

  // ── Screenshot + open ──────────────────────────────────────────────────────

  function _trigger() {
    _cancelPress();
    // Open sheet immediately so user sees something
    _openSheet(null, true); // true = capturing state
    // Load h2c and capture in background
    _loadH2C(function () { _captureIntoOpenSheet(); });
  }

  async function _captureIntoOpenSheet() {
    var sheet = document.getElementById('_fbSheet');
    if (!sheet || sheet.style.display === 'none') return;

    var dataUrl = null;
    try {
      var opts = {
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: function (el) { return el.id === '_fbSheet'; },
      };

      var dominantCanvas = Array.from(document.querySelectorAll('canvas')).find(function (c) {
        var r = c.getBoundingClientRect();
        return r.width > window.innerWidth * 0.3 && r.height > window.innerHeight * 0.3;
      });

      if (dominantCanvas) {
        var out = document.createElement('canvas');
        out.width  = window.innerWidth  * dpr;
        out.height = window.innerHeight * dpr;
        var ctx = out.getContext('2d');
        var shot = await html2canvas(document.body, Object.assign({}, opts, {
          ignoreElements: function (el) { return el.tagName === 'CANVAS' || el.id === '_fbSheet'; },
        }));
        ctx.drawImage(shot, 0, 0, out.width, out.height);
        var rect = dominantCanvas.getBoundingClientRect();
        ctx.drawImage(dominantCanvas, rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr);
        dataUrl = out.toDataURL('image/jpeg', 0.85);
      } else {
        var shot2 = await html2canvas(document.body, opts);
        dataUrl = shot2.toDataURL('image/jpeg', 0.85);
      }
    } catch (err) {
      console.warn('[fb-widget] screenshot error:', err);
    }

    if (!dataUrl) return;
    // Inject screenshot into already-open sheet
    _images = [{ dataUrl: dataUrl, paths: [] }];
    _activeIdx = 0;
    _baseImg = null;
    var s = document.getElementById('_fbSheet');
    if (s && s.style.display !== 'none') {
      _renderThumbs(s);
      _renderCanvas(s);
    }
  }

  // ── Sheet ──────────────────────────────────────────────────────────────────

  function _openSheet(screenshotDataUrl) {
    _images    = screenshotDataUrl ? [{ dataUrl: screenshotDataUrl, paths: [] }] : [];
    _activeIdx = 0;
    _baseImg   = null;
    _tags      = [];

    var sheet = document.getElementById('_fbSheet');
    if (!sheet) { sheet = _buildSheet(); document.body.appendChild(sheet); }

    sheet.querySelector('#_fbRemarks').value    = '';
    sheet.querySelector('#_fbTagInput').value   = '';
    sheet.querySelector('#_fbTagList').innerHTML = '';
    sheet.querySelector('#_fbStatus').textContent = '';
    sheet.querySelector('#_fbSubmit').disabled  = false;
    sheet.querySelectorAll('.fb-sev').forEach(function (b, i) { _sevStyle(b, i === 0); });

    _renderThumbs(sheet);
    _renderCanvas(sheet);
    sheet.style.display = 'flex';
  }

  function _closeSheet() {
    var s = document.getElementById('_fbSheet');
    if (s) s.style.display = 'none';
  }

  function _sevStyle(btn, active) {
    btn.classList.toggle('active', active);
    btn.style.background  = active ? '#2fbf71' : '#0a1410';
    btn.style.borderColor = active ? '#2fbf71' : '#1e3a30';
    btn.style.color       = active ? '#0a1410' : '#8aa897';
    btn.style.fontWeight  = active ? '600'     : '400';
  }

  function _buildSheet() {
    var el = document.createElement('div');
    el.id = '_fbSheet';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483647;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55)';

    el.innerHTML = [
      '<style>',
      '#_fbPanel{width:min(640px,100vw);max-height:85vh;overflow-y:auto;',
      'background:#122620;border-radius:12px 12px 0 0;padding:16px;',
      'box-shadow:0 -4px 32px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:12px}',
      '#_fbCanvas{width:100%;border-radius:8px;background:#0a1410;cursor:crosshair;touch-action:none;display:none}',
      '.fb-thumb{width:52px;height:40px;object-fit:cover;border-radius:4px;',
      'border:2px solid transparent;cursor:pointer;flex-shrink:0}',
      '.fb-thumb.active{border-color:#2fbf71}',
      '#_fbRemarks{width:100%;box-sizing:border-box;background:#0a1410;border:1px solid #1e3a30;',
      'border-radius:6px;color:#e8f3ec;font:14px system-ui,sans-serif;padding:8px;resize:vertical;min-height:100px}',
      '.fb-sev{border-radius:20px;padding:4px 12px;cursor:pointer;',
      'font:12px system-ui,sans-serif;border-style:solid;border-width:1px}',
      '#_fbSubmit{background:#2fbf71;color:#0a1410;border:none;border-radius:6px;',
      'padding:10px;font:600 14px system-ui,sans-serif;cursor:pointer;width:100%}',
      '#_fbSubmit:disabled{opacity:.5;cursor:not-allowed}',
      '</style>',
      '<div id="_fbPanel">',
      '<div style="display:flex;justify-content:space-between;align-items:center">',
      '<span style="font:600 15px system-ui,sans-serif;color:#e8f3ec">Report a Bug</span>',
      '<span style="font:12px system-ui,sans-serif;color:#4d7a66">Hold 2s or Ctrl+Shift+B</span>',
      '<button id="_fbClose" style="background:none;border:none;color:#8aa897;font-size:20px;cursor:pointer;line-height:1">&#x2715;</button>',
      '</div>',
      '<div style="display:flex;flex-direction:column;gap:8px">',
      '<canvas id="_fbCanvas"></canvas>',
      '<div style="display:flex;align-items:center;gap:8px;overflow-x:auto;padding:2px 0">',
      '<div id="_fbThumbs" style="display:flex;gap:6px"></div>',
      '<label style="font:12px system-ui,sans-serif;color:#8aa897;background:#0a1410;',
      'border:1px dashed #2fbf71;border-radius:4px;padding:4px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0">',
      '+ Add image<input type="file" id="_fbFile" accept="image/*" style="display:none">',
      '</label>',
      '</div>',
      '</div>',
      '<textarea id="_fbRemarks" placeholder="Describe the issue\u2026" rows="3"></textarea>',
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">',
      '<span style="font:11px system-ui,sans-serif;color:#4d7a66;text-transform:uppercase;letter-spacing:.04em">Type</span>',
      '<button class="fb-sev" data-sev="bug">Bug</button>',
      '<button class="fb-sev" data-sev="suggestion">Suggestion</button>',
      '<button class="fb-sev" data-sev="question">Question</button>',
      '</div>',
      '<div>',
      '<div id="_fbTagList" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px"></div>',
      '<div style="display:flex;gap:6px">',
      '<input id="_fbTagInput" type="text" placeholder="Add tag\u2026 (Enter to add)"',
      ' style="flex:1;background:#0a1410;border:1px solid #1e3a30;border-radius:6px;',
      'color:#e8f3ec;font:13px system-ui,sans-serif;padding:6px 10px;outline:none">',
      '<button id="_fbTagAdd" style="background:#1e3a30;border:none;border-radius:6px;',
      'color:#2fbf71;font:13px system-ui,sans-serif;padding:6px 12px;cursor:pointer">+ Add</button>',
      '</div>',
      '</div>',
      '<button id="_fbSubmit">Submit</button>',
      '<div id="_fbStatus" style="font:13px system-ui,sans-serif;color:#8aa897;text-align:center;min-height:16px"></div>',
      '</div>',
    ].join('');

    el.addEventListener('click', function (e) { if (e.target === el) _closeSheet(); });
    el.querySelector('#_fbClose').addEventListener('click', _closeSheet);

    el.querySelectorAll('.fb-sev').forEach(function (btn) {
      btn.addEventListener('click', function () {
        el.querySelectorAll('.fb-sev').forEach(function (b) { _sevStyle(b, false); });
        _sevStyle(btn, true);
      });
    });

    el.querySelector('#_fbFile').addEventListener('change', function (e) {
      if (e.target.files[0]) _readFile(e.target.files[0], el);
      e.target.value = '';
    });

    document.addEventListener('paste', function (e) {
      if (el.style.display === 'none') return;
      var item = Array.from((e.clipboardData || { items: [] }).items)
        .find(function (i) { return i.type.startsWith('image/'); });
      if (item) _readFile(item.getAsFile(), el);
    });

    var tagInput = el.querySelector('#_fbTagInput');
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _addTag(tagInput, el); }
    });
    el.querySelector('#_fbTagAdd').addEventListener('click', function () { _addTag(tagInput, el); });

    _initDrawing(el);
    el.querySelector('#_fbSubmit').addEventListener('click', function () { _submit(el); });

    return el;
  }

  // ── Tags ───────────────────────────────────────────────────────────────────

  function _addTag(input, sheet) {
    var val = input.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!val || _tags.indexOf(val) !== -1) { input.value = ''; return; }
    _tags.push(val);
    _renderTags(sheet);
    input.value = '';
  }

  function _renderTags(sheet) {
    var list = sheet.querySelector('#_fbTagList');
    list.innerHTML = '';
    _tags.forEach(function (tag) {
      var pill = document.createElement('span');
      pill.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#1e3a30;color:#2fbf71;border:1px solid #2a5040;border-radius:20px;padding:2px 10px;font:12px system-ui,sans-serif';
      pill.appendChild(document.createTextNode(tag));
      var rm = document.createElement('button');
      rm.textContent = '\xD7';
      rm.style.cssText = 'background:none;border:none;color:#2fbf71;cursor:pointer;padding:0;font-size:14px;line-height:1;margin-left:2px';
      rm.addEventListener('click', function () {
        _tags = _tags.filter(function (t) { return t !== tag; });
        _renderTags(sheet);
      });
      pill.appendChild(rm);
      list.appendChild(pill);
    });
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  function _readFile(file, sheet) {
    var reader = new FileReader();
    reader.onload = function (e) {
      _images.push({ dataUrl: e.target.result, paths: [] });
      _activeIdx = _images.length - 1;
      _renderThumbs(sheet);
      _renderCanvas(sheet);
    };
    reader.readAsDataURL(file);
  }

  function _renderThumbs(sheet) {
    var thumbs = sheet.querySelector('#_fbThumbs');
    thumbs.innerHTML = '';
    _images.forEach(function (img, i) {
      var el = document.createElement('img');
      el.src = img.dataUrl;
      el.className = 'fb-thumb' + (i === _activeIdx ? ' active' : '');
      el.addEventListener('click', function () {
        _activeIdx = i;
        _renderThumbs(sheet);
        _renderCanvas(sheet);
      });
      thumbs.appendChild(el);
    });
  }

  function _renderCanvas(sheet) {
    var c = sheet.querySelector('#_fbCanvas');
    if (_images.length === 0) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    var img = new Image();
    img.onload = function () {
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      _baseImg = img;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      _drawPaths(ctx, _images[_activeIdx].paths);
    };
    img.src = _images[_activeIdx].dataUrl;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function _drawPaths(ctx, paths) {
    paths.forEach(function (path) {
      if (path.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 3;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      path.forEach(function (pt, i) { i === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]); });
      ctx.stroke();
    });
  }

  function _initDrawing(sheet) {
    var c = sheet.querySelector('#_fbCanvas');
    var drawing = false, cur = [];

    function pos(e) {
      var r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
    }

    c.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      drawing = true; cur = [pos(e)];
      c.setPointerCapture(e.pointerId); e.preventDefault();
    });
    c.addEventListener('pointermove', function (e) {
      if (!drawing || !_baseImg) return;
      cur.push(pos(e));
      var ctx = c.getContext('2d');
      ctx.drawImage(_baseImg, 0, 0);
      _drawPaths(ctx, _images[_activeIdx].paths);
      if (cur.length > 1) {
        ctx.beginPath(); ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 3;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        cur.forEach(function (pt, i) { i === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]); });
        ctx.stroke();
      }
      e.preventDefault();
    });
    c.addEventListener('pointerup', function (e) {
      if (!drawing) return;
      drawing = false;
      if (cur.length > 1) _images[_activeIdx].paths.push(cur.slice());
      cur = []; e.preventDefault();
    });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  function _renderAnnotated(imgObj) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        _drawPaths(ctx, imgObj.paths);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = imgObj.dataUrl;
    });
  }

  async function _submit(sheet) {
    var remarks = sheet.querySelector('#_fbRemarks').value.trim();
    if (!remarks) { sheet.querySelector('#_fbStatus').textContent = 'Please describe the issue.'; return; }

    var sevEl = sheet.querySelector('.fb-sev.active');
    var btn = sheet.querySelector('#_fbSubmit');
    var statusEl = sheet.querySelector('#_fbStatus');
    btn.disabled = true;
    statusEl.textContent = 'Submitting\u2026';

    var annotated = await Promise.all(_images.map(_renderAnnotated));
    var user = (typeof window._fbGetUser === 'function') ? (window._fbGetUser() || {}) : {};

    try {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remarks: remarks,
          severity: sevEl ? sevEl.dataset.sev : 'bug',
          tags: _tags.slice(),
          page_url: location.href,
          page_title: document.title,
          user_id: user.id || null,
          user_name: user.name || null,
          user_email: user.email || null,
          device_info: {
            ua: navigator.userAgent,
            screen: screen.width + '\xD7' + screen.height,
            viewport: innerWidth + '\xD7' + innerHeight,
            dpr: devicePixelRatio,
          },
          screenshot: annotated[0] || null,
          extra_images: annotated.slice(1),
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      statusEl.textContent = 'Submitted. Thank you.';
      setTimeout(_closeSheet, 1200);
    } catch (e) {
      statusEl.textContent = 'Failed to submit. Please try again.';
      btn.disabled = false;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window._fbTriggerManual = function () { _trigger(); };

})();
