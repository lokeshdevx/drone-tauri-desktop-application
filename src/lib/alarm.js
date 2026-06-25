/**
 * alarm.js — plays alarm.mp4 from public folder when drone is detected.
 * Falls back to Web Audio oscillator if the file can't be loaded.
 */

let activeAudio = null;

export function stopAlarm() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

export async function playAlarm(sound = "siren", volume = 0.8) {
  stopAlarm();

  // Try alarm.mp4 from public folder first
  // In Next.js static export + Tauri, public files are served at root path
  const sources = [
    "/alarm.mp4",
    "/sounds/alarm.mp4",
    "/alarm.mp3",
    "/sounds/alarm.mp3",
  ];

  for (const src of sources) {
    try {
      const audio = new Audio(src);
      audio.volume = Math.max(0, Math.min(1, volume));

      // Check if the file exists by trying to load it
      await new Promise((resolve, reject) => {
        audio.oncanplaythrough = resolve;
        audio.onerror = reject;
        audio.load();
        // Timeout after 500ms — don't wait too long
        setTimeout(reject, 500);
      });

      // File loaded — play it
      audio.play().catch(() => {});
      activeAudio = audio;

      audio.onended = () => {
        activeAudio = null;
      };
      return true;
    } catch {
      // This source didn't work — try next
      continue;
    }
  }

  // No audio file found — fall back to Web Audio oscillator
  return _playOscillator(sound, volume);
}

async function _playOscillator(sound, volume) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const patterns = {
      siren: [
        { f: 880, d: 0.3 },
        { f: 440, d: 0.3 },
        { f: 880, d: 0.3 },
        { f: 440, d: 0.3 },
      ],
      bell: [
        { f: 1046, d: 0.5 },
        { f: 784, d: 0.3 },
      ],
      chime: [
        { f: 523, d: 0.2 },
        { f: 659, d: 0.2 },
        { f: 784, d: 0.4 },
      ],
      default: [
        { f: 660, d: 0.2 },
        { f: 660, d: 0.2 },
        { f: 0, d: 0.1 },
        { f: 660, d: 0.4 },
      ],
    };

    const notes = patterns[sound] || patterns.default;
    let t = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    notes.forEach(({ f, d }) => {
      if (f === 0) {
        t += d;
        return;
      }
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.7, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + d);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + d);
      t += d;
    });

    return true;
  } catch (err) {
    console.error("Alarm error:", err);
    return false;
  }
}

export async function testAlarm(sound, volume) {
  return playAlarm(sound, volume);
}
