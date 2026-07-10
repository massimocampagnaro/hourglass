/* ============================================================
   js/hourglass.js — Hourglass rendering + timer engine
   Vanilla JS, no dependencies. Builds an SVG glass silhouette
   from a single width-profile function, then derives the sand
   fill shapes from that same function so glass and sand always
   line up exactly.
   ============================================================ */

(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    // ─── Geometry constants (viewBox units) ────────────────────
    const VB_W = 320;
    const VB_H = 560;
    const CX = VB_W / 2;

    const CAP_TOP_Y = 46;
    const CAP_BOTTOM_Y = VB_H - 46;
    const NECK_Y = VB_H / 2;

    const RIM_HW = 82;
    const SHOULDER_HW = 102;
    const NECK_HW = 6;
    const SHOULDER_T = 0.32;   // fraction of half-span where the bulge peaks
    const FLIP_MS = 480;       // matches css var(--t-flip)
    // The pour starts once the spin has covered ~3/4 of its 180°, not once
    // it's fully upright — measured empirically since the css easing isn't
    // linear (0.56 of FLIP_MS lands right around 135° with the current
    // cubic-bezier). The last quarter-turn then finishes while sand is
    // already sliding, which reads fine since the shell is nearly upright
    // by that point — unlike starting the pour mid-spin at odd diagonals.
    const POUR_START_MS = FLIP_MS * 0.56;
    const TRANSFER_MIN_MS = 130; // pour-across duration for a near-empty bulb
    const TRANSFER_MAX_MS = 560; // pour-across duration for a nearly-full bulb

    const TOP_DIP_MAX = 9;
    const BOTTOM_PEAK_MAX = 15;
    const FILL_CAP = 0.86; // sand never fills more than this fraction of a
                            // bulb's geometric volume, so it never appears
                            // to touch the rim (top) or crowd the neck (bottom)

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

    // width profile: u=0 at rim, u=1 at neck -> returns half-width
    function widthProfile(u) {
        if (u <= SHOULDER_T) {
            const t = u / SHOULDER_T;
            return lerp(RIM_HW, SHOULDER_HW, smoothstep(t));
        }
        const t = (u - SHOULDER_T) / (1 - SHOULDER_T);
        return lerp(SHOULDER_HW, NECK_HW, smoothstep(t));
    }

    function halfWidthAt(y) {
        if (y <= NECK_Y) {
            const u = (y - CAP_TOP_Y) / (NECK_Y - CAP_TOP_Y);
            return widthProfile(clamp(u, 0, 1));
        }
        const v = (CAP_BOTTOM_Y - y) / (CAP_BOTTOM_Y - NECK_Y);
        return widthProfile(clamp(v, 0, 1));
    }

    // ─── Cumulative "area" tables for volume-correct sand levels ──
    function buildAreaTable(yLo, yHi, steps) {
        const ys = new Array(steps + 1);
        const hws = new Array(steps + 1);
        const cum = new Array(steps + 1);
        const dy = (yHi - yLo) / steps;
        cum[0] = 0;
        for (let i = 0; i <= steps; i++) {
            const y = yLo + dy * i;
            ys[i] = y;
            hws[i] = halfWidthAt(y);
            if (i > 0) cum[i] = cum[i - 1] + (hws[i - 1] + hws[i]) / 2 * dy;
        }
        return { ys, hws, cum, total: cum[steps] };
    }

    function findYForCum(table, target) {
        const t = clamp(target, 0, table.total);
        const { ys, cum } = table;
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] < t) lo = mid; else hi = mid;
        }
        const span = cum[hi] - cum[lo];
        const frac = span > 0 ? (t - cum[lo]) / span : 0;
        return lerp(ys[lo], ys[hi], frac);
    }

    // ─── Boundary point sampling (dense, used as straight segments) ──
    function sampleBoundary(yLo, yHi, step) {
        const pts = [];
        for (let y = yLo; y <= yHi; y += step) {
            pts.push({ x: CX + halfWidthAt(y), y });
        }
        pts.push({ x: CX + halfWidthAt(yHi), y: yHi });
        return pts;
    }

    function fmt(n) { return Math.round(n * 100) / 100; }

    function pointsToLineSegs(pts) {
        return pts.map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
    }

    function el(tag, attrs) {
        const e = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    }

    // ══════════════════════════════════════════════════════════
    class Hourglass {
        constructor(wrap) {
            this.wrap = wrap;
            this.durationMs = 5 * 60 * 1000;
            this.elapsedMs = 0;
            this.running = false;
            this.lastTs = null;
            this.rafId = null;
            this.flipDeg = 0;
            this.parity = 0; // toggles each flip: which bulb currently drains vs fills
            this.resetOnFlip = false;
            this._flipPending = false;
            this._flipTimeoutId = null;
            this._pourActive = false;
            this.onTick = null;
            this.onDone = null;
            this._done = false;
            this._pourTransfers = [];
            this._pourRafId = null;

            // full-glass boundary points (right side), split top/bottom
            this.rightTop = sampleBoundary(CAP_TOP_Y, NECK_Y, 4);
            this.rightBottom = sampleBoundary(NECK_Y, CAP_BOTTOM_Y, 4);

            this.topTable = buildAreaTable(CAP_TOP_Y, NECK_Y, 120);
            this.bottomTable = buildAreaTable(NECK_Y, CAP_BOTTOM_Y, 120);

            // bulb descriptors: fixed geometry, independent of which role
            // (drain/fill) each one is currently playing. isNeckFirst tells
            // whether the neck sits at the low-y or high-y end of `points`;
            // dir points from the neck toward this bulb's own rim.
            this.bulbs = {
                top: {
                    points: this.rightTop, table: this.topTable,
                    neckY: NECK_Y, rimY: CAP_TOP_Y, isNeckFirst: false,
                    dir: Math.sign(CAP_TOP_Y - NECK_Y),
                },
                bottom: {
                    points: this.rightBottom, table: this.bottomTable,
                    neckY: NECK_Y, rimY: CAP_BOTTOM_Y, isNeckFirst: true,
                    dir: Math.sign(CAP_BOTTOM_Y - NECK_Y),
                },
            };

            this._buildSvg();
            this._buildParticles();
            this._updateSand(0);
        }

        _buildSvg() {
            const svg = el('svg', {
                viewBox: `0 0 ${VB_W} ${VB_H}`,
                'aria-hidden': 'true',
            });

            const defs = el('defs', {});
            defs.innerHTML = `
                <linearGradient id="glassFill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="rgba(210,232,245,0.14)"/>
                    <stop offset="45%" stop-color="rgba(200,225,240,0.05)"/>
                    <stop offset="100%" stop-color="rgba(180,210,230,0.10)"/>
                </linearGradient>
                <linearGradient id="glassStroke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(225,240,250,0.85)"/>
                    <stop offset="50%" stop-color="rgba(190,215,232,0.35)"/>
                    <stop offset="100%" stop-color="rgba(225,240,250,0.85)"/>
                </linearGradient>
                <linearGradient id="sandGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--color-sand-light)"/>
                    <stop offset="60%" stop-color="var(--color-sand)"/>
                    <stop offset="100%" stop-color="var(--color-sand-dark)"/>
                </linearGradient>
                <radialGradient id="sandPileShade" cx="50%" cy="0%" r="85%">
                    <stop offset="0%" stop-color="rgba(255,240,210,0.35)"/>
                    <stop offset="100%" stop-color="rgba(120,70,20,0)"/>
                </radialGradient>
                <linearGradient id="streamGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--color-sand-light)" stop-opacity="0.95"/>
                    <stop offset="100%" stop-color="var(--color-sand-light)" stop-opacity="0.5"/>
                </linearGradient>
                <linearGradient id="highlightFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
                    <stop offset="30%" stop-color="rgba(255,255,255,0.3)"/>
                    <stop offset="70%" stop-color="rgba(255,255,255,0.3)"/>
                    <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
                </linearGradient>
                <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3.2" result="blur"/>
                    <feMerge>
                        <feMergeNode in="blur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            `;
            svg.appendChild(defs);

            // glass fill + outline (built once, static)
            const glassPath = el('path', {
                d: this._glassOutlineD(),
                fill: 'url(#glassFill)',
                stroke: 'url(#glassStroke)',
                'stroke-width': '3',
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
            });
            svg.appendChild(glassPath);

            // rim caps (subtle lip top & bottom)
            svg.appendChild(el('ellipse', {
                cx: CX, cy: CAP_TOP_Y, rx: RIM_HW, ry: 5,
                fill: 'none', stroke: 'rgba(225,240,250,0.55)', 'stroke-width': 2,
            }));
            svg.appendChild(el('ellipse', {
                cx: CX, cy: CAP_BOTTOM_Y, rx: RIM_HW, ry: 5,
                fill: 'none', stroke: 'rgba(225,240,250,0.55)', 'stroke-width': 2,
            }));

            // glossy highlight streaks (decorative, static) — trace the actual
            // bulb curvature, inset from the wall, faded at both ends
            svg.appendChild(el('path', {
                d: this._highlightD(this.rightTop, 0.72),
                fill: 'none', stroke: 'url(#highlightFade)', 'stroke-width': 6,
                'stroke-linecap': 'round',
            }));
            svg.appendChild(el('path', {
                d: this._highlightD(this.rightBottom, 0.72),
                fill: 'none', stroke: 'url(#highlightFade)', 'stroke-width': 6,
                'stroke-linecap': 'round',
            }));

            // sand (dynamic)
            this.sandTopPath = el('path', { fill: 'url(#sandGradient)' });
            this.sandTopShade = el('path', { fill: 'url(#sandPileShade)', opacity: 0.6 });
            this.sandBottomPath = el('path', { fill: 'url(#sandGradient)' });
            this.sandBottomShade = el('path', { fill: 'url(#sandPileShade)', opacity: 0.7 });
            svg.appendChild(this.sandTopPath);
            svg.appendChild(this.sandTopShade);
            svg.appendChild(this.sandBottomPath);
            svg.appendChild(this.sandBottomShade);

            // falling stream
            this.streamLine = el('line', {
                x1: CX, x2: CX, y1: NECK_Y - 4, y2: NECK_Y + 40,
                stroke: 'url(#streamGradient)', 'stroke-width': 2.4,
                'stroke-dasharray': '3 5', filter: 'url(#softGlow)',
            });
            svg.appendChild(this.streamLine);

            // re-draw glass outline stroke on top of sand at the neck so the
            // narrow waist always reads crisply over the falling stream
            svg.appendChild(el('path', {
                d: this._glassOutlineD(),
                fill: 'none',
                stroke: 'url(#glassStroke)',
                'stroke-width': '3',
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
                opacity: 0.9,
            }));

            this.wrap.insertBefore(svg, this.wrap.firstChild);
            this.svg = svg;
        }

        // a soft reflection that hugs one bulb's real curvature, inset from
        // the wall and clipped away from the rim/neck so it reads as a
        // floating streak of light rather than a straight ruled line
        _highlightD(sidePoints, inset) {
            const n = sidePoints.length;
            const from = Math.floor(n * 0.14);
            const to = Math.ceil(n * 0.8);
            const pts = sidePoints.slice(from, to)
                .map((p) => ({ x: CX - (p.x - CX) * inset, y: p.y }));
            return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} ` + pointsToLineSegs(pts.slice(1));
        }

        _glassOutlineD() {
            const rimTL = { x: CX - RIM_HW, y: CAP_TOP_Y };
            const rimTR = { x: CX + RIM_HW, y: CAP_TOP_Y };
            const rimBR = { x: CX + RIM_HW, y: CAP_BOTTOM_Y };
            const rimBL = { x: CX - RIM_HW, y: CAP_BOTTOM_Y };

            const rightPts = this.rightTop.concat(this.rightBottom.slice(1));
            const leftPts = rightPts.map((p) => ({ x: 2 * CX - p.x, y: p.y })).reverse();

            let d = `M ${fmt(rimTL.x)} ${fmt(rimTL.y)} L ${fmt(rimTR.x)} ${fmt(rimTR.y)} `;
            d += pointsToLineSegs(rightPts) + ' ';
            d += `L ${fmt(rimBL.x)} ${fmt(rimBL.y)} `;
            d += pointsToLineSegs(leftPts) + ' Z';
            return d;
        }

        // ─── Sand path builders ─────────────────────────────────
        // Generic across both bulbs and both roles: a bulb's own rim/neck
        // never change, but which ROLE (draining vs filling) each bulb
        // plays swaps with `parity` on every flip. `frontFrac` is 0 at
        // this bulb's rim and 1 at its neck, for either role — draining
        // sand always ends up on the neck side of the front, filling sand
        // always ends up on the rim side.
        _frontY(bulb, frontFrac) {
            frontFrac = clamp(frontFrac, 0, 1);
            const target = bulb.isNeckFirst
                ? bulb.table.total * (1 - frontFrac)
                : bulb.table.total * frontFrac;
            return findYForCum(bulb.table, target);
        }

        _bulbSandD(bulb, surfaceY, role, frontFrac, bumpMax) {
            const { points, isNeckFirst, neckY, rimY, dir } = bulb;
            surfaceY = clamp(surfaceY, Math.min(neckY, rimY), Math.max(neckY, rimY));

            const sandOnHighY = role === 'drain' ? !isNeckFirst : isNeckFirst;
            let pts = sandOnHighY
                ? points.filter((p) => p.y >= surfaceY)
                : points.filter((p) => p.y <= surfaceY);
            if (pts.length < 2) return '';
            if (!sandOnHighY) pts = pts.slice().reverse(); // normalize to [surface, ..., far]

            const leftPts = pts.map((p) => ({ x: 2 * CX - p.x, y: p.y })).reverse();
            const hwSurf = halfWidthAt(surfaceY);

            const distToNeck = Math.abs(surfaceY - neckY);
            const bump = bumpMax * (0.15 + 0.85 * frontFrac) * clamp(distToNeck / 40, 0, 1);
            const bumpY = surfaceY - bump * dir; // bump always leans toward the neck

            let d = `M ${fmt(CX - hwSurf)} ${fmt(surfaceY)} `;
            d += `Q ${fmt(CX)} ${fmt(bumpY)} ${fmt(CX + hwSurf)} ${fmt(surfaceY)} `;
            d += pointsToLineSegs(pts) + ' ';
            d += pointsToLineSegs(leftPts) + ' Z';
            return d;
        }

        _bulbShadeD(bulb, surfaceY, role) {
            const { neckY, rimY, dir } = bulb;
            surfaceY = clamp(surfaceY, Math.min(neckY, rimY), Math.max(neckY, rimY));
            const hwSurf = halfWidthAt(surfaceY);
            const shadeDir = role === 'drain' ? -dir : dir;
            const bandY = clamp(surfaceY + shadeDir * 36, Math.min(neckY, rimY), Math.max(neckY, rimY));
            const hwBand = halfWidthAt(bandY);
            return `M ${fmt(CX - hwSurf)} ${fmt(surfaceY)} ` +
                `L ${fmt(CX + hwSurf)} ${fmt(surfaceY)} ` +
                `L ${fmt(CX + hwBand)} ${fmt(bandY)} ` +
                `L ${fmt(CX - hwBand)} ${fmt(bandY)} Z`;
        }

        _updateSand(timeFrac) {
            timeFrac = clamp(timeFrac, 0, 1);
            const drainFrontFrac = 1 - FILL_CAP * (1 - timeFrac);
            const fillFrontFrac = FILL_CAP * timeFrac;

            const drainBulb = this.parity === 0 ? this.bulbs.top : this.bulbs.bottom;
            const fillBulb = this.parity === 0 ? this.bulbs.bottom : this.bulbs.top;
            const drainPath = this.parity === 0 ? this.sandTopPath : this.sandBottomPath;
            const drainShade = this.parity === 0 ? this.sandTopShade : this.sandBottomShade;
            const fillPath = this.parity === 0 ? this.sandBottomPath : this.sandTopPath;
            const fillShade = this.parity === 0 ? this.sandBottomShade : this.sandTopShade;

            const drainSurfaceY = this._frontY(drainBulb, drainFrontFrac);
            const fillSurfaceY = this._frontY(fillBulb, fillFrontFrac);

            drainPath.setAttribute('d', this._bulbSandD(drainBulb, drainSurfaceY, 'drain', drainFrontFrac, TOP_DIP_MAX));
            drainShade.setAttribute('d', this._bulbShadeD(drainBulb, drainSurfaceY, 'drain'));
            fillPath.setAttribute('d', this._bulbSandD(fillBulb, fillSurfaceY, 'fill', fillFrontFrac, BOTTOM_PEAK_MAX));
            fillShade.setAttribute('d', this._bulbShadeD(fillBulb, fillSurfaceY, 'fill'));

            // stream + grains always fall from the neck toward whichever
            // bulb is currently filling, in that bulb's own "toward rim" direction.
            // Suppressed while a post-flip pour is still settling, so the flow
            // only resumes once the sand has actually finished resettling.
            const streamOn = this.running && timeFrac < 1 && !this._pourActive;
            this.streamLine.setAttribute('y1', fmt(NECK_Y - fillBulb.dir * 4));
            this.streamLine.setAttribute('y2', fmt(fillSurfaceY - fillBulb.dir * 2));
            this.streamLine.style.opacity = streamOn ? '1' : '0';

            this._fillSurfaceY = fillSurfaceY;
            this._fillDir = fillBulb.dir;
        }

        // ─── Grain particles (canvas overlay) ──────────────────
        _buildParticles() {
            this.canvas = this.wrap.querySelector('.grain-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.particles = [];
            this._spawnAccum = 0;
            this._resizeCanvas();
            if (window.ResizeObserver) {
                new ResizeObserver(() => this._resizeCanvas()).observe(this.wrap);
            } else {
                window.addEventListener('resize', () => this._resizeCanvas());
            }
        }

        _resizeCanvas() {
            const rect = this.wrap.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
            this._scaleX = this.canvas.width / VB_W;
            this._scaleY = this.canvas.height / VB_H;
        }

        _stepParticles(dtMs) {
            const ctx = this.ctx;
            ctx.setTransform(this._scaleX, 0, 0, this._scaleY, 0, 0);
            ctx.clearRect(0, 0, VB_W, VB_H);

            // grains always fall from the neck toward whichever bulb is
            // currently filling — `dir` picks which way that is in SVG-space
            const dir = this._fillDir || 1;
            const fillSurfaceY = this._fillSurfaceY != null ? this._fillSurfaceY : NECK_Y;
            const landingY = dir > 0
                ? Math.max(NECK_Y + 6, fillSurfaceY - 6)
                : Math.min(NECK_Y - 6, fillSurfaceY + 6);
            const flowing = this.running && this.elapsedMs < this.durationMs && !this._pourActive;

            if (flowing) {
                this._spawnAccum += dtMs;
                const interval = 55;
                while (this._spawnAccum > interval && this.particles.length < 26) {
                    this._spawnAccum -= interval;
                    this.particles.push({
                        x: CX + (Math.random() - 0.5) * NECK_HW * 1.1,
                        y: NECK_Y - dir * 2,
                        vy: 40 * dir,
                        r: 1 + Math.random() * 1.1,
                    });
                }
            } else {
                this._spawnAccum = 0;
            }

            const dt = dtMs / 1000;
            ctx.fillStyle = '#fbe3a6';
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.vy += 260 * dt * dir;
                p.y += p.vy * dt;
                if (dir > 0 ? p.y >= landingY : p.y <= landingY) {
                    this.particles.splice(i, 1);
                    continue;
                }
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // ─── Timer control ──────────────────────────────────────
        setDuration(minutes) {
            this.durationMs = Math.max(1, minutes) * 60 * 1000;
            if (!this.running) {
                this.elapsedMs = 0;
                this._done = false;
                this._updateSand(0);
                this._notifyTick();
            }
        }

        start() {
            if (this.running || this._done) return;
            this.running = true;
            this.lastTs = null;
            this.rafId = requestAnimationFrame((t) => this._loop(t));
        }

        pause() {
            this.running = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        reset() {
            if (this._flipTimeoutId) {
                clearTimeout(this._flipTimeoutId);
                this._flipTimeoutId = null;
                this._flipPending = false;
            }
            this.pause();
            this.elapsedMs = 0;
            this._done = false;
            this._updateSand(0);
            this._clearParticles();
            this._notifyTick();
        }

        // A real flip does two independent things: (1) mirrors elapsed
        // time around the duration, which alone reproduces the correct
        // sand AMOUNTS on each side (the bulbs are geometrically
        // symmetric, so _updateSand(f) and _updateSand(1-f) are mirror
        // images); and (2) swaps which bulb currently plays the
        // draining vs filling role, so sand keeps flowing top-to-bottom
        // on screen instead of reversing once the 180° rotation puts
        // the other bulb on top.
        //
        // Physically, flipping doesn't just relabel each bulb — gravity
        // reverses for whatever sand was already sitting in it, so it
        // slides/pours across to the opposite end of that same bulb
        // (the bit that hadn't drained yet settles onto the rim; the
        // bit that had piled up slides off toward the neck). That pour
        // is what actually gets animated, per bulb, in _pourTransfer.
        // Sequenced in two phases so each part reads clearly on its own:
        // (1) the shell spins — sand stays exactly as it was, like a
        // quick rigid flip too fast for anything to shift; (2) once it's
        // upright again, the sand actually pours/settles into place.
        // Doing both at once (spinning through odd diagonal angles while
        // sand is also reorganizing) is what looked like noise before.
        flip() {
            if (this._flipPending) return;
            this._flipPending = true;

            const oldTimeFrac = clamp(this.elapsedMs / this.durationMs, 0, 1);
            const oldParity = this.parity;
            const oldDrainKey = oldParity === 0 ? 'top' : 'bottom';
            const oldFillKey = oldParity === 0 ? 'bottom' : 'top';
            const oldDrainFrontFrac = 1 - FILL_CAP * (1 - oldTimeFrac);
            const oldFillFrontFrac = FILL_CAP * oldTimeFrac;

            this.flipDeg += 180;
            this.wrap.parentElement.style.transform = `rotate(${this.flipDeg}deg)`;
            this.pause();

            this._flipTimeoutId = setTimeout(() => {
                this._flipPending = false;
                this._flipTimeoutId = null;
                this.parity = 1 - this.parity;
                this.elapsedMs = this.resetOnFlip ? 0 : clamp(this.durationMs - this.elapsedMs, 0, this.durationMs);
                this._done = false;
                this._updateSand(this.elapsedMs / this.durationMs); // live paths jump to the final state, hidden underneath
                this._clearParticles();
                this._notifyTick();

                this._cancelPourTransfers();
                if (this.resetOnFlip) {
                    this._pourActive = true;
                    setTimeout(() => { this._pourActive = false; }, FLIP_MS);
                    this._snapshotSandForCrossfade(FLIP_MS);
                } else {
                    this._startPourTransfer(oldDrainKey, 'drain', oldDrainFrontFrac);
                    this._startPourTransfer(oldFillKey, 'fill', oldFillFrontFrac);
                }

                this.start();
            }, POUR_START_MS);
        }

        _snapshotSandForCrossfade(durationMs) {
            const clones = [this.sandTopPath, this.sandTopShade, this.sandBottomPath, this.sandBottomShade]
                .map((node) => node.cloneNode(true));
            clones.forEach((node) => {
                node.style.transition = `opacity ${durationMs}ms ease`;
                node.style.opacity = '1';
                // insert above the live sand but below the neck stroke/stream
                this.svg.insertBefore(node, this.streamLine);
            });
            // force layout so the browser registers opacity:1 before we
            // transition to 0 — otherwise the change gets coalesced away
            void clones[0].getBoundingClientRect();
            requestAnimationFrame(() => {
                clones.forEach((node) => { node.style.opacity = '0'; });
            });
            setTimeout(() => {
                clones.forEach((node) => node.remove());
            }, durationMs + 60);
        }

        _bulbPaths(key) {
            return key === 'top'
                ? { path: this.sandTopPath, shade: this.sandTopShade }
                : { path: this.sandBottomPath, shade: this.sandBottomShade };
        }

        // A slab of sand of fixed width (`transferAmount`, in frontFrac
        // units) sitting at one extreme of the bulb (rim if it was
        // 'fill', neck if it was 'drain') and rigidly sliding across to
        // rest at the OPPOSITE extreme. Because both ends of the slab
        // move by the same lerp, its width never changes — one
        // continuous connected mass the whole time, no gap opening up
        // in the middle (which is what made the previous shrink+grow
        // version, with two independently-sized regions, look like sand
        // vanishing from one spot and reappearing from nowhere in another).
        // Same constant "gravity" throughout — duration scales with sqrt of
        // the DISTANCE the slab's centre has to travel, not with how much
        // sand there is. A slab that already fills most of the bulb barely
        // has to move (both its ends are already close to their targets);
        // a thin sliver has to cross almost the whole bulb to reach the
        // opposite end. Distance (in frontFrac units) is (1 - width).
        _startPourTransfer(bulbKey, oldRole, oldFrontFrac) {
            const bulb = this.bulbs[bulbKey];
            const newRole = oldRole === 'drain' ? 'fill' : 'drain';
            const transferAmount = clamp(oldRole === 'drain' ? 1 - oldFrontFrac : oldFrontFrac, 0, 1);
            const travelDistance = clamp(1 - transferAmount, 0, 1);
            const duration = TRANSFER_MIN_MS
                + (TRANSFER_MAX_MS - TRANSFER_MIN_MS) * Math.sqrt(travelDistance);

            const oldLo = oldRole === 'drain' ? oldFrontFrac : 0;
            const oldHi = oldRole === 'drain' ? 1 : oldFrontFrac;
            const newLo = newRole === 'drain' ? 1 - transferAmount : 0;
            const newHi = newRole === 'drain' ? 1 : transferAmount;

            const live = this._bulbPaths(bulbKey);
            live.path.style.opacity = '0';
            live.shade.style.opacity = '0';

            const slabPath = el('path', { fill: 'url(#sandGradient)' });
            this.svg.insertBefore(slabPath, this.streamLine);

            const startTs = performance.now();
            const transfer = {
                bulbKey, live, slabPath,
                tick: (now) => {
                    const t = clamp((now - startTs) / duration, 0, 1);
                    const p = smoothstep(t); // eases in and out — no abrupt snap at either end
                    const lo = lerp(oldLo, newLo, p);
                    const hi = lerp(oldHi, newHi, p);
                    slabPath.setAttribute('d', this._bulbSlabD(bulb, lo, hi));
                    return t >= 1;
                },
                finish: () => {
                    slabPath.remove();
                    live.path.style.opacity = '';
                    live.shade.style.opacity = '';
                },
            };
            this._pourActive = true;
            this._pourTransfers.push(transfer);
            this._ensurePourLoop();
        }

        // Renders the sand between two frontFrac bounds (0=rim,1=neck)
        // as one plain contiguous region — used only for the sliding
        // transfer slab, which doesn't need the dip/peak surface bump
        // that the live drain/fill rendering has.
        _bulbSlabD(bulb, loFrontFrac, hiFrontFrac) {
            const yA = this._frontY(bulb, clamp(loFrontFrac, 0, 1));
            const yB = this._frontY(bulb, clamp(hiFrontFrac, 0, 1));
            const yTop = Math.min(yA, yB);
            const yBottom = Math.max(yA, yB);
            const pts = bulb.points.filter((p) => p.y >= yTop && p.y <= yBottom);
            if (pts.length < 2) return '';
            const leftPts = pts.map((p) => ({ x: 2 * CX - p.x, y: p.y })).reverse();
            return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} `
                + pointsToLineSegs(pts.slice(1)) + ' '
                + pointsToLineSegs(leftPts) + ' Z';
        }

        _ensurePourLoop() {
            if (this._pourRafId) return;
            const step = (now) => {
                for (let i = this._pourTransfers.length - 1; i >= 0; i--) {
                    const tr = this._pourTransfers[i];
                    const done = tr.tick(now);
                    if (done) {
                        tr.finish();
                        this._pourTransfers.splice(i, 1);
                    }
                }
                if (this._pourTransfers.length) {
                    this._pourRafId = requestAnimationFrame(step);
                } else {
                    this._pourRafId = null;
                    this._pourActive = false;
                }
            };
            this._pourRafId = requestAnimationFrame(step);
        }

        _cancelPourTransfers() {
            if (this._pourRafId) cancelAnimationFrame(this._pourRafId);
            this._pourRafId = null;
            this._pourActive = false;
            this._pourTransfers.splice(0).forEach((tr) => tr.finish());
        }

        _clearParticles() {
            this.particles.length = 0;
            this._spawnAccum = 0;
            this._stepParticles(0);
        }

        _loop(ts) {
            if (!this.running) return;
            if (this.lastTs == null) this.lastTs = ts;
            const dt = ts - this.lastTs;
            this.lastTs = ts;

            this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + dt);
            const timeFrac = this.elapsedMs / this.durationMs;
            this._updateSand(timeFrac);
            this._stepParticles(dt);
            this._notifyTick();

            // once time's up, keep animating (no new grains spawn — the
            // stream/flowing checks already key off elapsedMs<durationMs)
            // until every grain still in the air has landed, then finish
            if (this.elapsedMs >= this.durationMs && this.particles.length === 0) {
                this.running = false;
                this._done = true;
                if (this.onDone) this.onDone();
                return;
            }
            this.rafId = requestAnimationFrame((t) => this._loop(t));
        }

        _notifyTick() {
            if (this.onTick) {
                this.onTick(this.durationMs - this.elapsedMs, this.elapsedMs / this.durationMs);
            }
        }
    }

    window.Hourglass = Hourglass;
})();
