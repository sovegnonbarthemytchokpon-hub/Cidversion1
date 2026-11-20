/*
 * Small, opt-in feedback sound for the social like action.
 *
 * The audio is only started from a trusted click handler, so it remains
 * compatible with browser autoplay policies. One decoded Audio instance is
 * reused and rewound for each click.
 */
(() => {
  let sound = null;

  window.cidPlayLikeSound = () => {
    try {
      sound ||= new Audio('/sfx/like-confirmation.wav');
      sound.volume = 0.28;
      sound.currentTime = 0;
      const playback = sound.play();
      playback?.catch?.(() => {});
    } catch (_) {
      // Audio is enhancement-only; the visual like state must still work.
    }
  };
})();
