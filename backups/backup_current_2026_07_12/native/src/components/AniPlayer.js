import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, BackHandler, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';

// Custom Web HLS Video Player using hls.js CDN
function WebVideoPlayer({ url }) {
  const videoRef = useRef(null);

  useEffect(() => {
    let hls;
    const video = videoRef.current;
    if (!video) return;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS Native support
      video.src = url;
      video.play().catch(() => {});
    } else {
      // Load hls.js dynamically for Chrome/Firefox/Edge
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Hls) {
          hls = new window.Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
          });
        }
      };
      document.body.appendChild(script);

      return () => {
        if (hls) {
          hls.destroy();
        }
        try {
          document.body.removeChild(script);
        } catch {}
      };
    }
  }, [url]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      style={{ width: '100%', height: '100%', backgroundColor: '#000000', border: 'none' }}
    />
  );
}

export default function AniPlayer({ url, onBack }) {
  // Initialize the native player (only on Native platforms to avoid hook validation errors)
  const player = Platform.OS !== 'web' ? useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  }) : null;

  // Lock orientation and hide navigation bars on mount (Native only)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const enterFullscreen = async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('hidden');
          await NavigationBar.setBehaviorAsync('swipe');
        }
      } catch (e) {
        console.warn('[AniPlayer] Failed to enter landscape fullscreen:', e.message);
      }
    };

    const exitFullscreen = async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('visible');
        }
      } catch (e) {
        console.warn('[AniPlayer] Failed to exit landscape fullscreen:', e.message);
      }
    };

    enterFullscreen();

    // Android back button handler -> Exit player on back press
    const backAction = () => {
      onBack();
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    return () => {
      exitFullscreen();
      backHandler.remove();
    };
  }, [onBack]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <WebVideoPlayer url={url} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={styles.video}
        useNativeControls={true}
        allowsFullscreen={false} // Disable standard toggle since we lock it at component level
        allowsPictureInPicture={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    width: '100%',
    height: '100%',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
