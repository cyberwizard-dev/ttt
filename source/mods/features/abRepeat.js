import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

/**
 * A-B repeat: loop the segment between two points of the current video.
 *
 * Pressing the A-B control cycles through:
 *   1. set point A at the current position
 *   2. set point B and start looping
 *   3. clear both points
 *
 * The control is available as a player button (transportControls
 * promotedActions) and with the yellow remote key (405 / 170).
 */

const YELLOW_KEY_CODES = [405, 170];
const LOOP_TICK_MS = 250;
const MIN_SEGMENT_SECONDS = 1;

let pointA = null;
let pointB = null;
let loopTimer = null;
let trackedHref = null;

function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const two = (value) => String(value).padStart(2, '0');

    return hours > 0
        ? `${hours}:${two(minutes)}:${two(secs)}`
        : `${minutes}:${two(secs)}`;
}

function videoElement() {
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
    return video;
}

function onWatchPage() {
    return !!(document.querySelector('ytlr-watch-default') || document.querySelector('ytlr-player'));
}

export function isABRepeatActive() {
    return pointA !== null && pointB !== null;
}

export function resetABRepeat() {
    pointA = null;
    pointB = null;
}

function showStatus(subtitle) {
    showToast(t('player.abRepeat.title'), subtitle);
}

export function cycleABRepeat() {
    if (!configRead('enableABRepeat')) return;

    const video = videoElement();
    if (!video) return;

    if (pointA === null) {
        pointA = video.currentTime;
        pointB = null;
        showStatus(t('player.abRepeat.aSet', { time: formatTime(pointA) }));
        return;
    }

    if (pointB === null) {
        const now = video.currentTime;

        if (now <= pointA + 0.5) {
            showStatus(t('player.abRepeat.tooShort', { min: MIN_SEGMENT_SECONDS }));
            return;
        }

        pointB = now;
        showStatus(t('player.abRepeat.looping', {
            a: formatTime(pointA),
            b: formatTime(pointB)
        }));
        return;
    }

    resetABRepeat();
    showStatus(t('player.abRepeat.cleared'));
}

function tick() {
    const href = window.location.href;
    if (href !== trackedHref) {
        trackedHref = href;
        resetABRepeat();
    }

    if (!configRead('enableABRepeat')) {
        if (pointA !== null || pointB !== null) resetABRepeat();
        return;
    }

    if (pointA === null || pointB === null) return;

    const video = videoElement();
    if (!video) return;

    // Do not fight the user while paused; only loop during playback.
    if (video.paused || video.ended) return;

    // Wrap around with a small tolerance so playback never visibly passes B.
    if (video.currentTime >= pointB - 0.05) {
        video.currentTime = pointA;
    }
}

function startLoopWatcher() {
    if (loopTimer) return;
    trackedHref = window.location.href;
    loopTimer = setInterval(tick, LOOP_TICK_MS);
}

function onKeyEvent(evt) {
    if (YELLOW_KEY_CODES.indexOf(evt.keyCode) === -1) return;
    if (!onWatchPage()) return;

    evt.preventDefault();
    evt.stopPropagation();

    if (evt.type === 'keydown') cycleABRepeat();
}

export function initABRepeat() {
    startLoopWatcher();

    document.addEventListener('keydown', onKeyEvent, true);
    document.addEventListener('keypress', onKeyEvent, true);
    document.addEventListener('keyup', onKeyEvent, true);
}

initABRepeat();
