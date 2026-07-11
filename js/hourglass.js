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
    const VIEWBOX_WIDTH = 320;
    const VIEWBOX_HEIGHT = 560;
    const CENTER_X = VIEWBOX_WIDTH / 2;

    const TOP_RIM_Y = 46;
    const BOTTOM_RIM_Y = VIEWBOX_HEIGHT - 46;
    const NECK_Y = VIEWBOX_HEIGHT / 2;

    const RIM_HALF_WIDTH = 82;
    const SHOULDER_HALF_WIDTH = 102;
    const NECK_HALF_WIDTH = 6;
    const SHOULDER_FRACTION = 0.32; // how far down the rim-to-neck span the bulge peaks (0=rim, 1=neck)

    const SPIN_DURATION_MS = 480; // matches css var(--t-flip)
    // The pour starts once the spin has covered ~3/4 of its 180°, not once
    // it's fully upright — measured empirically since the css easing isn't
    // linear (0.56 of SPIN_DURATION_MS lands right around 135° with the
    // current cubic-bezier). The last quarter-turn then finishes while sand
    // is already sliding, which reads fine since the shell is nearly
    // upright by that point — unlike starting the pour mid-spin at odd
    // diagonal angles.
    const POUR_START_DELAY_MS = SPIN_DURATION_MS * 0.56;
    const TRANSFER_MIN_MS = 130; // pour-across duration for a near-empty bulb
    const TRANSFER_MAX_MS = 560; // pour-across duration for a nearly-full bulb

    const DRAIN_DIP_MAX = 9;   // max crater depth on a draining surface
    const FILL_PEAK_MAX = 15;  // max mound height on a filling surface

    // Grain physics integrates velocity/position step by step, so it falls
    // apart with a huge dt — e.g. after the tab was backgrounded, browsers
    // throttle or fully pause requestAnimationFrame, and the first frame
    // back can report a multi-second gap. Fed straight into the physics,
    // that reads as grains rocketing far past where they should land in a
    // single step (seen as big, sparse, slow-looking "discs" once things
    // catch up). The sand LEVEL itself is unaffected since it's computed
    // straight from absolute elapsed time, not integrated incrementally —
    // only this per-frame particle step needs a sanity cap.
    const MAX_PARTICLE_FRAME_MS = 50;
    const MAX_FILL_FRACTION = 0.86; // sand never fills more than this fraction of a
                                     // bulb's geometric volume, so it never appears
                                     // to touch the rim (top) or crowd the neck (bottom)

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(value, lo, hi) { return value < lo ? lo : value > hi ? hi : value; }
    function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

    // Half-width of the glass between rim and neck.
    // neckProgress: 0 at the rim, 1 at the neck.
    function halfWidthProfile(neckProgress) {
        if (neckProgress <= SHOULDER_FRACTION) {
            const t = neckProgress / SHOULDER_FRACTION;
            return lerp(RIM_HALF_WIDTH, SHOULDER_HALF_WIDTH, smoothstep(t));
        }
        const t = (neckProgress - SHOULDER_FRACTION) / (1 - SHOULDER_FRACTION);
        return lerp(SHOULDER_HALF_WIDTH, NECK_HALF_WIDTH, smoothstep(t));
    }

    // Half-width of the glass at an absolute SVG y — picks the top or
    // bottom bulb's profile depending on which side of the neck we're on.
    function halfWidthAt(y) {
        if (y <= NECK_Y) {
            const neckProgress = (y - TOP_RIM_Y) / (NECK_Y - TOP_RIM_Y);
            return halfWidthProfile(clamp(neckProgress, 0, 1));
        }
        const neckProgress = (BOTTOM_RIM_Y - y) / (BOTTOM_RIM_Y - NECK_Y);
        return halfWidthProfile(clamp(neckProgress, 0, 1));
    }

    // ─── Cumulative "area" tables for volume-correct sand levels ──
    // Builds a lookup table of (y, cumulative area) samples by integrating
    // the glass's width from yStart to yEnd. This lets us convert "how much
    // of this bulb's volume is filled" into an actual y coordinate, so sand
    // levels move at a physically plausible (non-linear) rate instead of
    // just interpolating height in a straight line.
    function buildAreaTable(yStart, yEnd, steps) {
        const sampledYs = new Array(steps + 1);
        const sampledHalfWidths = new Array(steps + 1);
        const cumulativeArea = new Array(steps + 1);
        const dy = (yEnd - yStart) / steps;
        cumulativeArea[0] = 0;
        for (let i = 0; i <= steps; i++) {
            const y = yStart + dy * i;
            sampledYs[i] = y;
            sampledHalfWidths[i] = halfWidthAt(y);
            if (i > 0) {
                cumulativeArea[i] = cumulativeArea[i - 1]
                    + (sampledHalfWidths[i - 1] + sampledHalfWidths[i]) / 2 * dy;
            }
        }
        return { sampledYs, cumulativeArea, totalArea: cumulativeArea[steps] };
    }

    // Inverse lookup: given a target cumulative area, find the y where the
    // table's running total reaches it (binary search, then interpolate
    // between the two bracketing samples for sub-step precision).
    function yForCumulativeArea(table, targetArea) {
        const clampedTarget = clamp(targetArea, 0, table.totalArea);
        const { sampledYs, cumulativeArea } = table;
        let lo = 0, hi = cumulativeArea.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cumulativeArea[mid] < clampedTarget) lo = mid; else hi = mid;
        }
        const span = cumulativeArea[hi] - cumulativeArea[lo];
        const frac = span > 0 ? (clampedTarget - cumulativeArea[lo]) / span : 0;
        return lerp(sampledYs[lo], sampledYs[hi], frac);
    }

    // ─── Boundary point sampling (dense, used as straight segments) ──
    // Samples the glass wall's right-hand edge into closely-spaced points.
    // Dense enough (every 4 units) that plain straight segments between
    // them read as a smooth curve — no actual bezier math needed.
    function sampleWallPoints(yStart, yEnd, stepY) {
        const points = [];
        for (let y = yStart; y <= yEnd; y += stepY) {
            points.push({ x: CENTER_X + halfWidthAt(y), y });
        }
        points.push({ x: CENTER_X + halfWidthAt(yEnd), y: yEnd });
        return points;
    }

    function roundCoord(n) { return Math.round(n * 100) / 100; }

    function pointsToLineSegments(points) {
        return points.map((p) => `L ${roundCoord(p.x)} ${roundCoord(p.y)}`).join(' ');
    }

    function createSvgElement(tag, attrs) {
        const element = document.createElementNS(SVG_NS, tag);
        for (const key in attrs) element.setAttribute(key, attrs[key]);
        return element;
    }

    // ══════════════════════════════════════════════════════════
    class Hourglass {
        constructor(wrap) {
            this.wrap = wrap;
            this.durationMs = 5 * 60 * 1000;
            this.elapsedMs = 0;
            this.running = false;
            this.lastFrameTimestamp = null;
            this.rafId = null;
            this.flipRotationDeg = 0;
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
            this.rightTopPoints = sampleWallPoints(TOP_RIM_Y, NECK_Y, 4);
            this.rightBottomPoints = sampleWallPoints(NECK_Y, BOTTOM_RIM_Y, 4);

            this.topAreaTable = buildAreaTable(TOP_RIM_Y, NECK_Y, 120);
            this.bottomAreaTable = buildAreaTable(NECK_Y, BOTTOM_RIM_Y, 120);

            // Bulb descriptors: fixed geometry, independent of which role
            // (drain/fill) each one is currently playing. isNeckFirst tells
            // whether the neck sits at the low-y or high-y end of `points`;
            // towardRimSign is +1/-1, pointing from the neck toward this
            // bulb's own rim in SVG y-space.
            this.bulbs = {
                top: {
                    points: this.rightTopPoints, areaTable: this.topAreaTable,
                    neckY: NECK_Y, rimY: TOP_RIM_Y, isNeckFirst: false,
                    towardRimSign: Math.sign(TOP_RIM_Y - NECK_Y),
                },
                bottom: {
                    points: this.rightBottomPoints, areaTable: this.bottomAreaTable,
                    neckY: NECK_Y, rimY: BOTTOM_RIM_Y, isNeckFirst: true,
                    towardRimSign: Math.sign(BOTTOM_RIM_Y - NECK_Y),
                },
            };

            this._buildSvg();
            this._buildParticles();
            this._updateSand(0);
        }

        _buildSvg() {
            const svg = createSvgElement('svg', {
                viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
                'aria-hidden': 'true',
            });

            const defs = createSvgElement('defs', {});
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

            // glass fill + outline (built once, static — never touched again)
            const glassPath = createSvgElement('path', {
                d: this._glassOutlineD(),
                fill: 'url(#glassFill)',
                stroke: 'url(#glassStroke)',
                'stroke-width': '3',
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
            });
            svg.appendChild(glassPath);

            // rim caps (subtle lip top & bottom)
            svg.appendChild(createSvgElement('ellipse', {
                cx: CENTER_X, cy: TOP_RIM_Y, rx: RIM_HALF_WIDTH, ry: 5,
                fill: 'none', stroke: 'rgba(225,240,250,0.55)', 'stroke-width': 2,
            }));
            svg.appendChild(createSvgElement('ellipse', {
                cx: CENTER_X, cy: BOTTOM_RIM_Y, rx: RIM_HALF_WIDTH, ry: 5,
                fill: 'none', stroke: 'rgba(225,240,250,0.55)', 'stroke-width': 2,
            }));

            // glossy highlight streaks (decorative, static) — trace the actual
            // bulb curvature, inset from the wall, faded at both ends
            svg.appendChild(createSvgElement('path', {
                d: this._highlightPathD(this.rightTopPoints, 0.72),
                fill: 'none', stroke: 'url(#highlightFade)', 'stroke-width': 6,
                'stroke-linecap': 'round',
            }));
            svg.appendChild(createSvgElement('path', {
                d: this._highlightPathD(this.rightBottomPoints, 0.72),
                fill: 'none', stroke: 'url(#highlightFade)', 'stroke-width': 6,
                'stroke-linecap': 'round',
            }));

            // sand (dynamic — redrawn every frame by _updateSand)
            this.sandTopPath = createSvgElement('path', { fill: 'url(#sandGradient)' });
            this.sandTopShade = createSvgElement('path', { fill: 'url(#sandPileShade)', opacity: 0.6 });
            this.sandBottomPath = createSvgElement('path', { fill: 'url(#sandGradient)' });
            this.sandBottomShade = createSvgElement('path', { fill: 'url(#sandPileShade)', opacity: 0.7 });
            svg.appendChild(this.sandTopPath);
            svg.appendChild(this.sandTopShade);
            svg.appendChild(this.sandBottomPath);
            svg.appendChild(this.sandBottomShade);

            this.streamLine = createSvgElement('line', {
                x1: CENTER_X, x2: CENTER_X, y1: NECK_Y - 4, y2: NECK_Y + 40,
                stroke: 'url(#streamGradient)', 'stroke-width': 2.4,
                'stroke-dasharray': '3 5', filter: 'url(#softGlow)',
            });
            svg.appendChild(this.streamLine);

            // re-draw glass outline stroke on top of sand at the neck so the
            // narrow waist always reads crisply over the falling stream
            svg.appendChild(createSvgElement('path', {
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

        // A soft reflection that hugs one bulb's real curvature, inset from
        // the wall and clipped away from the rim/neck so it reads as a
        // floating streak of light rather than a straight ruled line.
        _highlightPathD(sidePoints, inset) {
            const pointCount = sidePoints.length;
            const startIndex = Math.floor(pointCount * 0.14);
            const endIndex = Math.ceil(pointCount * 0.8);
            const insetPoints = sidePoints.slice(startIndex, endIndex)
                .map((p) => ({ x: CENTER_X - (p.x - CENTER_X) * inset, y: p.y }));
            return `M ${roundCoord(insetPoints[0].x)} ${roundCoord(insetPoints[0].y)} `
                + pointsToLineSegments(insetPoints.slice(1));
        }

        _glassOutlineD() {
            const rimTopLeft = { x: CENTER_X - RIM_HALF_WIDTH, y: TOP_RIM_Y };
            const rimTopRight = { x: CENTER_X + RIM_HALF_WIDTH, y: TOP_RIM_Y };
            const rimBottomLeft = { x: CENTER_X - RIM_HALF_WIDTH, y: BOTTOM_RIM_Y };

            const rightPoints = this.rightTopPoints.concat(this.rightBottomPoints.slice(1));
            const leftPoints = rightPoints.map((p) => ({ x: 2 * CENTER_X - p.x, y: p.y })).reverse();

            let d = `M ${roundCoord(rimTopLeft.x)} ${roundCoord(rimTopLeft.y)} `
                + `L ${roundCoord(rimTopRight.x)} ${roundCoord(rimTopRight.y)} `;
            d += pointsToLineSegments(rightPoints) + ' ';
            d += `L ${roundCoord(rimBottomLeft.x)} ${roundCoord(rimBottomLeft.y)} `;
            d += pointsToLineSegments(leftPoints) + ' Z';
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
            const targetArea = bulb.isNeckFirst
                ? bulb.areaTable.totalArea * (1 - frontFrac)
                : bulb.areaTable.totalArea * frontFrac;
            return yForCumulativeArea(bulb.areaTable, targetArea);
        }

        _bulbSandD(bulb, surfaceY, role, frontFrac, bumpMax) {
            const { points, isNeckFirst, neckY, rimY, towardRimSign } = bulb;
            surfaceY = clamp(surfaceY, Math.min(neckY, rimY), Math.max(neckY, rimY));

            const sandOnHighY = role === 'drain' ? !isNeckFirst : isNeckFirst;
            let rightPoints = sandOnHighY
                ? points.filter((p) => p.y >= surfaceY)
                : points.filter((p) => p.y <= surfaceY);
            if (rightPoints.length < 2) return '';
            if (!sandOnHighY) rightPoints = rightPoints.slice().reverse(); // normalize to [surface, ..., far]

            const leftPoints = rightPoints.map((p) => ({ x: 2 * CENTER_X - p.x, y: p.y })).reverse();
            const surfaceHalfWidth = halfWidthAt(surfaceY);

            const distanceToNeck = Math.abs(surfaceY - neckY);
            const bump = bumpMax * (0.15 + 0.85 * frontFrac) * clamp(distanceToNeck / 40, 0, 1);
            const bumpY = surfaceY - bump * towardRimSign; // bump always leans toward the neck

            let d = `M ${roundCoord(CENTER_X - surfaceHalfWidth)} ${roundCoord(surfaceY)} `;
            d += `Q ${roundCoord(CENTER_X)} ${roundCoord(bumpY)} ${roundCoord(CENTER_X + surfaceHalfWidth)} ${roundCoord(surfaceY)} `;
            d += pointsToLineSegments(rightPoints) + ' ';
            d += pointsToLineSegments(leftPoints) + ' Z';
            return d;
        }

        _bulbShadeD(bulb, surfaceY, role) {
            const { neckY, rimY, towardRimSign } = bulb;
            surfaceY = clamp(surfaceY, Math.min(neckY, rimY), Math.max(neckY, rimY));
            const surfaceHalfWidth = halfWidthAt(surfaceY);
            const shadeDirSign = role === 'drain' ? -towardRimSign : towardRimSign;
            const bandY = clamp(surfaceY + shadeDirSign * 36, Math.min(neckY, rimY), Math.max(neckY, rimY));
            const bandHalfWidth = halfWidthAt(bandY);
            return `M ${roundCoord(CENTER_X - surfaceHalfWidth)} ${roundCoord(surfaceY)} `
                + `L ${roundCoord(CENTER_X + surfaceHalfWidth)} ${roundCoord(surfaceY)} `
                + `L ${roundCoord(CENTER_X + bandHalfWidth)} ${roundCoord(bandY)} `
                + `L ${roundCoord(CENTER_X - bandHalfWidth)} ${roundCoord(bandY)} Z`;
        }

        _updateSand(timeFrac) {
            timeFrac = clamp(timeFrac, 0, 1);
            const drainFrontFrac = 1 - MAX_FILL_FRACTION * (1 - timeFrac);
            const fillFrontFrac = MAX_FILL_FRACTION * timeFrac;

            const drainBulb = this.parity === 0 ? this.bulbs.top : this.bulbs.bottom;
            const fillBulb = this.parity === 0 ? this.bulbs.bottom : this.bulbs.top;
            const drainPath = this.parity === 0 ? this.sandTopPath : this.sandBottomPath;
            const drainShade = this.parity === 0 ? this.sandTopShade : this.sandBottomShade;
            const fillPath = this.parity === 0 ? this.sandBottomPath : this.sandTopPath;
            const fillShade = this.parity === 0 ? this.sandBottomShade : this.sandTopShade;

            const drainSurfaceY = this._frontY(drainBulb, drainFrontFrac);
            const fillSurfaceY = this._frontY(fillBulb, fillFrontFrac);

            drainPath.setAttribute('d', this._bulbSandD(drainBulb, drainSurfaceY, 'drain', drainFrontFrac, DRAIN_DIP_MAX));
            drainShade.setAttribute('d', this._bulbShadeD(drainBulb, drainSurfaceY, 'drain'));
            fillPath.setAttribute('d', this._bulbSandD(fillBulb, fillSurfaceY, 'fill', fillFrontFrac, FILL_PEAK_MAX));
            fillShade.setAttribute('d', this._bulbShadeD(fillBulb, fillSurfaceY, 'fill'));

            // stream + grains always fall from the neck toward whichever
            // bulb is currently filling, in that bulb's own "toward rim" direction.
            // Suppressed while a post-flip pour is still settling, so the flow
            // only resumes once the sand has actually finished resettling.
            const streamVisible = this.running && timeFrac < 1 && !this._pourActive;
            this.streamLine.setAttribute('y1', roundCoord(NECK_Y - fillBulb.towardRimSign * 4));
            this.streamLine.setAttribute('y2', roundCoord(fillSurfaceY - fillBulb.towardRimSign * 2));
            this.streamLine.style.opacity = streamVisible ? '1' : '0';

            this._fillSurfaceY = fillSurfaceY;
            this._fillDir = fillBulb.towardRimSign;
        }

        // ─── Grain particles (canvas overlay) ──────────────────
        _buildParticles() {
            this.canvas = this.wrap.querySelector('.grain-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.particles = [];
            this._spawnAccumMs = 0;
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
            this._canvasScaleX = this.canvas.width / VIEWBOX_WIDTH;
            this._canvasScaleY = this.canvas.height / VIEWBOX_HEIGHT;
        }

        _stepParticles(dtMs) {
            const ctx = this.ctx;
            ctx.setTransform(this._canvasScaleX, 0, 0, this._canvasScaleY, 0, 0);
            ctx.clearRect(0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT);

            // grains always fall from the neck toward whichever bulb is
            // currently filling — `fallDirSign` picks which way that is in SVG-space
            const fallDirSign = this._fillDir || 1;
            const fillSurfaceY = this._fillSurfaceY != null ? this._fillSurfaceY : NECK_Y;
            const landingY = fallDirSign > 0
                ? Math.max(NECK_Y + 6, fillSurfaceY - 6)
                : Math.min(NECK_Y - 6, fillSurfaceY + 6);
            const flowing = this.running && this.elapsedMs < this.durationMs && !this._pourActive;

            if (flowing) {
                this._spawnAccumMs += dtMs;
                const spawnIntervalMs = 55;
                while (this._spawnAccumMs > spawnIntervalMs && this.particles.length < 26) {
                    this._spawnAccumMs -= spawnIntervalMs;
                    this.particles.push({
                        x: CENTER_X + (Math.random() - 0.5) * NECK_HALF_WIDTH * 1.1,
                        y: NECK_Y - fallDirSign * 2,
                        vy: 40 * fallDirSign,
                        r: 1 + Math.random() * 1.1,
                    });
                }
            } else {
                this._spawnAccumMs = 0;
            }

            const dt = dtMs / 1000;
            ctx.fillStyle = '#fbe3a6';
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const grain = this.particles[i];
                grain.vy += 260 * dt * fallDirSign;
                grain.y += grain.vy * dt;
                if (fallDirSign > 0 ? grain.y >= landingY : grain.y <= landingY) {
                    this.particles.splice(i, 1);
                    continue;
                }
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
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
            this.lastFrameTimestamp = null;
            this.rafId = requestAnimationFrame((t) => this._timerLoop(t));
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
        // is what actually gets animated, per bulb, in _startPourTransfer.
        //
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
            const oldDrainFrontFrac = 1 - MAX_FILL_FRACTION * (1 - oldTimeFrac);
            const oldFillFrontFrac = MAX_FILL_FRACTION * oldTimeFrac;

            this.flipRotationDeg += 180;
            this.wrap.parentElement.style.transform = `rotate(${this.flipRotationDeg}deg)`;
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
                    setTimeout(() => { this._pourActive = false; }, SPIN_DURATION_MS);
                    this._snapshotSandForCrossfade(SPIN_DURATION_MS);
                } else {
                    this._startPourTransfer(oldDrainKey, 'drain', oldDrainFrontFrac);
                    this._startPourTransfer(oldFillKey, 'fill', oldFillFrontFrac);
                }

                this.start();
            }, POUR_START_DELAY_MS);
        }

        // Fallback for "reset sand on flip" mode: no physical pour to
        // animate (the sand just snaps back to full/empty), so instead we
        // cross-fade the old look out while the new one is already live
        // underneath. Simpler than a real pour, and appropriate for a mode
        // that's explicitly a shortcut rather than a physical simulation.
        _snapshotSandForCrossfade(durationMs) {
            const snapshots = [this.sandTopPath, this.sandTopShade, this.sandBottomPath, this.sandBottomShade]
                .map((node) => node.cloneNode(true));
            snapshots.forEach((node) => {
                node.style.transition = `opacity ${durationMs}ms ease`;
                node.style.opacity = '1';
                // insert above the live sand but below the neck stroke/stream
                this.svg.insertBefore(node, this.streamLine);
            });
            // force layout so the browser registers opacity:1 before we
            // transition to 0 — otherwise the change gets coalesced away
            void snapshots[0].getBoundingClientRect();
            requestAnimationFrame(() => {
                snapshots.forEach((node) => { node.style.opacity = '0'; });
            });
            setTimeout(() => {
                snapshots.forEach((node) => node.remove());
            }, durationMs + 60);
        }

        // The persistent (never removed) sand path + shade pair for a given
        // bulb — as opposed to the transient slabPath created per pour.
        _livePathsForBulb(bulbKey) {
            return bulbKey === 'top'
                ? { path: this.sandTopPath, shade: this.sandTopShade }
                : { path: this.sandBottomPath, shade: this.sandBottomShade };
        }

        // A slab of sand of fixed width (`transferAmount`, in frontFrac
        // units) sitting at one extreme of the bulb (rim if it was
        // 'fill', neck if it was 'drain') and rigidly sliding across to
        // rest at the OPPOSITE extreme. Because both ends of the slab
        // move by the same lerp, its width never changes — one
        // continuous connected mass the whole time, no gap opening up
        // in the middle (which is what made an earlier shrink+grow
        // version, with two independently-sized regions, look like sand
        // vanishing from one spot and reappearing from nowhere in another).
        //
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
            const durationMs = TRANSFER_MIN_MS
                + (TRANSFER_MAX_MS - TRANSFER_MIN_MS) * Math.sqrt(travelDistance);

            const oldLoFrac = oldRole === 'drain' ? oldFrontFrac : 0;
            const oldHiFrac = oldRole === 'drain' ? 1 : oldFrontFrac;
            const newLoFrac = newRole === 'drain' ? 1 - transferAmount : 0;
            const newHiFrac = newRole === 'drain' ? 1 : transferAmount;

            const livePaths = this._livePathsForBulb(bulbKey);
            livePaths.path.style.opacity = '0';
            livePaths.shade.style.opacity = '0';

            const slabPath = createSvgElement('path', { fill: 'url(#sandGradient)' });
            this.svg.insertBefore(slabPath, this.streamLine);

            const startTimestamp = performance.now();
            const transfer = {
                bulbKey, livePaths, slabPath,
                tick: (now) => {
                    const t = clamp((now - startTimestamp) / durationMs, 0, 1);
                    const p = smoothstep(t); // eases in and out — no abrupt snap at either end
                    const lo = lerp(oldLoFrac, newLoFrac, p);
                    const hi = lerp(oldHiFrac, newHiFrac, p);
                    slabPath.setAttribute('d', this._bulbSlabD(bulb, lo, hi));
                    return t >= 1;
                },
                finish: () => {
                    slabPath.remove();
                    livePaths.path.style.opacity = '';
                    livePaths.shade.style.opacity = '';
                },
            };
            this._pourActive = true;
            this._pourTransfers.push(transfer);
            this._ensurePourLoopRunning();
        }

        // Renders the sand between two frontFrac bounds (0=rim,1=neck)
        // as one plain contiguous region — used only for the sliding
        // transfer slab, which doesn't need the dip/peak surface bump
        // that the live drain/fill rendering has.
        _bulbSlabD(bulb, loFrontFrac, hiFrontFrac) {
            const yAtLo = this._frontY(bulb, clamp(loFrontFrac, 0, 1));
            const yAtHi = this._frontY(bulb, clamp(hiFrontFrac, 0, 1));
            const yTop = Math.min(yAtLo, yAtHi);
            const yBottom = Math.max(yAtLo, yAtHi);
            const rightPoints = bulb.points.filter((p) => p.y >= yTop && p.y <= yBottom);
            if (rightPoints.length < 2) return '';
            const leftPoints = rightPoints.map((p) => ({ x: 2 * CENTER_X - p.x, y: p.y })).reverse();
            return `M ${roundCoord(rightPoints[0].x)} ${roundCoord(rightPoints[0].y)} `
                + pointsToLineSegments(rightPoints.slice(1)) + ' '
                + pointsToLineSegments(leftPoints) + ' Z';
        }

        // A single shared rAF loop drives every active pour transfer (there
        // are normally two at once, one per bulb, each with its own
        // duration) so we don't spin up a separate requestAnimationFrame
        // per transfer.
        _ensurePourLoopRunning() {
            if (this._pourRafId) return;
            const step = (now) => {
                for (let i = this._pourTransfers.length - 1; i >= 0; i--) {
                    const transfer = this._pourTransfers[i];
                    const finished = transfer.tick(now);
                    if (finished) {
                        transfer.finish();
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
            this._pourTransfers.splice(0).forEach((transfer) => transfer.finish());
        }

        _clearParticles() {
            this.particles.length = 0;
            this._spawnAccumMs = 0;
            this._stepParticles(0);
        }

        _timerLoop(timestamp) {
            if (!this.running) return;
            if (this.lastFrameTimestamp == null) this.lastFrameTimestamp = timestamp;
            const dt = timestamp - this.lastFrameTimestamp;
            this.lastFrameTimestamp = timestamp;

            this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + dt);
            const timeFrac = this.elapsedMs / this.durationMs;
            this._updateSand(timeFrac);
            this._stepParticles(Math.min(dt, MAX_PARTICLE_FRAME_MS));
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
            this.rafId = requestAnimationFrame((t) => this._timerLoop(t));
        }

        _notifyTick() {
            if (this.onTick) {
                this.onTick(this.durationMs - this.elapsedMs, this.elapsedMs / this.durationMs);
            }
        }
    }

    window.Hourglass = Hourglass;
})();
