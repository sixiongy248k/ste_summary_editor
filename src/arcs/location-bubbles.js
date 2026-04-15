/**
 * @module location-bubbles
 * @description Physics-based bubble cluster chart showing location frequency.
 *
 * Each unique location becomes a circle. Size ∝ √(visit count) so area is
 * perceptually proportional to frequency. A simple force-directed simulation
 * (gravity toward centre + bubble-bubble repulsion) produces an organic cluster.
 * Text colour is auto-inverted for contrast; count is shown as a subtext line.
 */

import { state } from '../core/state.js';
import { escHtml } from '../core/utils.js';

/** 20-colour modern palette (avoids Monokai accent clashes). */
const BUBBLE_COLORS = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#6baed6',
    '#74c476', '#9ecae1', '#fd8d3c', '#a1d99b', '#756bb1',
    '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e',
];

/**
 * Relative luminance (0 = black, 1 = white) for a "#rrggbb" hex string.
 * Used to pick legible text colour (dark on light, white on dark).
 * @param {string} hex - e.g. "#4e79a7"
 * @returns {number}
 */
function luminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Render a location-frequency bubble cluster chart into the given jQuery canvas.
 * Clears the canvas and writes an inline SVG.
 *
 * @param {jQuery} $canvas - The #se-timeline-canvas element.
 */
export function buildLocationBubbles($canvas) {
    $canvas.empty();
    $canvas.css({ position: 'relative', overflow: 'visible' });

    // ── Count locations (case-insensitive) ────────────────────
    const locMap = new Map();
    for (const entry of state.entries.values()) {
        const raw = entry.location?.trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!locMap.has(key)) locMap.set(key, { label: raw, count: 0 });
        locMap.get(key).count++;
    }

    if (locMap.size === 0) {
        $canvas.html(
            '<div style="color:#75715e;padding:40px 32px;text-align:center;font-size:0.88em;">' +
            'No location data — add locations to entries in the Review tab.' +
            '</div>'
        );
        $canvas.css({ width: '', height: '' });
        return;
    }

    // Sort largest first so big bubbles are placed (and coloured) first
    const locs = [...locMap.values()].sort((a, b) => b.count - a.count);

    // ── Bubble radii (min 30, max 88, scale by √count) ────────
    const maxCount = locs[0].count;
    const MIN_R = 30, MAX_R = 88;
    for (const loc of locs) {
        loc.r = MIN_R + (MAX_R - MIN_R) * Math.sqrt(loc.count / maxCount);
    }

    // ── Assign colours ─────────────────────────────────────────
    locs.forEach((loc, i) => { loc.color = BUBBLE_COLORS[i % BUBBLE_COLORS.length]; });

    // ── Physics simulation ─────────────────────────────────────
    // All bubbles start near the centre with a tiny random spread so the
    // repulsion doesn't send them all in the same direction.
    const CX = 360, CY = 280;
    const GRAVITY  = 0.014;   // attraction toward (CX, CY)
    const DAMPING  = 0.70;    // velocity decay per tick
    const ITERS    = 260;

    for (const loc of locs) {
        const angle = Math.random() * Math.PI * 2;
        loc.x  = CX + Math.cos(angle) * 18;
        loc.y  = CY + Math.sin(angle) * 18;
        loc.vx = 0;
        loc.vy = 0;
    }

    for (let iter = 0; iter < ITERS; iter++) {
        // Gravity: each bubble attracted toward canvas centre
        for (const loc of locs) {
            loc.vx += (CX - loc.x) * GRAVITY;
            loc.vy += (CY - loc.y) * GRAVITY;
        }

        // Repulsion: overlapping bubbles push each other apart
        for (let i = 0; i < locs.length; i++) {
            for (let j = i + 1; j < locs.length; j++) {
                const a = locs[i], b = locs[j];
                const dx  = b.x - a.x;
                const dy  = b.y - a.y;
                const d   = Math.sqrt(dx * dx + dy * dy) || 0.01;
                const min = a.r + b.r + 6;   // 6px gap between bubbles
                if (d < min) {
                    const f = (min - d) / d * 0.52;
                    a.vx -= dx * f;  a.vy -= dy * f;
                    b.vx += dx * f;  b.vy += dy * f;
                }
            }
        }

        // Integrate
        for (const loc of locs) {
            loc.vx *= DAMPING;
            loc.vy *= DAMPING;
            loc.x  += loc.vx;
            loc.y  += loc.vy;
        }
    }

    // ── Compute canvas bounds from final positions ─────────────
    const PAD = 48;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const loc of locs) {
        x0 = Math.min(x0, loc.x - loc.r);
        x1 = Math.max(x1, loc.x + loc.r);
        y0 = Math.min(y0, loc.y - loc.r);
        y1 = Math.max(y1, loc.y + loc.r);
    }
    const offX  = PAD - x0;
    const offY  = PAD - y0;
    const svgW  = Math.round(x1 + offX + PAD);
    const svgH  = Math.round(y1 + offY + PAD);

    // ── Build SVG ──────────────────────────────────────────────
    const parts = [];

    for (const loc of locs) {
        const cx  = Math.round(loc.x + offX);
        const cy  = Math.round(loc.y + offY);
        const r   = Math.round(loc.r);
        const tc  = luminance(loc.color) > 0.45 ? '#272822' : '#f8f8f2';

        // Clamp font size so text stays inside circle
        const fs  = Math.max(10, Math.min(15, r * 0.30));

        // Truncate label so it fits in the bubble (approx char width = 0.58 * fs)
        const maxChars = Math.max(3, Math.floor((r * 1.75) / (fs * 0.58)));
        const label = loc.label.length > maxChars
            ? loc.label.slice(0, maxChars - 1) + '…'
            : loc.label;

        const hasCount = loc.count > 1;
        const labelCY  = hasCount ? cy - fs * 0.55 : cy;
        const countCY  = cy + fs * 0.58 + 3;

        parts.push(
            // Fill
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${loc.color}" opacity="0.90"/>`,
            // Subtle border
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${tc}" stroke-width="0.6" opacity="0.12"/>`,
            // Location name
            `<text x="${cx}" y="${labelCY}" ` +
                `fill="${tc}" font-size="${fs}" font-weight="600" ` +
                `text-anchor="middle" dominant-baseline="middle" ` +
                `font-family="'JetBrains Mono',monospace,sans-serif" ` +
                `pointer-events="none">${escHtml(label)}</text>`,
            // Count sub-label (hidden for single-occurrence bubbles)
            hasCount
                ? `<text x="${cx}" y="${countCY}" ` +
                  `fill="${tc}" font-size="${Math.max(8, Math.round(fs * 0.72))}" ` +
                  `text-anchor="middle" dominant-baseline="middle" ` +
                  `font-family="monospace" opacity="0.70" pointer-events="none">` +
                  `×${loc.count}</text>`
                : ''
        );
    }

    // ── Lay out SVG inside viewport ────────────────────────────
    // Make the canvas fill at least the full viewport so the cluster is
    // centred even when the bubble cloud is smaller than the panel.
    requestAnimationFrame(() => {
        const vp  = document.getElementById('se-timeline-viewport');
        const vpW = vp ? vp.clientWidth  : 700;
        const vpH = vp ? vp.clientHeight : 400;
        const finalW = Math.max(svgW, vpW);
        const finalH = Math.max(svgH, vpH);

        // Offset so the cluster (computed at 0,0) lands at the centre of
        // the larger canvas rather than the top-left corner.
        const shiftX = Math.round((finalW - svgW) / 2);
        const shiftY = Math.round((finalH - svgH) / 2);

        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${finalW}" height="${finalH}" ` +
            `style="display:block;">` +
            `<g transform="translate(${shiftX},${shiftY})">` +
            parts.join('') +
            `</g></svg>`;

        $canvas.html(svg);
        $canvas.css({ width: finalW + 'px', height: finalH + 'px' });

        // Scroll to the true centre of the cluster
        if (vp) {
            vp.scrollLeft = Math.max(0, (finalW - vpW) / 2);
            vp.scrollTop  = Math.max(0, (finalH - vpH) / 2);
        }
    });
}
