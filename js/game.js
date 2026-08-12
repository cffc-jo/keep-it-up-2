/* ==========================================================================
   Chicago Fire FC — "Keep It Up" Challenge
   Tap-to-juggle webview mini-game.

   Win:  reach a streak of WIN_STREAK consecutive successful taps
         within TIME_CAP seconds.
   Lose: the clock runs out before the streak target is reached.
   ========================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  var WIN_STREAK = 10;      // consecutive successful taps needed to win
  var TIME_CAP = 45;        // seconds, hard cap for a session

  var GRAVITY_BASE = 1500;      // px/s^2 at streak 0
  var GRAVITY_MAX = 2600;       // px/s^2 at streak >= WIN_STREAK
  var IMPULSE_BASE = -820;      // px/s upward velocity applied on a good hit
  var IMPULSE_GROWTH = -14;     // extra (more negative) impulse per streak point
  var MISS_RELAUNCH_VY = -650;  // relaunch velocity after a miss

  var BALL_RADIUS_REF = 34;     // reference radius, scaled to stage width

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  var stage = document.querySelector(".stage");
  var canvas = document.getElementById("game-canvas");
  var ctx = canvas.getContext("2d");
  var confettiCanvas = document.getElementById("confetti-canvas");
  var confettiCtx = confettiCanvas.getContext("2d");

  var streakValueEl = document.getElementById("streak-value");
  var timerValueEl = document.getElementById("timer-value");

  var startScreen = document.getElementById("start-screen");
  var winScreen = document.getElementById("win-screen");
  var loseScreen = document.getElementById("lose-screen");

  var startBtn = document.getElementById("start-btn");
  var retryBtn = document.getElementById("retry-btn");
  var prizeBtn = document.getElementById("prize-btn");
  var playAgainBtn = document.getElementById("play-again-btn");

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var STATE = { READY: "ready", PLAYING: "playing", WON: "won", LOST: "lost" };
  var state = STATE.READY;

  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  var stageW = 0, stageH = 0;

  var ball = null;
  var streak = 0;
  var timeLeft = TIME_CAP;
  var lastFrameTime = 0;
  var rafId = null;
  var hitFlash = 0;      // brief visual flash timer after a hit
  var missFlash = 0;     // brief visual flash timer after a miss
  var groundFlashColor = null;

  var confettiParticles = [];
  var confettiRafId = null;

  // ---------------------------------------------------------------------
  // Audio (tiny synthesized cues, no external assets required)
  // ---------------------------------------------------------------------
  var audioCtx = null;
  function unlockAudio() {
    if (audioCtx) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { /* audio not available, fail silently */ }
  }
  function beep(freq, duration, type, gainPeak) {
    if (!audioCtx) return;
    try {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      gain.gain.linearRampToValueAtTime(gainPeak || 0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (e) { /* ignore */ }
  }
  function playHitSound(streakCount) {
    var freq = 320 + Math.min(streakCount, WIN_STREAK) * 22;
    beep(freq, 0.12, "triangle", 0.18);
  }
  function playMissSound() { beep(140, 0.28, "sawtooth", 0.16); }
  function playWinSound() {
    if (!audioCtx) return;
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.22, "triangle", 0.16); }, i * 90);
    });
  }

  // ---------------------------------------------------------------------
  // Sizing
  // ---------------------------------------------------------------------
  function resize() {
    stageW = stage.clientWidth;
    stageH = stage.clientHeight;

    [canvas, confettiCanvas].forEach(function (c) {
      c.width = Math.round(stageW * dpr);
      c.height = Math.round(stageH * dpr);
      c.style.width = stageW + "px";
      c.style.height = stageH + "px";
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (ball) {
      ball.radius = scaledRadius();
      ball.x = stageW / 2;
      if (ball.y > groundY()) ball.y = groundY();
    }
  }

  function scaledRadius() {
    return Math.max(22, Math.min(BALL_RADIUS_REF, stageW * 0.11));
  }

  // Hit zone: band near the lower-middle of the stage where a tap counts.
  function hitZoneTop() { return stageH * 0.58; }
  function hitZoneBottom() { return stageH * 0.80; }
  // Ground: falling past this line without a successful hit = miss.
  function groundY() { return stageH * 0.88 - scaledRadius(); }
  function ceilingY() { return stageH * 0.12 + scaledRadius(); }

  // ---------------------------------------------------------------------
  // Ball
  // ---------------------------------------------------------------------
  function createBall() {
    return {
      x: stageW / 2,
      y: stageH * 0.35,
      vx: 0,
      vy: 40,
      radius: scaledRadius(),
      rotation: 0,
      spin: 2.2,
      squash: 1
    };
  }

  function currentGravity() {
    var t = Math.min(streak, WIN_STREAK) / WIN_STREAK;
    return GRAVITY_BASE + (GRAVITY_MAX - GRAVITY_BASE) * t;
  }

  function currentImpulse() {
    return IMPULSE_BASE + IMPULSE_GROWTH * streak;
  }

  // ---------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------
  function resetGame() {
    streak = 0;
    timeLeft = TIME_CAP;
    ball = createBall();
    hitFlash = 0;
    missFlash = 0;
    groundFlashColor = null;
    updateHud();
    timerValueEl.classList.remove("time-warning");
  }

  function startGame() {
    unlockAudio();
    resetGame();
    state = STATE.PLAYING;
    show(startScreen, false);
    show(winScreen, false);
    show(loseScreen, false);
    lastFrameTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function endGame(won) {
    state = won ? STATE.WON : STATE.LOST;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (won) {
      playWinSound();
      show(winScreen, true);
      launchConfetti();
    } else {
      show(loseScreen, true);
    }
  }

  function show(el, visible) {
    if (visible) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  function updateHud() {
    streakValueEl.innerHTML = streak + '<span class="stat-target">/' + WIN_STREAK + "</span>";
    timerValueEl.textContent = timeLeft.toFixed(1);
    if (timeLeft <= 10) timerValueEl.classList.add("time-warning");
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function loop(now) {
    var dt = Math.min((now - lastFrameTime) / 1000, 0.05); // clamp for tab-switch hitches
    lastFrameTime = now;

    if (state === STATE.PLAYING) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateHud();
        endGame(false);
        return;
      }
      updatePhysics(dt);
      updateHud();
    }

    draw();

    if (state === STATE.PLAYING) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function updatePhysics(dt) {
    ball.vy += currentGravity() * dt;
    ball.y += ball.vy * dt;
    ball.rotation += ball.spin * dt * (1 + streak * 0.05);

    // gentle horizontal drift for visual life; bounces off the stage edges
    ball.x += ball.vx * dt;
    var minX = ball.radius + 12, maxX = stageW - ball.radius - 12;
    if (ball.x < minX) { ball.x = minX; ball.vx = Math.abs(ball.vx) * 0.6 + 20; }
    if (ball.x > maxX) { ball.x = maxX; ball.vx = -(Math.abs(ball.vx) * 0.6 + 20); }

    if (hitFlash > 0) hitFlash -= dt;
    if (missFlash > 0) missFlash -= dt;

    // squash/stretch toward resting roundness
    ball.squash += (1 - ball.squash) * Math.min(1, dt * 8);

    // Passed the ceiling (shouldn't happen often, just clamp)
    if (ball.y < ceilingY() && ball.vy < 0) {
      ball.y = ceilingY();
    }

    // Missed: fell through the hit zone without a tap
    if (ball.y > groundY()) {
      registerMiss();
    }
  }

  function registerHit() {
    streak += 1;
    ball.vy = currentImpulse();
    ball.vx += (Math.random() - 0.5) * 90;
    ball.squash = 1.35;
    hitFlash = 0.15;
    playHitSound(streak);

    if (streak >= WIN_STREAK) {
      updateHud();
      endGame(true);
    }
  }

  function registerMiss() {
    if (streak > 0) playMissSound();
    streak = 0;
    ball.y = groundY() - 1;
    ball.vy = MISS_RELAUNCH_VY;
    ball.vx = (Math.random() - 0.5) * 60;
    ball.squash = 0.7;
    missFlash = 0.25;
  }

  function handleTap() {
    if (state === STATE.READY) { startGame(); return; }
    if (state !== STATE.PLAYING || !ball) return;

    var inZone = ball.y >= hitZoneTop() && ball.y <= hitZoneBottom();
    var fallingOrNear = ball.vy > -250; // don't allow spamming right after a launch

    if (inZone && fallingOrNear) {
      registerHit();
    }
    // Taps outside the zone are simply ignored (forgiving — no penalty
    // for an accidental early/late tap), keeping the game welcoming
    // for all ages and skill levels.
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, stageW, stageH);
    drawBackdrop();
    drawZones();
    if (ball) drawBall(ball);
    if (missFlash > 0) drawEdgeFlash("rgba(255,0,0," + (missFlash / 0.25 * 0.35) + ")");
    if (hitFlash > 0) drawEdgeFlash("rgba(125,204,240," + (hitFlash / 0.15 * 0.25) + ")");
  }

  function drawBackdrop() {
    // faint vertical "pitch stripe" texture, subtle brand tone
    var stripeW = stageW / 8;
    for (var i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(23,26,69,0.35)" : "rgba(22,12,38,0.15)";
      ctx.fillRect(i * stripeW, 0, stripeW, stageH);
    }
  }

  function drawZones() {
    // Hit-zone guide band
    var top = hitZoneTop(), bottom = hitZoneBottom();
    var grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, "rgba(125,204,240,0)");
    grad.addColorStop(0.5, "rgba(125,204,240,0.12)");
    grad.addColorStop(1, "rgba(125,204,240,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, top, stageW, bottom - top);
  }

  function drawEdgeFlash(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stageW, stageH);
  }

  function drawBall(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(1 / Math.sqrt(b.squash), b.squash);
    ctx.rotate(b.rotation);

    // drop shadow (drawn before rotation offset would look odd, so approximate)
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(b.x, groundY() + b.radius * 0.9, b.radius * 0.9, b.radius * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);

    // Ball base
    var r = b.radius;
    var ballGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r);
    ballGrad.addColorStop(0, "#ffffff");
    ballGrad.addColorStop(0.55, "#f4f6fb");
    ballGrad.addColorStop(1, "#c9cede");
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();

    // Fire-branded pentagon panels (red/navy) around a soccer-ball layout
    var panelCount = 5;
    for (var i = 0; i < panelCount; i++) {
      var ang = (Math.PI * 2 * i) / panelCount - Math.PI / 2;
      var px = Math.cos(ang) * r * 0.52;
      var py = Math.sin(ang) * r * 0.52;
      drawPentagon(px, py, r * 0.34, ang + Math.PI / 2, i % 2 === 0 ? "#171A45" : "#FF0000");
    }
    drawPentagon(0, 0, r * 0.3, 0, "#AA0000");

    // ball outline
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.045);
    ctx.strokeStyle = "rgba(23,26,69,0.55)";
    ctx.stroke();

    // top-left specular highlight
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();

    ctx.restore();
  }

  function drawPentagon(cx, cy, size, rotation, fillColor) {
    var sides = 5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = (Math.PI * 2 * i) / sides - Math.PI / 2;
      var x = Math.cos(a) * size;
      var y = Math.sin(a) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Confetti (win celebration) — lightweight, no external dependency
  // ---------------------------------------------------------------------
  var CONFETTI_COLORS = ["#FF0000", "#AA0000", "#171A45", "#7DCCF0", "#FFD84D", "#FFFFFF"];

  function launchConfetti() {
    confettiParticles = [];
    var count = Math.min(140, Math.floor(stageW / 3));
    for (var i = 0; i < count; i++) {
      confettiParticles.push({
        x: Math.random() * stageW,
        y: -20 - Math.random() * stageH * 0.4,
        vx: (Math.random() - 0.5) * 160,
        vy: 220 + Math.random() * 260,
        size: 6 + Math.random() * 7,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        shapeIsRect: Math.random() > 0.4
      });
    }
    var last = performance.now();
    var elapsed = 0;
    var duration = 4.5;

    if (confettiRafId) cancelAnimationFrame(confettiRafId);

    function step(now) {
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;

      confettiCtx.clearRect(0, 0, stageW, stageH);
      confettiParticles.forEach(function (p) {
        p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;

        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rotation);
        confettiCtx.fillStyle = p.color;
        if (p.shapeIsRect) {
          confettiCtx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        } else {
          confettiCtx.beginPath();
          confettiCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          confettiCtx.fill();
        }
        confettiCtx.restore();
      });

      if (elapsed < duration && state === STATE.WON) {
        confettiRafId = requestAnimationFrame(step);
      } else {
        confettiCtx.clearRect(0, 0, stageW, stageH);
      }
    }
    confettiRafId = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  function onPointerDown(e) {
    // Ignore taps that originate on interactive controls (buttons/links)
    // so the win/lose CTA buttons work normally without also registering
    // as a juggle tap.
    if (e.target.closest && e.target.closest(".btn")) return;
    e.preventDefault();
    handleTap();
  }

  // Note: we intentionally do NOT also listen for "touchstart" here.
  // Touch devices fire both "pointerdown" and "touchstart" for the same
  // tap; an unguarded touchstart preventDefault() would suppress the
  // browser's synthesized "click" on buttons even when onPointerDown
  // above correctly backs off for .btn targets — causing "Tap to Start"
  // / "Try Again" to intermittently do nothing (worse with multi-touch,
  // e.g. several people tapping the same screen at once). CSS already
  // handles scroll/zoom/callout suppression (touch-action, user-select),
  // so pointerdown's own preventDefault() below is sufficient.
  stage.addEventListener("pointerdown", onPointerDown, { passive: false });

  startBtn.addEventListener("click", function (e) { e.preventDefault(); startGame(); });
  retryBtn.addEventListener("click", function (e) { e.preventDefault(); startGame(); });
  playAgainBtn.addEventListener("click", function (e) { e.preventDefault(); startGame(); });
  prizeBtn.addEventListener("click", function () {
    // Hook for native app integration: if the surrounding WebView wants
    // to intercept the prize click (e.g. to open its own in-app browser
    // or trigger a native deep link), it can define window.onPrizeClaim
    // before this script runs. The <a href> still works as a fallback.
    if (typeof window.onPrizeClaim === "function") {
      try { window.onPrizeClaim("http://www.chicagofirefc.com/app/keepup-prize/"); } catch (e) { /* ignore */ }
    }
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 150); });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  resize();
  resetGame();
  draw();
})();
