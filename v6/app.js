(function () {
  'use strict';

  // ============================================================
  //  CONFIG - Kartenfarbe und Palette hier zentral aenderbar
  // ============================================================
  var COLORS = {
    card:  '#7C1D25',  // Weinrot: Wortmarke, Name, Akzente
    cardDeep: '#571218',  // tiefes Weinrot (Akzente)
    cream: '#F6F1E8',  // Kartenfront + Innenseiten + Player-Karte (Max 12:09: Karte hell, Creme)
    blue:  '#22306E',  // Tiefblau: Schrift, UI
    pink:  '#EBC7D2',  // Akzent
    ink:   '#7C1D25'   // Empfaengername (Live-Textebene, CSS): Weinrot auf Creme
  };

  // ---------- Konstanten ----------
  // ---------- Oeffnungs-Choreografie ----------
  // Oeffnung 1:1 aus v3 (Max 12:09: NUR die Oeffnung aus v3, exakt kopiert):
  // beide Fluegel synchron, easeInOutCubic, 1700ms, kein Hold, kein Desync.
  // Alles NACH der Oeffnung bleibt der abgenommene v4-Flow (Flug, Player, Schnee, Ton).
  var OPEN_MS = 1950;   // Max 14:00: v3-Oeffnung war etwas zu schnell (+15%)
  // ---------- FLUG-VIDEO (Asset-Slot) ----------
  // Max' KI-Flugvideo kommt als 2-flug.mp4 in diesen Ordner - nur Datei tauschen, kein Code-Eingriff.
  // Solange es fehlt, laeuft das Paris-Standbild (scene.jpg) als Platzhalter.
  var VIDEO_SRC = '2-flug.mp4';
  var PLACEHOLDER_MS = 6000;   // Standbild-Dauer bis die Player-Karte landet
  // ---------- SCHNEE-ENDSZENE (Max-Wunsch) ----------
  // Flocken sammeln sich auf der Oberkante des Players; ab Schwellhoehe kippt ein Klumpen ab.
  var SNOW = {
    enabled: true,              // CONFIG-Schalter: Schnee-Endszene an/aus
    flakesDesktop: 130,         // max. gleichzeitige Flocken (Desktop)
    flakesMobile: 60,           // mobil begrenzt
    capMax: 16,                 // Hauben-Hoehe in px, ab der ein Klumpen abkippt
    clumpMin: 9                 // Mindest-Haubenhoehe fuer natuerliches Abkippen
  };
  var OPEN_ANGLE = 2.96;  // ~170 Grad
  var CARD_W = 905, CARD_H = 1600;
  var THICK = 0.055;      // Materialstaerke der Karte (v3-Wert)

  // ---------- URL-Parameter ----------
  var qs = new URLSearchParams(location.search);
  var recipient = (qs.get('name') || 'Julia').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Julia';
  var debugState = qs.get('state');
  var snowForce = qs.get('snowforce') === '1';   // Debug: Schnee auch bei verstecktem Tab (Cloud-Test)
  var debugT = qs.has('t') ? parseFloat(qs.get('t')) : null;

  // ---------- DOM ----------
  var stage = document.getElementById('stage');
  var glCanvas = document.getElementById('gl');
  var fallback = document.getElementById('fallback');
  var sceneImg = document.getElementById('sceneImg');
  var sceneEl = document.getElementById('scene');
  var flightVideo = document.getElementById('flight');
  var snowFxCv = document.getElementById('snowFx');
  var cardname = document.getElementById('cardname');
  var cardnameText = document.getElementById('cardnameText');
  var veil = document.getElementById('veil');
  var taplayer = document.getElementById('taplayer');
  var hint = document.getElementById('hint');
  var cardWrap = document.getElementById('cardWrap');
  var card = document.getElementById('card');
  var audio = document.getElementById('audio');
  var playBtn = document.getElementById('playBtn');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var muteBtn = document.getElementById('muteBtn');
  var iconVol = document.getElementById('iconVol');
  var iconMute = document.getElementById('iconMute');
  var track = document.getElementById('track');
  var fill = document.getElementById('fill');
  var tCur = document.getElementById('tCur');
  var tDur = document.getElementById('tDur');
  var replayBtn = document.getElementById('replayBtn');

  var phase = 'boot'; // closed -> opening -> flight -> landing -> player
  var audioTimer = null;
  var flightTimer = null;
  var seeking = false;
  var HINT_DEFAULT = 'Tippen zum Öffnen';

  function fmt(t) {
    if (!isFinite(t) || t < 0) return '0:00';
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  // cubic-bezier-Looper (wie CSS): Stuetzstellen v2: 14->0, 30->19, 46->32, 62->58, 78->77, 90->89
  function cubicBezier(x1, y1, x2, y2) {
    function bx(t) { var u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; }
    function by(t) { var u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t; }
    function dBx(t) { var u = 1 - t; return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2); }
    return function (x) {
      if (x <= 0) return by(0);
      if (x >= 1) return by(1);
      var t = x;
      for (var i = 0; i < 6; i++) {
        var e = bx(t) - x;
        var d = dBx(t);
        if (Math.abs(d) < 1e-4) break;
        t -= e / d;
        if (t < 0) t = 0; else if (t > 1) t = 1;
      }
      if (Math.abs(bx(t) - x) > 1e-4) {
        var lo = 0, hi = 1;
        for (var j = 0; j < 32; j++) {
          t = (lo + hi) / 2;
          if (bx(t) < x) lo = t; else hi = t;
        }
      }
      return by(t);
    };
  }
  function openEase(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }  // v3: easeInOutCubic
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  function setHint(text, loading) {
    hint.textContent = text;
    hint.classList.toggle('is-loading', !!loading);
  }

  // ============================================================
  //  Texturen: Motiv + Farben aus CONFIG, Name zur Laufzeit eingebrannt
  // ============================================================
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = rej;
      im.src = src;
    });
  }
  function loadFonts() {
    var f = new FontFace('Jost', 'url(fonts/jost-var.woff2)', { weight: '100 900' });
    document.fonts.add(f);
    return f.load();
  }

  // Gleichmaessiges Papierkorn, damit gebackener Text wie Druck wirkt
  var grainPat = null;
  function makeGrain(ctx) {
    var g = document.createElement('canvas');
    g.width = 128; g.height = 128;
    var gc = g.getContext('2d');
    var id = gc.createImageData(128, 128);
    for (var i = 0; i < id.data.length; i += 4) {
      var v = 118 + Math.random() * 20;
      id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v; id.data[i + 3] = 26;   // v3-Kornstaerke
    }
    gc.putImageData(id, 0, 0);
    grainPat = ctx.createPattern(g, 'repeat');
  }

  function drawSpaced(ctx, text, cx, y, spacing) {
    var chars = text.split('');
    var widths = chars.map(function (c) { return ctx.measureText(c).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (chars.length - 1);
    var x = cx - total / 2;
    chars.forEach(function (c, i) {
      ctx.fillText(c, x, y);
      x += widths[i] + spacing;
    });
  }

  // Grossflaechiges Papier-Mottling (Low-Frequency), wie v2-Embossing
  function mottle(ctx, w, h) {
    for (var i = 0; i < 14; i++) {
      var x = Math.random() * w, y = Math.random() * h;
      var r = (0.25 + Math.random() * 0.45) * Math.max(w, h);
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      var dark = Math.random() < 0.5;
      var a = 0.03 + Math.random() * 0.035;
      g.addColorStop(0, dark ? 'rgba(0,0,0,' + a.toFixed(3) + ')' : 'rgba(255,255,255,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Eckenradius ~2,5% der Kartenbreite in die Textur einbrennen (Material: alphaTest)
  function roundCorners(ctx, w, h) {
    var r = Math.round(w * 0.025);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
    else {
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
    }
    ctx.fillStyle = '#000';  // deckkraftvolle Maske: destination-in nutzt nur deren Alpha
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Eckenradius ~2,5% der Kartenbreite in die Textur einbrennen (Material: alphaTest)
  function roundCorners(ctx, w, h) {
    var r = Math.round(w * 0.025);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
    else {
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
    }
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Vorderseite: Creme-Artwork mit eingebackenem Mittelfalz + Korn (card-front.jpg).
  // Mechanik 1:1 aus v3: Artwork zeichnen, Papierkorn drueber. Kein Empfaengername
  // im Bild - der Name ist eine Live-Textebene im DOM (gilt fuer alle Empfaenger).
  function bakeFront(img, name) {
    var S = 2;
    var cv = document.createElement('canvas');
    cv.width = CARD_W * S; cv.height = CARD_H * S;
    var ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    if (!grainPat) makeGrain(ctx);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
    roundCorners(ctx, cv.width, cv.height);   // Ecken wie echte Grusskarte (Max 14:13)

    // Druck als eine durchgehende Ebene (Max 14:20: "ganz normal am Stueck"):
    // kein Versetzen, keine Luecke, kein Crossfade. Die Ebene wird exakt am
    // Falz geschnitten - wie echter Druck auf einer echten Klappkarte.
    var tl = bakeTextLayer(img, name, 0);
    return { art: cv, textSteps: [tl.cv], textDMax: 0 };
  }

  // Buchstaben-Layout: optional rueckt der Buchstabe, den der Falz schneiden
  // wuerde, komplett auf die Seite, auf der sein Zentrum liegt; alle Buchstaben
  // auf dieser Seite ruecken mit. Kein zerrissener Buchstabe, nur ein schmaler
  // Zwischenraum genau am Falz.
  function layoutText(ctx, text, cx, spacing, foldX, margin, frac) {
    var chars = text.split('');
    var ws = chars.map(function (ch) { return ctx.measureText(ch).width; });
    var total = ws.reduce(function (a, b) { return a + b; }, 0) + spacing * (chars.length - 1);
    var x = cx - total / 2, pos = [], i, j;
    for (i = 0; i < chars.length; i++) { pos.push({ ch: chars[i], x: x, w: ws[i] }); x += ws[i] + spacing; }
    var d = 0;
    for (i = 0; i < pos.length; i++) {
      var g = pos[i];
      if (foldX > g.x + 0.5 && foldX < g.x + g.w - 0.5) {
        if (g.x + g.w / 2 <= foldX) {
          d = (g.x + g.w) - (foldX - margin);
          for (j = 0; j <= i; j++) pos[j].x -= d * frac;
        } else {
          d = (foldX + margin) - g.x;
          for (j = i; j < pos.length; j++) pos[j].x += d * frac;
        }
        break;
      }
    }
    return { pos: pos, d: d };
  }

  // Druckebene (transparent, nur Text) mit dem v3-Print-Finish: Weinrot,
  // Artwork weich in die Buchstaben gemischt, auf Textform geschnitten.
  function bakeTextLayer(img, name, frac) {
    var S = 2;
    var foldX = CARD_W * S / 2;
    var tCv = document.createElement('canvas');
    tCv.width = CARD_W * S; tCv.height = CARD_H * S;
    var tCtx = tCv.getContext('2d');
    tCtx.fillStyle = '#7C1D25';
    tCtx.textAlign = 'left';
    tCtx.textBaseline = 'alphabetic';

    var fuerSize = 26 * S, fuerSpacing = 8 * S;
    var etSize = 20 * S, etSpacing = 9 * S;
    var label = name.toUpperCase();
    var size = 79 * S;
    var maxW = tCv.width * 0.78;

    var items = [];
    var dMax = 0, ly;
    tCtx.font = '500 ' + fuerSize + 'px Jost';
    ly = layoutText(tCtx, 'FÜR', foldX, fuerSpacing, foldX, 5 * S, frac);
    items.push({ font: tCtx.font, pos: ly.pos, y: 738 * S }); dMax = Math.max(dMax, ly.d);
    tCtx.font = '600 ' + size + 'px Jost';
    var probe = label.split('').map(function (ch) { return tCtx.measureText(ch).width; });
    var probeTotal = probe.reduce(function (a, b) { return a + b; }, 0);
    while (probeTotal > maxW && size > 16 * S) {
      size -= 2 * S;
      tCtx.font = '600 ' + size + 'px Jost';
      probe = label.split('').map(function (ch) { return tCtx.measureText(ch).width; });
      probeTotal = probe.reduce(function (a, b) { return a + b; }, 0);
    }
    ly = layoutText(tCtx, label, foldX, 0, foldX, 6 * S, frac);
    items.push({ font: tCtx.font, pos: ly.pos, y: 847 * S }); dMax = Math.max(dMax, ly.d);
    tCtx.font = '500 ' + etSize + 'px Jost';
    ly = layoutText(tCtx, 'ECHOTAG', foldX, etSpacing, foldX, 4 * S, frac);
    items.push({ font: tCtx.font, pos: ly.pos, y: 1536 * S }); dMax = Math.max(dMax, ly.d);

    items.forEach(function (it) {
      tCtx.font = it.font;
      it.pos.forEach(function (g) { tCtx.fillText(g.ch, g.x, it.y); });
    });

    // Papier weich in die Buchstaben holen, dann auf die Textform schneiden
    tCtx.globalCompositeOperation = 'soft-light';
    tCtx.globalAlpha = 0.55;
    tCtx.drawImage(img, 0, 0, tCv.width, tCv.height);
    tCtx.globalAlpha = 1;
    var mCv = document.createElement('canvas');
    mCv.width = tCv.width; mCv.height = tCv.height;
    var mCtx = mCv.getContext('2d');
    mCtx.fillStyle = '#000';
    mCtx.textAlign = 'left';
    mCtx.textBaseline = 'alphabetic';
    items.forEach(function (it) {
      mCtx.font = it.font;
      it.pos.forEach(function (g) { mCtx.fillText(g.ch, g.x, it.y); });
    });
    tCtx.globalCompositeOperation = 'destination-in';
    tCtx.drawImage(mCv, 0, 0);
    tCtx.globalCompositeOperation = 'source-over';
    return { cv: tCv, dMax: dMax };
  }

  // Innenseiten: Creme-Papier, Artwork-Korn scheint durch (v3-Mechanik, EchoTag-Creme)
  function bakeBack(img) {
    var S = 1;
    var cv = document.createElement('canvas');
    cv.width = CARD_W * S; cv.height = CARD_H * S;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!grainPat) makeGrain(ctx);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
    roundCorners(ctx, cv.width, cv.height);
    return cv;
  }

  // Streifen aus der gebackenen Vorderseite fuer die Kanten: Druck laeuft um die Ecke (v3)
  function edgeStrip(cv, sx, sy, sw, sh, dw, dh, tone) {
    var c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    var x = c.getContext('2d');
    x.drawImage(cv, sx, sy, sw, sh, 0, 0, dw, dh);
    // Schnittkante matter machen: abgedunkelt + Papierkorn wie Karton
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = tone || 'rgb(224,224,224)';
    x.fillRect(0, 0, dw, dh);
    x.globalCompositeOperation = 'source-over';
    if (grainPat) {
      x.globalAlpha = 0.7;
      x.fillStyle = grainPat;
      x.fillRect(0, 0, dw, dh);
      x.globalAlpha = 1;
    }
    return c;
  }

  // Fallback, falls card-front.jpg nicht laedt: schlichte Creme-Front mit Wortmarke + Name
  function bakeFrontFallback(name) {
    var cv = document.createElement('canvas');
    cv.width = CARD_W; cv.height = CARD_H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = COLORS.card;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 20px Jost';
    drawSpaced(ctx, 'ECHOTAG', cv.width / 2, cv.height - 64, 9);
    ctx.font = '500 26px Jost';
    drawSpaced(ctx, 'FÜR', cv.width / 2, 738, 8);
    ctx.font = '600 79px Jost';
    ctx.fillText(name.toUpperCase(), (cv.width - ctx.measureText(name.toUpperCase()).width) / 2, 847);
    return cv;
  }

  // ============================================================
  //  3D-Gatefold
  // ============================================================
  var renderer = null, scene, camera, cardGroup, pivL, pivR, blobShadow, textMats, shadowL, shadowR;
  var halfW, cardH = 3.3, z0 = 8;
  var rafId = null, lastFrame = 0;
  var swayOn = true, swayT = 0;
  var tapTime = 0, swayRotY = 0, swayRotX = 0;
  var openStart = 0, frozenP = null;

  function initGL(front, backCanvas) {
    var frontCanvas = front.art || front;   // Fallback-Pfad liefert nur eine Flaeche
    var ctxTries = 0;
    while (ctxTries < 3) {
      try {
        renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true });
        break;
      } catch (e) {
        // Manche Browser-Umgebungen belegen den Canvas vorab mit einem 2D-Context;
        // dann hilft nur ein frisches Element, Retry lohnt nicht auf demselben.
        ctxTries++;
        if (ctxTries >= 3) return false;
        var fresh = glCanvas.cloneNode(false);
        glCanvas.parentNode.replaceChild(fresh, glCanvas);
        glCanvas = fresh;
      }
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

    var hemi = new THREE.HemisphereLight(0xfff8f0, 0xdcc9c2, 0.42);   // v3
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xffffff, 0.6);   // v3
    key.position.set(-2.4, 3.4, 5.2);
    scene.add(key);
    var fillLight = new THREE.DirectionalLight(0xfff0e6, 0.1);   // v3-Intensitaet, warm
    fillLight.position.set(3, -1.5, 4);
    scene.add(fillLight);

    // Weicher Ambient-Schatten hinter der Karte
    var shCv = document.createElement('canvas');
    shCv.width = 256; shCv.height = 256;
    var shCtx = shCv.getContext('2d');
    var grad = shCtx.createRadialGradient(128, 128, 10, 128, 128, 126);
    grad.addColorStop(0, 'rgba(10,16,44,0.34)');
    grad.addColorStop(0.55, 'rgba(10,16,44,0.16)');
    grad.addColorStop(1, 'rgba(10,16,44,0)');
    shCtx.fillStyle = grad;
    shCtx.fillRect(0, 0, 256, 256);
    var shTex = new THREE.CanvasTexture(shCv);
    blobShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })
    );
    scene.add(blobShadow);

    cardGroup = new THREE.Group();
    scene.add(cardGroup);

    halfW = (cardH * (CARD_W / CARD_H)) / 2;

    var frontTex = new THREE.CanvasTexture(frontCanvas);
    frontTex.encoding = THREE.sRGBEncoding;
    frontTex.anisotropy = renderer.capabilities.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    var backTex = new THREE.CanvasTexture(backCanvas);
    backTex.encoding = THREE.sRGBEncoding;
    backTex.anisotropy = 4;

    // Materialien 1:1 aus v3: einfaches mattes Papier, keine Normal-/Roughness-Maps
    var frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.95, metalness: 0, alphaTest: 0.5 });
    var backMatL = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.9, metalness: 0, alphaTest: 0.5 });
    var backMatR = backMatL.clone();

    // Druck-Overlays (closed/open) als eigene Ebenen ueber dem Artwork
    textMats = null;
    if (front.textSteps && front.textSteps.length) {
      var texs = front.textSteps.map(function (c) {
        var t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
        return t;
      });
      textMats = {
        tex: texs, step: 0,
        dWorld: (front.textDMax || 0) / (CARD_W * 2) * (2 * halfW),
        mat: new THREE.MeshStandardMaterial({ map: texs[0], transparent: true, depthWrite: false, roughness: 0.95, metalness: 0 })
      };
    }

    // Kantenmaterialien: Druck (inkl. Name) laeuft um die Ecke wie bei dickem Karton
    function edgeMat(c) {
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 1.0, metalness: 0 });
    }
    var FCW = frontCanvas.width, FCH = frontCanvas.height, FH = FCW / 2;
    var EW = 14; // Quellstreifenbreite im Front-Canvas (v3)
    var mInL = edgeMat(edgeStrip(frontCanvas, FH - EW, 0, EW, FCH, 64, 1600, 'rgb(202,194,180)'));
    var mOutL = edgeMat(edgeStrip(frontCanvas, 0, 0, EW, FCH, 64, 1600));
    var mInR = edgeMat(edgeStrip(frontCanvas, FH, 0, EW, FCH, 64, 1600, 'rgb(202,194,180)'));
    var mOutR = edgeMat(edgeStrip(frontCanvas, FCW - EW, 0, EW, FCH, 64, 1600));
    var mTopL = edgeMat(edgeStrip(frontCanvas, 0, 0, FH, EW, 800, 64));
    var mBotL = edgeMat(edgeStrip(frontCanvas, 0, FCH - EW, FH, EW, 800, 64));
    var mTopR = edgeMat(edgeStrip(frontCanvas, FH, 0, FH, EW, 800, 64));
    var mBotR = edgeMat(edgeStrip(frontCanvas, FH, FCH - EW, FH, EW, 800, 64));

    function wing(side) {
      // Starrer, dicker Fluegel: Front z=0, Rueckseite z=-THICK, 4 bedruckte Kanten
      var L = side === 'L';
      var xOff = L ? halfW / 2 : -halfW / 2;
      var pivot = new THREE.Group();

      var g = new THREE.PlaneGeometry(halfW, cardH);   // v3: flach, Falz nur im Artwork
      var i, uv = g.attributes.uv;
      for (i = 0; i < uv.count; i++) uv.setX(i, L ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
      g.translate(xOff, 0, 0);
      pivot.add(new THREE.Mesh(g, frontMat));

      var gb = new THREE.PlaneGeometry(halfW, cardH);
      gb.rotateY(Math.PI);
      gb.translate(xOff, 0, -THICK);
      pivot.add(new THREE.Mesh(gb, L ? backMatL : backMatR));

      var xIn = L ? halfW : -halfW;
      // Gerundete Falz-Innenkante wie beim v2-Original (Max 14:35): halbzylindrischer
      // Papier-Roll statt scharfer 90-Grad-Kante, tangential an Front und Rueckseite
      var gi = new THREE.CylinderGeometry(THICK / 2, THICK / 2, cardH, 24, 1, true, L ? 0 : Math.PI, Math.PI);
      gi.translate(xIn, 0, -THICK / 2);
      pivot.add(new THREE.Mesh(gi, L ? mInL : mInR));

      var go = new THREE.PlaneGeometry(THICK, cardH);
      go.rotateY(L ? -Math.PI / 2 : Math.PI / 2);
      go.translate(0, 0, -THICK / 2);
      pivot.add(new THREE.Mesh(go, L ? mOutL : mOutR));

      var gt = new THREE.PlaneGeometry(halfW, THICK);
      gt.rotateX(-Math.PI / 2);
      gt.translate(xOff, cardH / 2, -THICK / 2);
      pivot.add(new THREE.Mesh(gt, L ? mTopL : mTopR));

      var gbo = new THREE.PlaneGeometry(halfW, THICK);
      gbo.rotateX(Math.PI / 2);
      gbo.translate(xOff, -cardH / 2, -THICK / 2);
      pivot.add(new THREE.Mesh(gbo, L ? mBotL : mBotR));

      // Druck-Overlay auf der Vorderseite (gleiche UV-Haelfte wie der Fluegel)
      if (textMats) {
        var gtA = new THREE.PlaneGeometry(halfW, cardH);
        var uvA = gtA.attributes.uv;
        for (i = 0; i < uvA.count; i++) uvA.setX(i, L ? uvA.getX(i) * 0.5 : 0.5 + uvA.getX(i) * 0.5);
        gtA.translate(xOff, 0, 0.002);
        var mA = new THREE.Mesh(gtA, textMats.mat);
        mA.renderOrder = 1;
        pivot.add(mA);
      }

      return pivot;
    }

    pivL = wing('L'); pivL.position.x = -halfW;
    pivR = wing('R'); pivR.position.x = halfW;
    cardGroup.add(pivL); cardGroup.add(pivR);

    // Weiche Fluegelschatten im Spalt (Max 14:53: "nur der Schatten der jeweiligen
    // Seite"): Gradient von der Innenkante in den Spalt, liegt auf dem Karteninneren
    function makeShadow(mirror) {
      var c = document.createElement('canvas');
      c.width = 128; c.height = 8;
      var x = c.getContext('2d');
      var gr = x.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, 'rgba(40,28,20,1)');
      gr.addColorStop(1, 'rgba(40,28,20,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 8);
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(halfW * 0.5, cardH * 1.12),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide })
      );
      if (mirror) m.scale.x = -1;
      m.position.z = -0.3;
      return m;
    }
    shadowL = makeShadow(false);
    shadowR = makeShadow(true);
    cardGroup.add(shadowL); cardGroup.add(shadowR);

    // Falzmitte dunkel wie in der v2-Referenz (dort ist der Spalt von Anfang an
    // dunkles Karteninneres): schmales Band genau auf der Falzlinie, fade-in mit
    // den ersten Graden, fade-out sobald die Szene durch den Spalt sichtbar wird


    window.addEventListener('resize', fit);
    fit();
    return true;
  }

  function fit() {
    var w = stage.clientWidth || window.innerWidth, h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    var fovR = camera.fov * Math.PI / 360;
    // Cover-Fit wie bei v2/v3: Karte fuellt die Buehne randlos
    var distH = (cardH / 2) / Math.tan(fovR);
    var distW = halfW / (Math.tan(fovR) * camera.aspect);
    z0 = Math.min(distH, distW) * 0.97;
    camera.position.set(0, 0, z0);
    camera.lookAt(0, 0, 0);
    if (blobShadow) {
      blobShadow.scale.set(halfW * 2 * 1.42, cardH * 1.24, 1);
      blobShadow.position.set(0.1, -0.14, -0.5);
    }
  }

  function renderFrame(dt) {
    if (swayOn) {
      swayT += dt;
      cardGroup.rotation.y = Math.sin(swayT * 0.55) * 0.035;
      cardGroup.rotation.x = Math.sin(swayT * 0.8) * 0.013;
    }
    renderer.render(scene, camera);
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    if (phase === 'opening' || frozenP !== null) {
      // Oeffnung 1:1 aus v3: beide Fluegel synchron, eine Easing-Kurve, 1700ms
      var p = frozenP !== null ? frozenP : clamp((now - openStart) / OPEN_MS, 0, 1);
      var e = openEase(p);
      var theta = e * OPEN_ANGLE;
      pivL.rotation.y = -theta;
      pivR.rotation.y = theta;
      // v3: Kamera schiebt durch das Tor; Karte laeuft dabei aus dem Fokus
      camera.position.z = z0 * (1 - 0.58 * smooth((p - 0.22) / 0.78));
      // v3: Tiefenschaerfe beim Heranfahren, max ~10px ab p>0.2
      var blur = p > 0.2 ? Math.pow(smooth((p - 0.2) / 0.7), 1.1) * 10 : 0;
      glCanvas.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(1) + 'px)' : '';
      // v3: Sway klingt multiplikativ aus
      cardGroup.rotation.y *= 0.85; cardGroup.rotation.x *= 0.85;
      if (blobShadow) blobShadow.material.opacity = 1 - smooth(p * 1.7);
      // v3: Welt blendet synchron zur Oeffnung ein
      sceneImg.style.opacity = smooth(p * 2.2);
      // Seitenschatten folgen den Innenkanten (Pivot fest, Kante aus Rotation)
      if (shadowL) {
        var inX = halfW * Math.cos(theta);
        shadowL.position.x = -halfW + inX + halfW * 0.24;
        shadowR.position.x = halfW - inX - halfW * 0.24;
        var shOp = 0.55 * smooth(p * 3) * (p > 0.8 ? Math.max(0, 1 - (p - 0.8) / 0.2) : 1);
        shadowL.material.opacity = shOp;
        shadowR.material.opacity = shOp;
      }
      // v3: Karte fadet im letzten Fuenftel aus
      glCanvas.style.opacity = p > 0.8 ? Math.max(0, 1 - (p - 0.8) / 0.2) : 1;
      if (p >= 1 && frozenP === null) endOpening();
    }
    if (phase !== 'flight' && phase !== 'landing' && phase !== 'player') renderFrame(dt);
  }

  function startLoop() {
    if (rafId === null && renderer) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }
  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ============================================================
  //  Flug: Video (Max' KI-Clip) oder Standbild-Platzhalter
  // ============================================================
  var videoOK = false;

  flightVideo.addEventListener('playing', function () {
    videoOK = true;
    if (phase === 'opening' || phase === 'flight') flightVideo.style.opacity = 1;
  });
  flightVideo.addEventListener('error', function () { videoOK = false; });
  // Letztes Videobild (fertige Szene) bleibt stehen, Player-Karte landet
  flightVideo.addEventListener('ended', function () {
    if (phase === 'flight') landCard();
  });
  // Player faedet kurz vor dem Tower ein (Max 14:36): Landung startet, waehrend
  // der Eiffelturm im Video-Endanflug noch hochwaechst. landCard() selbst prueft
  // die Phase, bei Replay laeuft der Listener erneut korrekt.
  flightVideo.addEventListener('timeupdate', function () {
    if (phase !== 'flight') return;
    if (isFinite(flightVideo.duration) && flightVideo.duration > 0 &&
        flightVideo.currentTime >= flightVideo.duration - 2.3) landCard();
  });
  flightVideo.addEventListener('stalled', function () {
    // haengt das Video, landet die Karte trotzdem (Watchdog laeuft)
  });

  // ============================================================
  //  Schnee-Endszene: Flocken -> Haube auf dem Player -> abkippende Klumpen
  //  Eigenes minimales Partikelsystem (kein Framework). Eigener rAF-Loop,
  //  weil die Hauptschleife in der Flugphase steht. Pausiert bei verstecktem Tab.
  //  Physik der Rundung (Max 08:12): Haube nur auf dem GERADEN Teil der
  //  Oberkante; Flocken im border-radius-Bereich rutschen der Kurve folgend
  //  seitlich ab; Klumpen brechen bevorzugt an den Ecken und fallen entlang
  //  der Rundung.
  // ============================================================
  var snowRaf = null, snowCtx = null, snowOn = false;
  var flakes = [], clumps = [], sliders = [], pile = null;
  var cardRect = null, cardRectT = 0;
  var BIN = 7;                 // Breite eines Hauben-Bins in px
  var GRAV = 620;              // Gravitation px/s^2

  function snowResize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var r = snowFxCv.getBoundingClientRect();
    snowFxCv.width = Math.max(1, Math.round(r.width * dpr));
    snowFxCv.height = Math.max(1, Math.round(r.height * dpr));
    snowCtx = snowFxCv.getContext('2d');
    snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pile = null; // Hauben-Bins beim Resize neu aufsetzen
  }

  function flakeCount() {
    var mobile = Math.min(window.innerWidth, window.innerHeight) < 620;
    return mobile ? SNOW.flakesMobile : SNOW.flakesDesktop;
  }

  function spawnFlake(anywhere) {
    var r = snowFxCv.getBoundingClientRect();
    return {
      x: Math.random() * r.width,
      y: anywhere ? Math.random() * r.height : -6 - Math.random() * 30,
      vy: 26 + Math.random() * 34,
      drift: 10 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
      size: 1.1 + Math.random() * 1.9
    };
  }

  // gerader Abschnitt der Oberkante (ohne Ecken-Radius)
  function straightL() { return cardRect.left + cardRect.radius; }
  function straightR() { return cardRect.left + cardRect.width - cardRect.radius; }

  function ensurePile() {
    if (!cardRect) return;
    var w = Math.max(10, straightR() - straightL());
    var n = Math.max(4, Math.ceil(w / BIN));
    if (!pile || pile.length !== n) {
      pile = new Array(n);
      for (var i = 0; i < n; i++) pile[i] = 0;
    }
  }

  function refreshCardRect(now) {
    if (now - cardRectT > 400) {
      cardRectT = now;
      var el = document.getElementById('card');
      var cr = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      var rad = parseFloat(cs.borderTopLeftRadius) || 0;
      rad = Math.max(rad, parseFloat(cs.borderTopRightRadius) || 0);
      var stageR = stage.getBoundingClientRect();
      cardRect = {
        left: cr.left - stageR.left,
        top: cr.top - stageR.top,
        width: cr.width,
        height: cr.height,
        radius: Math.min(rad, cr.width / 2)
      };
      ensurePile();
    }
  }

  // Kurven-Oberflaeche im Eckenbereich: Kreisbogen des border-radius
  // Seite: -1 links, +1 rechts. Gibt y der Bogenoberflaeche bei x zurueck.
  function cornerCurveY(x, side) {
    var cx = side < 0 ? straightL() : straightR();
    var dx = side < 0 ? (cx - x) : (x - cx);   // 0 am geraden Ende, R aussen
    var R = cardRect.radius;
    if (dx < 0 || dx > R) return null;
    return cardRect.top + R - Math.sqrt(Math.max(0, R * R - dx * dx));
  }

  function inCornerZone(x) {
    if (!cardRect) return 0;
    if (x >= cardRect.left && x < straightL()) return -1;
    if (x > straightR() && x <= cardRect.left + cardRect.width) return 1;
    return 0;
  }

  // Slider: Partikel/Klumpen, der dem Ecken-Kreisbogen folgt
  function spawnSlider(x, r, side) {
    var R = cardRect.radius;
    var cx = side < 0 ? straightL() : straightR();
    var dx = Math.max(0, Math.min(R, side < 0 ? cx - x : x - cx));
    sliders.push({
      side: side,
      a: Math.asin(dx / R),          // 0 = oben, PI/2 = seitlich
      om: 0.6 + Math.random() * 0.5, // Winkelgeschwindigkeit rad/s
      r: r
    });
  }

  function deposit(x) {
    if (!pile || !cardRect) return false;
    if (x < straightL() || x > straightR()) return false;
    var i = Math.min(pile.length - 1, Math.max(0, Math.floor((x - straightL()) / BIN)));
    pile[i] += 0.55;
    if (i > 0) pile[i - 1] += 0.18;
    if (i < pile.length - 1) pile[i + 1] += 0.18;
    // harte Decke: kein Bin darf ueber capMax wachsen (sonst Saeulen bis Bildrand)
    if (pile[i] > SNOW.capMax) pile[i] = SNOW.capMax;
    if (i > 0 && pile[i - 1] > SNOW.capMax) pile[i - 1] = SNOW.capMax;
    if (i < pile.length - 1 && pile[i + 1] > SNOW.capMax) pile[i + 1] = SNOW.capMax;
    return true;
  }

  // Abkippen: bevorzugt nahe den Ecken; der Klumpen rutscht auf den Bogen
  function maybeTip() {
    if (!pile || !cardRect) return;
    var n = pile.length;
    for (var i = 0; i < n; i++) {
      var h = pile[i];
      if (h < 2) continue;
      var edgeDist = Math.min(i, n - 1 - i) / (n / 2);      // 0 = Ecke, 1 = Mitte
      var edgeBias = 1 + 3 * (1 - edgeDist);                // Ecken kippen 4x so gern
      var threshold = SNOW.capMax - 4 * (1 - edgeDist);     // Ecken frueher
      if (h >= threshold || (h > SNOW.clumpMin * 0.7 && Math.random() < 0.0015 * edgeBias)) {
        var take = Math.min(h, 6 + Math.random() * 6);
        pile[i] = Math.max(0, pile[i] - take);
        if (i > 0 && pile[i - 1] > 1) pile[i - 1] = Math.max(0, pile[i - 1] - take * 0.25);
        if (i < n - 1 && pile[i + 1] > 1) pile[i + 1] = Math.max(0, pile[i + 1] - take * 0.25);
        var x = straightL() + i * BIN + BIN / 2;
        var r = 2.5 + take * 0.45;
        if (edgeDist < 0.35) {
          // nahe der Ecke: direkt auf den Bogen setzen
          spawnSlider(i < n / 2 ? straightL() - 1 : straightR() + 1, r, i < n / 2 ? -1 : 1);
        } else {
          clumps.push({
            x: x, y: cardRect.top - Math.max(0, h - take) - 3,
            r: r,
            vx: (Math.random() - 0.5) * 20,
            vy: 12,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 3
          });
        }
      }
    }
  }

  function drawBlob(x, y, r, alpha) {
    snowCtx.globalAlpha = alpha;
    snowCtx.beginPath();
    snowCtx.arc(x, y, r, 0, Math.PI * 2);
    if (r > 3) snowCtx.arc(x + r * 0.6, y - r * 0.35, r * 0.7, 0, Math.PI * 2);
    snowCtx.fillStyle = 'rgba(255,255,255,0.95)';
    snowCtx.fill();
    snowCtx.globalAlpha = 1;
  }

  function snowStep(now, dt) {
    var r = snowFxCv.getBoundingClientRect();
    var W = r.width, H = r.height;
    snowCtx.clearRect(0, 0, W, H);
    // Erst sammeln, wenn die Player-Karte gelandet ist - vorher nur Schneefall
    var cardLive = (phase === 'landing' || phase === 'player');

    // Flocken bewegen
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.phase += dt * 0.9;
      f.x += Math.sin(f.phase) * f.drift * dt;
      f.y += f.vy * dt;

      var done = false;
      if (cardLive && cardRect) {
        var side = inCornerZone(f.x);
        if (side !== 0) {
          // Eckenzone: auf der Kurve landen -> seitlich abrutschen
          var cy = cornerCurveY(f.x, side);
          if (cy !== null && f.y >= cy - 1) {
            spawnSlider(f.x, f.size, side);
            done = true;
          }
        } else if (pile && f.x >= straightL() && f.x <= straightR()) {
          var bi = Math.min(pile.length - 1, Math.max(0, Math.floor((f.x - straightL()) / BIN)));
          if (f.y >= cardRect.top - pile[bi] - 1) { deposit(f.x); done = true; }
        }
      }
      if (done || f.y > H + 6) { flakes[i] = spawnFlake(false); continue; }

      snowCtx.beginPath();
      snowCtx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      snowCtx.fillStyle = 'rgba(255,255,255,0.85)';
      snowCtx.fill();
    }

    if (cardLive) maybeTip();
    if (snowForce && pile) { var m = 0; for (var pi = 0; pi < pile.length; pi++) if (pile[pi] > m) m = pile[pi]; window.__pileMax = m; }

    // Slider: entlang des Kreisbogens beschleunigen, an der Seite abloesen
    for (var s = sliders.length - 1; s >= 0; s--) {
      var sl = sliders[s];
      var R = cardRect ? cardRect.radius : 20;
      sl.om += (GRAV * Math.sin(sl.a) / R) * dt;   // tangentiale Beschleunigung
      sl.a += sl.om * dt;
      var cx = sl.side < 0 ? straightL() : straightR();
      var px = cx - sl.side * R * Math.sin(sl.a);
      var py = cardRect.top + R - R * Math.cos(sl.a);
      if (sl.a >= Math.PI / 2 * 0.98) {
        // am Ende der Rundung: als freier Klumpen weiterfallen
        var v = sl.om * R;
        clumps.push({
          x: px, y: py, r: sl.r,
          vx: -sl.side * Math.max(6, v * 0.15),
          vy: Math.max(30, v),
          rot: 0, vr: (Math.random() - 0.5) * 3
        });
        sliders.splice(s, 1);
        continue;
      }
      drawBlob(px, py, sl.r, 0.95);
    }

    // Klumpen: Gravitation, Rotation, ggf. auf die Rundung umgreifen
    for (var j = clumps.length - 1; j >= 0; j--) {
      var cl = clumps[j];
      cl.vy += GRAV * dt;
      cl.y += cl.vy * dt;
      cl.x += cl.vx * dt;
      cl.rot += cl.vr * dt;
      if (cardRect) {
        var cside = inCornerZone(cl.x);
        if (cside !== 0 && cl.y < cardRect.top + cardRect.radius) {
          var cy2 = cornerCurveY(cl.x, cside);
          if (cy2 !== null && cl.y >= cy2 - 2) {
            spawnSlider(cl.x, cl.r, cside);
            clumps.splice(j, 1);
            continue;
          }
        }
      }
      var fade = 1;
      if (cardRect && cl.y > cardRect.top + 10) fade = Math.max(0, 1 - (cl.y - cardRect.top - 10) / 90);
      if (fade <= 0 || cl.y > H + 20) { clumps.splice(j, 1); continue; }
      clumps[j].rot = cl.rot;
      snowCtx.save();
      snowCtx.translate(cl.x, cl.y);
      snowCtx.rotate(cl.rot);
      drawBlob(0, 0, cl.r, fade);
      snowCtx.restore();
    }

    // Haube: nur auf dem geraden Abschnitt der Oberkante
    if (cardLive && pile && cardRect && cardRect.width > 0) {
      snowCtx.beginPath();
      snowCtx.moveTo(straightL(), cardRect.top + 2);
      for (var b = 0; b < pile.length; b++) {
        var bx = straightL() + b * BIN + BIN / 2;
        var by = cardRect.top + 1 - pile[b];
        if (b === 0) snowCtx.lineTo(bx, by);
        else snowCtx.quadraticCurveTo(straightL() + b * BIN, cardRect.top + 1 - pile[b - 1], bx, by);
      }
      snowCtx.lineTo(straightR(), cardRect.top + 2);
      snowCtx.closePath();
      snowCtx.fillStyle = 'rgba(255,255,255,0.96)';
      snowCtx.fill();
    }
  }

  var snowLast = 0;
  function snowLoop(now) {
    if (!snowOn) { snowRaf = null; return; }
    snowRaf = requestAnimationFrame(snowLoop);
    var dt = Math.min(0.05, (now - snowLast) / 1000 || 0.016);
    snowLast = now;
    refreshCardRect(now);
    snowStep(now, dt);
  }

  var snowIv = null;
  function startSnow() {
    if (!SNOW.enabled || snowOn) return;
    snowOn = true;
    snowResize();
    var want = flakeCount();
    flakes = [];
    for (var i = 0; i < want; i++) flakes.push(spawnFlake(true));
    clumps = []; sliders = [];
    snowLast = performance.now();
    snowRaf = requestAnimationFrame(snowLoop);
    if (snowForce) {
      // Debug-Treiber: rAF schlaeft in versteckten Tabs, Intervall laeuft (gedrosselt) weiter
      snowIv = setInterval(function () {
        if (!snowOn) return;
        for (var k = 0; k < 10; k++) snowStep(performance.now(), 0.05);
      }, 500);
    }
  }

  function stopSnow() {
    snowOn = false;
    if (snowIv !== null) { clearInterval(snowIv); snowIv = null; }
    if (snowRaf !== null) { cancelAnimationFrame(snowRaf); snowRaf = null; }
    if (snowCtx) {
      var r = snowFxCv.getBoundingClientRect();
      snowCtx.clearRect(0, 0, r.width, r.height);
    }
    flakes = []; clumps = []; sliders = []; pile = null;
  }

  // Pausieren bei verstecktem Tab
  document.addEventListener('visibilitychange', function () {
    if (!SNOW.enabled || snowForce) return;
    if (document.hidden) {
      if (snowRaf !== null) { cancelAnimationFrame(snowRaf); snowRaf = null; }
    } else if (snowOn && snowRaf === null) {
      snowLast = performance.now();
      snowRaf = requestAnimationFrame(snowLoop);
    }
  });
  window.addEventListener('resize', function () { if (snowOn) snowResize(); });

  // ============================================================
  //  Ablauf
  // ============================================================
  function open() {
    if (phase !== 'closed') return;
    phase = 'opening';
    taplayer.classList.add('is-pass');
    taplayer.classList.add('is-hidden');

    // Sample-Audio im selben Gesture stumm entsperren (iOS)
    try {
      audio.muted = true;
      var ap = audio.play();
      if (ap && ap.then) ap.then(function () { audio.pause(); audio.currentTime = 0; audio.muted = false; }, function () { audio.muted = false; });
    } catch (e) { audio.muted = false; }

    // Flug-Video mit Ton starten (User-Geste durch Antippen; fehlt die Datei, bleibt das Standbild)
    try {
      flightVideo.muted = false;
      flightVideo.volume = 1;
      var fv = flightVideo.play();
      if (fv && fv.catch) fv.catch(function () {});
    } catch (e) {}

    if (renderer) {
      swayOn = false;
      swayRotY = cardGroup.rotation.y; swayRotX = cardGroup.rotation.x;
      tapTime = performance.now();
      glCanvas.style.opacity = 1;
      openStart = tapTime;   // v3: Oeffnung startet sofort mit dem Tap
    } else {
      // Fallback ohne WebGL: statische Karte ausblenden, Szene direkt zeigen
      fallback.style.transition = 'opacity .8s ease';
      fallback.style.opacity = 0;
      cardname.style.opacity = 0;
      cardname.style.visibility = 'hidden';
      sceneImg.style.opacity = 1;
      sceneEl.style.filter = '';
      sceneEl.style.transform = '';
      startSnow();
      clearTimeout(flightTimer);
      flightTimer = setTimeout(landCard, PLACEHOLDER_MS);
    }
  }

  function endOpening() {
    phase = 'flight';
    glCanvas.style.opacity = 0;
    sceneImg.style.opacity = 1;
    stopLoop();
    startSnow();
    clearTimeout(flightTimer);
    flightTimer = setTimeout(flightWatchdog, PLACEHOLDER_MS);
  }

  // Watchdog: bei Video landet 'ended' frueher; Standbild oder Video-Haenger -> Timer.
  // Laeuft das Video noch, wird der Timer auf das Restende verlaengert.
  function flightWatchdog() {
    if (phase !== 'flight') return;
    if (videoOK && !flightVideo.paused && !flightVideo.ended &&
        isFinite(flightVideo.duration) && flightVideo.duration > 0 &&
        flightVideo.currentTime < flightVideo.duration - 0.4) {
      flightTimer = setTimeout(flightWatchdog,
        (flightVideo.duration - flightVideo.currentTime) * 1000 + 1200);
      return;
    }
    landCard();
  }

  function landCard() {
    if (phase !== 'flight' && phase !== 'opening') return;
    phase = 'landing';
    veil.classList.add('is-on');
    cardWrap.setAttribute('aria-hidden', 'false');
    card.classList.add('is-in');
    clearTimeout(audioTimer);
    // Ton erst, wenn das Video durch ist (Player landet jetzt vor Videoende) -
    // sonst ueberlappt sich die Sprachnachricht mit dem Video-Ton
    var audioWait = 1300;
    if (videoOK && !flightVideo.ended && isFinite(flightVideo.duration) && flightVideo.duration > 0) {
      audioWait = Math.max(300, (flightVideo.duration - flightVideo.currentTime) * 1000 + 300);
    }
    audioTimer = setTimeout(function () {
      audio.muted = false;
      audio.currentTime = 0;
      audio.play().catch(function () {});
      phase = 'player';
    }, audioWait);
  }

  function replay() {
    clearTimeout(audioTimer);
    clearTimeout(flightTimer);
    audio.pause(); audio.currentTime = 0; audio.muted = false;
    stopSnow();
    flightVideo.pause();
    try { flightVideo.currentTime = 0; } catch (e) {}
    flightVideo.style.opacity = 0;
    sceneImg.style.opacity = 0;
    sceneEl.style.filter = '';
    sceneEl.style.transform = '';
    if (!renderer) {
      cardname.style.opacity = 1;
      cardname.style.filter = '';
      cardname.style.visibility = 'visible';
    }
    veil.classList.remove('is-on');
    card.classList.remove('is-in');
    cardWrap.setAttribute('aria-hidden', 'true');
    if (renderer) {
      frozenP = null;
      pivL.rotation.y = 0; pivR.rotation.y = 0;
      if (textMats) { textMats.step = 0; textMats.mat.map = textMats.tex[0]; }
      if (shadowL) { shadowL.material.opacity = 0; shadowR.material.opacity = 0; }
      glCanvas.style.filter = '';
      camera.position.set(0, 0, z0);
      cardGroup.rotation.set(0, 0, 0);
      if (blobShadow) blobShadow.material.opacity = 1;
      swayOn = true; swayT = 0;
      glCanvas.style.opacity = 1;
      startLoop();
    } else {
      fallback.style.opacity = 1;
    }
    taplayer.classList.remove('is-hidden');
    taplayer.classList.remove('is-pass');
    setHint(HINT_DEFAULT, false);
    phase = 'closed';
  }

  // Fallback: blockierte Audiowiedergabe beim naechsten echten Fingertipp holen
  stage.addEventListener('pointerdown', function () {
    if (card.classList.contains('is-in') && audio.paused && audio.currentTime === 0) {
      audio.muted = false;
      audio.play().catch(function () {});
    }
  });

  taplayer.addEventListener('click', open);
  taplayer.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  replayBtn.addEventListener('click', replay);

  // ---------- Player ----------
  playBtn.addEventListener('click', function () {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  });
  muteBtn.addEventListener('click', function () {
    audio.muted = !audio.muted;
    iconVol.style.display = audio.muted ? 'none' : '';
    iconMute.style.display = audio.muted ? '' : 'none';
    muteBtn.setAttribute('aria-label', audio.muted ? 'Ton an' : 'Stumm');
  });
  audio.addEventListener('play', function () {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
    playBtn.setAttribute('aria-label', 'Pause');
  });
  audio.addEventListener('pause', function () {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
    audio.setAttribute('aria-label', 'Abspielen');
  });
  audio.addEventListener('ended', function () {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
    audio.currentTime = 0;
  });
  audio.addEventListener('loadedmetadata', function () {
    tDur.textContent = fmt(audio.duration);
    track.setAttribute('aria-valuemax', String(Math.round(audio.duration)));
  });
  audio.addEventListener('timeupdate', function () {
    if (seeking) return;
    tCur.textContent = fmt(audio.currentTime);
    track.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
    if (audio.duration > 0) fill.style.width = Math.min(100, (audio.currentTime / audio.duration) * 100) + '%';
  });
  function seekTo(clientX) {
    if (!audio.duration) return;
    var r = track.getBoundingClientRect();
    var ratio = clamp((clientX - r.left) / r.width, 0, 1);
    audio.currentTime = ratio * audio.duration;
    tCur.textContent = fmt(audio.currentTime);
    fill.style.width = (ratio * 100) + '%';
  }
  track.addEventListener('pointerdown', function (e) {
    seeking = true;
    seekTo(e.clientX);
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
  });
  track.addEventListener('pointermove', function (e) { if (seeking) seekTo(e.clientX); });
  track.addEventListener('pointerup', function () { seeking = false; });

  // ============================================================
  //  Start
  // ============================================================
  function ready(frontCanvas, backCanvas) {
    var ok = typeof THREE !== 'undefined' && initGL(frontCanvas, backCanvas);
    if (!ok) {
      glCanvas.style.display = 'none';
      fallback.hidden = false;
    }
    phase = 'closed';
    setHint(HINT_DEFAULT, false);

    // Empfaengername: mit WebGL in der Kartentextur (gedruckt, klappt mit).
    // Die DOM-Ebene bleibt nur als Overlay fuer den No-WebGL-Fallback.
    cardnameText.textContent = recipient.toUpperCase();
    if (ok) cardname.style.display = 'none';

    // Debug-/Testzustaende fuer Screenshots
    if (renderer && debugT !== null && !isNaN(debugT)) {
      frozenP = clamp(debugT, 0, 1);
      swayOn = false;
    }
    if (renderer && debugState === 'open') {
      frozenP = 1;
      swayOn = false;
      cardname.style.opacity = 0;
      cardname.style.visibility = 'hidden';
      sceneImg.style.opacity = 1;
      sceneEl.style.filter = '';
      sceneEl.style.transform = '';
    }
    if (debugState === 'player') {
      if (renderer) { stopLoop(); glCanvas.style.opacity = 0; }
      else fallback.style.opacity = 0;
      cardname.style.opacity = 0;
      cardname.style.visibility = 'hidden';
      sceneImg.style.opacity = 1;
      sceneEl.style.filter = '';
      sceneEl.style.transform = '';
      phase = 'flight';
      startSnow();
      veil.style.transition = 'none';
      card.style.transition = 'none';
      taplayer.classList.add('is-hidden');
      var items = document.querySelectorAll('.anim-item');
      for (var ii = 0; ii < items.length; ii++) items[ii].style.transition = 'none';
      landCard();
      audio.pause();
    }
    startLoop();
    if (qs.has('auto')) setTimeout(open, 900);
  }

  if (audio.readyState >= 1) tDur.textContent = fmt(audio.duration);

  loadFonts()
    .then(function () { return loadImage('card-front.jpg'); })
    .then(function (img) { ready(bakeFront(img, recipient), bakeBack(img)); })
    .catch(function () { var f = bakeFrontFallback(recipient); ready({ art: f }, bakeBack(f)); });
})();
