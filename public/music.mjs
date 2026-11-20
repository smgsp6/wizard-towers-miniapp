const melody = [60,64,67,71,69,67,64,62,60,64,72,71,67,64,62,60];

export function mountMusic() {
  const button = document.querySelector('#audio-toggle');
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) { button.hidden = true; return; }
  let audio;
  let master;
  let enabled = false;
  let timer;
  let next = 0;
  let note = 0;

  function stop() {
    clearInterval(timer);
    if (audio) {
      master.gain.setValueAtTime(0, audio.currentTime);
      audio.suspend().catch(() => {});
    }
  }

  function schedule() {
    if (next < audio.currentTime - 0.2) next = audio.currentTime;
    while (next < audio.currentTime + 0.16) {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = note % 4 === 0 ? 'triangle' : 'sine';
      oscillator.frequency.value = 440 * 2 ** ((melody[note % melody.length] - 69) / 12);
      envelope.gain.setValueAtTime(0.0001, next);
      envelope.gain.exponentialRampToValueAtTime(0.07, next + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, next + 0.55);
      oscillator.connect(envelope).connect(master);
      oscillator.start(next);
      oscillator.stop(next + 0.56);
      next += note % 4 === 3 ? 0.72 : 0.38;
      note++;
    }
  }

  async function start() {
    if (document.hidden || !enabled) return;
    clearInterval(timer);
    audio ??= new Audio();
    if (!master) {
      master = audio.createGain();
      master.connect(audio.destination);
    }
    await audio.resume();
    if (!enabled || document.hidden) { stop(); return; }
    master.gain.setValueAtTime(0.33, audio.currentTime);
    next = audio.currentTime + 0.08;
    schedule();
    timer = setInterval(schedule, 100);
  }

  function sync() {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? '关闭音乐' : '开启音乐';
    if (enabled && !document.hidden) {
      start().catch(() => { enabled = false; sync(); });
    } else stop();
  }

  button.onclick = () => { enabled = !enabled; sync(); };
  document.addEventListener('visibilitychange', sync);
}
