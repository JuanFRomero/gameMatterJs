(function () {
  function createAudio() {
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextRef) {
      return createFallback();
    }

    const ctx = new AudioContextRef();

    function unlock() {
      if (ctx.state === "suspended") {
        ctx.resume();
      }
    }

    function gainNode(value, when, destination) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(value, when);
      gain.connect(destination || ctx.destination);
      return gain;
    }

    function noiseBuffer() {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      return buffer;
    }

    const cachedNoise = noiseBuffer();
    let lastBounceAt = 0;

    function playSword(type) {
      unlock();
      const now = ctx.currentTime;
      const mainGain = gainNode(0.0001, now);
      mainGain.gain.exponentialRampToValueAtTime(type === "heavy" ? 0.17 : 0.11, now + 0.02);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, now + (type === "heavy" ? 0.34 : 0.22));

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(type === "heavy" ? 520 : 760, now);
      osc.frequency.exponentialRampToValueAtTime(type === "heavy" ? 120 : 210, now + (type === "heavy" ? 0.32 : 0.2));
      osc.connect(mainGain);
      osc.start(now);
      osc.stop(now + 0.36);

      const noise = ctx.createBufferSource();
      noise.buffer = cachedNoise;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "highpass";
      noiseFilter.frequency.setValueAtTime(1400, now);
      const noiseGain = gainNode(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noise.start(now);
      noise.stop(now + 0.14);
    }

    function playEnemyShot() {
      unlock();
      const now = ctx.currentTime;
      const gain = gainNode(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.2);
    }

    function playSkyFall() {
      unlock();
      const now = ctx.currentTime;
      const gain = gainNode(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.8);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.82);
    }

    function playSkyImpact() {
      unlock();
      const now = ctx.currentTime;
      const gain = gainNode(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.42);

      const noise = ctx.createBufferSource();
      noise.buffer = cachedNoise;
      const noiseGain = gainNode(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      noise.connect(noiseGain);
      noise.start(now);
      noise.stop(now + 0.25);
    }

    function playSpecialWave() {
      unlock();
      const now = ctx.currentTime;
      const gain = gainNode(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.85);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.9);
    }

    function playBounce(intensity) {
      unlock();
      const nowMs = performance.now();
      if (nowMs - lastBounceAt < 85) {
        return;
      }
      lastBounceAt = nowMs;

      const now = ctx.currentTime;
      const gain = gainNode(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.min(0.14, 0.06 + (intensity || 0.6) * 0.08), now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.16);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.18);
    }

    return {
      unlock,
      playSword,
      playEnemyShot,
      playSkyFall,
      playSkyImpact,
      playSpecialWave,
      playBounce,
    };
  }

  function createFallback() {
    const noop = function () {};
    return {
      unlock: noop,
      playSword: noop,
      playEnemyShot: noop,
      playSkyFall: noop,
      playSkyImpact: noop,
      playSpecialWave: noop,
      playBounce: noop,
    };
  }

  window.GameAudio = createAudio();
}());
