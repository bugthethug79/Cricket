const sounds = {
  notify: new Audio('/assets/sounds/notify.wav'),
  join: new Audio('/assets/sounds/join.wav'),
  leave: new Audio('/assets/sounds/leave.wav'),
};

for (const audio of Object.values(sounds)) audio.preload = 'auto';

export function playSound(name) {
  const audio = sounds[name];
  if (!audio) return;
  try {
    audio.currentTime = 0;
    const played = audio.play();
    if (played) played.catch(() => {});
  } catch {}
}
