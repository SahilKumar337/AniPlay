/**
 * Network Speed & Quality Intelligence Engine (YouTube / Netflix Architecture)
 * Detects slow network conditions (3G, 2G, high RTT, low downlink, data saver),
 * recommends lowest resolution for instant playback, and auto-adapts buffer parameters.
 */

// Rolling EWMA measured throughput (bps) fallback
let measuredThroughput = 2000000; // 2 Mbps default
let lastSampleTime = 0;

/**
 * Record a network transfer sample to dynamically measure real-world throughput.
 * @param {number} bytesLoaded - size of transferred payload in bytes
 * @param {number} durationMs - roundtrip duration in milliseconds
 */
export function recordNetworkSample(bytesLoaded, durationMs) {
  if (!bytesLoaded || durationMs <= 10) return;
  const sampleBps = (bytesLoaded * 8 * 1000) / durationMs;
  // Apply Exponentially Weighted Moving Average (EWMA) with alpha = 0.3
  measuredThroughput = Math.round(measuredThroughput * 0.7 + sampleBps * 0.3);
  lastSampleTime = Date.now();
}

/**
 * Retrieve comprehensive network profile and slow network classification.
 */
export function getNetworkProfile() {
  const hasNav = typeof navigator !== 'undefined';
  const conn = hasNav && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);

  const effectiveType = conn?.effectiveType || '4g';
  const downlink = typeof conn?.downlink === 'number' ? conn.downlink : (measuredThroughput / 1000000);
  const rtt = typeof conn?.rtt === 'number' ? conn.rtt : 60;
  const saveData = Boolean(conn?.saveData);

  // Slow network classification based on Netflix/YouTube video streaming standards:
  // - 2G / 3G effective cellular connection
  // - Downlink < 2.0 Mbps (insufficient for stable 1080p chunks without rebuffering)
  // - RTT > 350ms (high network congestion / packet drop)
  // - Data Saver turned ON by user
  const isSlow = saveData ||
                 effectiveType === 'slow-2g' ||
                 effectiveType === '2g' ||
                 effectiveType === '3g' ||
                 downlink < 2.0 ||
                 rtt > 350;

  const isCriticalSlow = effectiveType === 'slow-2g' ||
                         effectiveType === '2g' ||
                         downlink < 0.8 ||
                         rtt > 600;

  // Recommended initial bitrate estimate for HLS ABR:
  // Slow: 300 kbps (fetches featherweight 360p chunk in < 150ms)
  // Normal: 1.5 Mbps (fetches 720p chunk)
  const initialEstimateBps = isCriticalSlow ? 200000 : (isSlow ? 350000 : 1500000);

  return {
    isSlow,
    isCriticalSlow,
    effectiveType,
    downlink,
    rtt,
    saveData,
    initialEstimateBps,
    measuredThroughput
  };
}

/**
 * Find the lowest resolution / lowest bitrate level in an HLS manifest levels array.
 * @param {Array} levels - array of Hls.js level objects
 * @returns {{ index: number, level: Object }}
 */
export function findLowestQualityLevel(levels) {
  if (!levels || !levels.length) return { index: 0, level: null };

  let lowestIdx = 0;
  let minScore = Infinity;

  levels.forEach((lvl, idx) => {
    // Prefer resolution height (e.g. 360 over 720), then bitrate
    const height = lvl.height || 9999;
    const bitrate = lvl.bitrate || 99999999;
    const score = height * 1000000 + bitrate;
    if (score < minScore) {
      minScore = score;
      lowestIdx = idx;
    }
  });

  return { index: lowestIdx, level: levels[lowestIdx] };
}

/**
 * Subscribe to real-time network status changes.
 * @param {Function} callback - invoked with new profile whenever network changes
 * @returns {Function} unsubscribe cleanup function
 */
export function subscribeNetworkChanges(callback) {
  if (typeof navigator === 'undefined' || !navigator.connection) {
    return () => {};
  }
  const conn = navigator.connection;
  const handler = () => {
    try {
      callback(getNetworkProfile());
    } catch (_) {}
  };
  conn.addEventListener('change', handler);
  return () => conn.removeEventListener('change', handler);
}
