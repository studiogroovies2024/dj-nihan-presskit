/* ===================================================================
   DJ NIHAN — Press Kit / interactions
   - directed hero entrance is pure CSS; this drives the live layer:
   - continuous scroll fade in/out + parallax depth (one rAF loop)
   - decode/scramble section titles, typewriter hero sub-line
   - staggered gallery reveal, ambient drifting shards, cursor glow
   - click-to-enlarge lightbox
   Respects prefers-reduced-motion; degrades gracefully without JS.
   Never leaves content stuck hidden (motion runs in try/catch).
   =================================================================== */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  /* ---- current year in footer ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- themed preloader: fade out once everything (images, fonts, iframe) loads ---- */
  (function () {
    var pre = document.getElementById("preloader");
    if (!pre) return;
    var MIN_VISIBLE = 1200; // keep it on screen long enough to be seen on instant loads
    var startT = (window.performance && performance.now) ? performance.now() : Date.now();
    var done = false;
    var hide = function () {
      if (done) return;
      done = true;
      pre.classList.add("is-hidden");
      window.setTimeout(function () {
        if (pre.parentNode) pre.parentNode.removeChild(pre);
      }, 700);
    };
    // Hide only after BOTH the load event AND the minimum display time have passed.
    var scheduleHide = function () {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      window.setTimeout(hide, Math.max(0, MIN_VISIBLE - (now - startT)));
    };
    if (document.readyState === "complete") scheduleHide();
    else window.addEventListener("load", scheduleHide);
    // safety net: never trap the user if a resource stalls
    window.setTimeout(hide, 7000);
  })();

  /* Tell the inline head safety-net that JS has taken over reveals. */
  window.__revealReady = true;

  var revealEls = [].slice.call(document.querySelectorAll(".reveal"));
  var staggerEls = [].slice.call(document.querySelectorAll(".stagger"));
  var titleEls = [].slice.call(document.querySelectorAll(".section-title"));
  var heroSub = document.querySelector(".hero-sub");
  var heroSubFull = heroSub ? heroSub.textContent : "";

  /* Fallback that guarantees nothing is left hidden. */
  function showEverything() {
    revealEls.forEach(function (el) { el.style.opacity = "1"; el.style.transform = "none"; });
    staggerEls.forEach(function (el) { el.classList.add("is-visible"); });
    if (heroSub) {
      heroSub.classList.remove("is-typing");
      if (!heroSub.textContent) heroSub.textContent = heroSubFull;
    }
  }

  if (prefersReduced) {
    showEverything();
  } else {
    try { initMotion(); }
    catch (err) { showEverything(); }
  }

  /* =============================================================
     MOTION LAYER
     ============================================================= */
  function initMotion() {
    /* ---- staggered grids: one-shot dramatic reveal ---- */
    if ("IntersectionObserver" in window) {
      var staggerIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          // re-fire every time it scrolls back into view (not one-shot)
          if (e.isIntersecting) e.target.classList.add("is-visible");
          else e.target.classList.remove("is-visible");
        });
      }, { threshold: 0, rootMargin: "0px 0px -10% 0px" });
      staggerEls.forEach(function (el) { staggerIO.observe(el); });
      window.__nihanStaggerIO = staggerIO;

      /* ---- decode/scramble titles as they scroll into view (replays on re-entry) ---- */
      var titleIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) decode(e.target);
          else resetDecode(e.target);
        });
      }, { threshold: 0.55 });
      titleEls.forEach(function (el) { titleIO.observe(el); });
      window.__nihanTitleIO = titleIO;
    } else {
      staggerEls.forEach(function (el) { el.classList.add("is-visible"); });
    }

    /* ---- typewriter the hero sub-line (last beat of the entrance) ---- */
    if (heroSub) typewriter(heroSub, heroSubFull, 1700);

    /* ---- desktop cursor-reactive red glow ---- */
    var glow = null, gx = 0, gy = 0, gtx = 0, gty = 0;
    if (canHover) {
      glow = document.createElement("div");
      glow.className = "cursor-glow";
      glow.setAttribute("aria-hidden", "true");
      document.body.appendChild(glow);
      gx = gtx = window.innerWidth / 2;
      gy = gty = window.innerHeight / 2;
      window.addEventListener("pointermove", function (e) {
        gtx = e.clientX; gty = e.clientY;
        if (!glow.classList.contains("is-active")) glow.classList.add("is-active");
      }, { passive: true });
      window.addEventListener("pointerleave", function () { glow.classList.remove("is-active"); });
    }

    /* ---- ambient shards + cursor reaction state ---- */
    var shards = [].slice.call(document.querySelectorAll(".shard"));
    var hero = document.querySelector(".hero");
    var heroBg = document.querySelector(".hero-bg");
    var cutout = document.querySelector(".hero-cutout");
    var scrollHint = document.querySelector(".scroll-hint");

    var bases = shards.map(function (s) {
      var m = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(s.style.transform || "");
      return m ? parseFloat(m[1]) : 0;
    });
    var drift = shards.map(function (_, i) {
      return { amp: 7 + i * 2.5, sp: 0.0004 + i * 0.00012, ph: i * 1.7 };
    });

    var targetX = 0, targetY = 0, curX = 0, curY = 0;
    if (hero) {
      hero.addEventListener("pointermove", function (e) {
        var r = hero.getBoundingClientRect();
        targetX = ((e.clientX - r.left) / r.width - 0.5) * 2;
        targetY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      });
      hero.addEventListener("pointerleave", function () { targetX = 0; targetY = 0; });
    }

    var lastScroll = -1;

    /* ---- only the sections near the viewport get per-frame work ----
       A generous-margin observer keeps an "active" subset; far-off sections
       sit at their resting state and are skipped entirely. will-change is
       added only while a section is active, and removed afterwards. */
    var activeReveals = revealEls.slice(); // start with all so the first paint is correct
    var heroInView = true;
    if ("IntersectionObserver" in window) {
      var nearIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var el = e.target, idx = activeReveals.indexOf(el);
          if (e.isIntersecting) {
            if (idx === -1) { activeReveals.push(el); el.style.willChange = "opacity, transform"; }
          } else if (idx !== -1) {
            activeReveals.splice(idx, 1);
            el.style.willChange = "auto";
          }
        });
        lastScroll = -1; // force one recompute so the set change is applied
      }, { rootMargin: "100% 0px 100% 0px", threshold: 0 });
      revealEls.forEach(function (el) { nearIO.observe(el); });

      if (hero) {
        var heroIO = new IntersectionObserver(function (es) {
          heroInView = es[0].isIntersecting;
          hero.classList.toggle("hero-offscreen", !heroInView);
        }, { threshold: 0 });
        heroIO.observe(hero);
      }
    }

    /* ---- section fade IN and OUT (floored so content never hides) ----
       Reads are batched before writes so a transform write never forces the
       next read to reflow (no layout thrash). */
    var rectCache = [];
    function updateSections(vh) {
      var list = activeReveals, n = list.length, i;
      for (i = 0; i < n; i++) rectCache[i] = list[i].getBoundingClientRect();
      for (i = 0; i < n; i++) {
        var r = rectCache[i];
        // enter: 0 when top is ~one screen down, 1 once it's comfortably up
        var enter = clamp((0.92 * vh - r.top) / (0.37 * vh), 0, 1);
        // exit: stays 1 while bottom is on screen, ramps to 0 as it leaves the top
        var exit = clamp(r.bottom / (0.22 * vh), 0, 1);
        var vis = Math.min(enter, exit);
        vis = vis * vis * (3 - 2 * vis); // smoothstep
        var op = 0.35 + 0.65 * vis;      // FLOOR 0.35 — never below the readable threshold
        var y = (1 - enter) * 26 - (1 - exit) * 22;
        list[i].style.opacity = op.toFixed(3);
        list[i].style.transform = "translate3d(0," + y.toFixed(1) + "px,0)";
      }
    }

    /* ---- single rAF loop: scroll choreography + parallax + ambient ---- */
    var rafId = 0;
    function frame(now) {
      var vh = window.innerHeight;
      var sy = window.pageYOffset || 0;

      if (sy !== lastScroll) {
        updateSections(vh);
        // background layers move slower than foreground = parallax depth
        if (heroBg) heroBg.style.transform = "translate3d(0," + (sy * 0.28).toFixed(1) + "px,0)";
        if (cutout) {
          var cy = Math.max(-70, -sy * 0.08);
          cutout.style.transform = "translate3d(0," + cy.toFixed(1) + "px,0)";
        }
        if (scrollHint) scrollHint.style.opacity = clamp(1 - sy / 280, 0, 1).toFixed(3);
        lastScroll = sy;
      }

      // ambient shard drift + cursor reaction — only while the hero is on screen
      if (heroInView) {
        curX += (targetX - curX) * 0.06;
        curY += (targetY - curY) * 0.06;
        for (var i = 0; i < shards.length; i++) {
          var d = drift[i];
          var dx = Math.sin(now * d.sp + d.ph) * d.amp;
          var dy = Math.cos(now * d.sp * 0.8 + d.ph) * d.amp;
          var depth = (i + 1) * 6;
          var tx = dx + curX * depth;
          var ty = dy + curY * depth + sy * (0.02 + i * 0.01);
          shards[i].style.transform =
            "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0) rotate(" + bases[i] + "deg)";
        }
      }

      // cursor glow follows the pointer with a soft lag (only while active)
      if (glow && glow.classList.contains("is-active")) {
        gx += (gtx - gx) * 0.16;
        gy += (gty - gy) * 0.16;
        glow.style.transform = "translate3d(" + gx.toFixed(1) + "px," + gy.toFixed(1) + "px,0)";
      }

      rafId = requestAnimationFrame(frame);
    }

    updateSections(window.innerHeight); // immediate pass so nothing starts hidden
    lastScroll = window.pageYOffset || 0;
    rafId = requestAnimationFrame(frame);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { cancelAnimationFrame(rafId); }
      else { lastScroll = -1; rafId = requestAnimationFrame(frame); }
    });
    window.addEventListener("resize", function () { lastScroll = -1; });
  }

  /* ---- decode / scramble effect (preserves nested <span> structure) ----
     Replays each time the title re-enters view. A longer duration + slight
     ease-out settle makes it read smoother and more high-end. */
  function decode(el) {
    if (el.dataset.decoding === "1" || el.dataset.decoded === "1") return;
    el.dataset.decoding = "1";
    // Pin the real text for assistive tech so the visual scramble is never
    // announced (headings are referenced by aria-labelledby on their sections).
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*<>/\\";
    var nodes = [];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (c.nodeValue.trim()) nodes.push(c); }
        else if (c.nodeType === 1) walk(c);
      }
    })(el);
    if (!nodes.length) { el.dataset.decoding = ""; return; }
    var segs = nodes.map(function (n) { return { node: n, text: n.nodeValue }; });
    var total = segs.reduce(function (a, s) { return a + s.text.length; }, 0);
    var start = 0;
    var DUR = 1100;
    function step(now) {
      if (!start) start = now;
      var p = clamp((now - start) / DUR, 0, 1);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out: glyphs settle smoothly
      var revealed = eased * total;
      var gi = 0;
      for (var s = 0; s < segs.length; s++) {
        var t = segs[s].text, out = "";
        for (var k = 0; k < t.length; k++) {
          var ch = t.charAt(k);
          if (ch === " " || ch === "\u00a0") out += ch;
          else if (gi < revealed) out += ch;
          else out += GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
          gi++;
        }
        segs[s].node.nodeValue = out;
      }
      if (p < 1) requestAnimationFrame(step);
      else {
        for (var j = 0; j < segs.length; j++) segs[j].node.nodeValue = segs[j].text;
        el.dataset.decoding = "";
        el.dataset.decoded = "1";
      }
    }
    requestAnimationFrame(step);
  }

  /* Allow a title to scramble again the next time it scrolls back into view. */
  function resetDecode(el) {
    if (el.dataset.decoding === "1") return; // don't interrupt a running pass
    el.dataset.decoded = "";
  }

  /* ---- typewriter ---- */
  function typewriter(el, full, delay) {
    el.setAttribute("aria-label", full); // stable name while it types out
    el.textContent = "";
    el.classList.add("is-typing");
    var i = 0;
    setTimeout(function start() {
      (function tick() {
        if (i <= full.length) {
          el.textContent = full.slice(0, i);
          i++;
          setTimeout(tick, 22 + Math.random() * 38);
        } else {
          setTimeout(function () { el.classList.remove("is-typing"); }, 600);
        }
      })();
    }, delay);
  }

  /* ---- lightbox (click-to-enlarge) ---- */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var triggers = [].slice.call(document.querySelectorAll(".tile-btn"));

  if (lightbox && lightboxImg && triggers.length) {
    var closeBtn = lightbox.querySelector(".lightbox-close");
    var lastFocused = null;

    var openLightbox = function (img) {
      lastFocused = document.activeElement;
      lightboxImg.setAttribute("src", img.currentSrc || img.src);
      lightboxImg.setAttribute("alt", img.getAttribute("alt") || "");
      lightbox.hidden = false;
      requestAnimationFrame(function () { lightbox.classList.add("is-open"); });
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKeydown);
      if (closeBtn) closeBtn.focus();
    };

    var closeLightbox = function () {
      lightbox.classList.remove("is-open");
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = "";
      var finish = function () {
        lightbox.hidden = true;
        lightboxImg.setAttribute("src", "");
        lightbox.removeEventListener("transitionend", finish);
      };
      if (prefersReduced) { finish(); }
      else { lightbox.addEventListener("transitionend", finish); }
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };

    var onKeydown = function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }
      else if (e.key === "Tab" && closeBtn) { e.preventDefault(); closeBtn.focus(); }
    };

    triggers.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var img = btn.querySelector("img");
        if (img) openLightbox(img);
      });
    });
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) closeLightbox();
    });
  }

  /* =============================================================
     PREMIUM SMOOTH SCROLL (eased) for in-page anchor links
     Gentle easeInOutCubic glide; offsets for the fixed nav.
     Falls back to native CSS scroll for reduced-motion users.
     ============================================================= */
  if (!prefersReduced) {
    // We drive scrolling per-frame, so disable CSS smooth to avoid a tug-of-war.
    document.documentElement.style.scrollBehavior = "auto";

    var navEl = document.querySelector(".site-nav");
    var easeInOutCubic = function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    var glideTo = function (targetY) {
      var startY = window.pageYOffset || 0;
      var diff = targetY - startY;
      if (Math.abs(diff) < 2) return;
      // duration scales gently with distance, kept in a premium 0.6s–1.2s window
      var duration = clamp(420 + Math.abs(diff) * 0.32, 600, 1200);
      var start = 0;
      var step = function (now) {
        if (!start) start = now;
        var p = clamp((now - start) / duration, 0, 1);
        window.scrollTo(0, startY + diff * easeInOutCubic(p));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var hash = link.getAttribute("href");
      if (!hash || hash === "#") return;
      var target = hash === "#top" ? document.body : document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      var navH = navEl ? navEl.getBoundingClientRect().height : 0;
      var top = hash === "#top"
        ? 0
        : target.getBoundingClientRect().top + (window.pageYOffset || 0) - navH - 18;
      glideTo(Math.max(0, top));
      if (history.replaceState) history.replaceState(null, "", hash);
    });
  }
})();
