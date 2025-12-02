/**
Copyright 2022 Google LLC. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


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
 * DRM SUPPORT
 */
context.getPlayerManager().setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
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
