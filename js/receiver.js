/**
 * DEBUGGING
 */
// https://developers.google.com/cast/docs/debugging/cast_debug_logger
const castDebugLogger = cast.debug.CastDebugLogger.getInstance();
const LOG_TAG = 'MUX';
castDebugLogger.setEnabled(true);

// Debug overlay on tv screen. You don't need this if you're debugging using the cast tool (https://casttool.appspot.com/cactool) as it will show the logs in your browser.
castDebugLogger.showDebugLogs(true);

castDebugLogger.loggerLevelByTags = {
    [LOG_TAG]: cast.framework.LoggerLevel.DEBUG,
};

/**
 * Initialize Cast Receiver Context
 */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

/**
 * Logo Overlay Control
 */
const logoOverlay = document.getElementById('logo-overlay');

function showLogo() {
  if (logoOverlay) {
    logoOverlay.classList.remove('hidden');
  }
}

function hideLogo() {
  if (logoOverlay) {
    logoOverlay.classList.add('hidden');
  }
}

/**
 * Listen for player state changes to show/hide logo
 */
playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_PRELOADING,
  () => {
    castDebugLogger.debug(LOG_TAG, 'Player preloading - hiding logo');
    hideLogo();
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_LOAD_COMPLETE,
  () => {
    castDebugLogger.debug(LOG_TAG, 'Player load complete - hiding logo');
    hideLogo();
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_PLAYING,
  () => {
    castDebugLogger.debug(LOG_TAG, 'Player playing - hiding logo');
    hideLogo();
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_PAUSE,
  () => {
    castDebugLogger.debug(LOG_TAG, 'Player paused - showing logo');
    showLogo();
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_IDLE,
  () => {
    castDebugLogger.debug(LOG_TAG, 'Player idle - showing logo');
    showLogo();
  }
);

/**
 * DRM SUPPORT
 */
playerManager.setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
  castDebugLogger.debug(LOG_TAG, 'Setting media playback info handler.');
  const customData = loadRequest.media.customData || {};

  if(customData.mux && customData.mux.tokens.drm){
    castDebugLogger.debug(LOG_TAG, 'Setting license URL.');
    playbackConfig.licenseUrl = `https://license.mux.com/license/widevine/${customData.mux.playbackId}?token=${customData.mux.tokens.drm}`;
  }

  playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;

  castDebugLogger.debug(LOG_TAG, 'license url', playbackConfig.licenseUrl);

  return playbackConfig;
});

/**
 * START LISTENING FOR CASTS
 */
context.start();
