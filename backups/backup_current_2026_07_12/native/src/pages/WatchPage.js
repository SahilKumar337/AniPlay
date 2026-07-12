import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, FlatList, Image } from 'react-native';
import { ArrowLeft, AlertCircle, RefreshCw, Play } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { getAniNekoServers, formatServerUrl } from '../api/stream';
import { useApp } from '../context/AppContext';
import AniPlayer from '../components/AniPlayer';

const { width } = Dimensions.get('window');

export default function WatchPage({ route, navigation }) {
  const { id, ep } = route.params;
  const { setEpisodeProgress, addToRecentlyViewed } = useApp();

  const [anime, setAnime] = useState(null);
  const [loadAnime, setLoadAnime] = useState(true);
  const [animeErr, setAnimeErr] = useState('');

  const [servers, setServers] = useState([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [activeName, setActiveName] = useState('');
  const [activeType, setActiveType] = useState('sub'); // 'sub' or 'dub'
  const [audioTrack, setAudioTrack] = useState('sub');
  
  const [loadStream, setLoadStream] = useState(false);
  const [streamErr, setStreamErr] = useState('');
  
  const [isActiveHLS, setIsActiveHLS] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const [activeServer, setActiveServer] = useState(null);

  const episode = Math.max(1, parseInt(ep) || 1);

  // Fetch Anime details
  useEffect(() => {
    setLoadAnime(true);
    setAnimeErr('');
    getAnimeDetail(Number(id))
      .then(d => {
        setAnime(d);
        setLoadAnime(false);
      })
      .catch(e => {
        setAnimeErr(e.message);
        setLoadAnime(false);
      });
  }, [id]);

  // Robust server selection and fallback
  const selectServer = useCallback(async (srv, srvList) => {
    setActiveServer(srv);
    setStreamErr('');
    setExtracting(false);
    setIsPlaying(false);

    const listToUse = srvList || [];
    const sameTypeServers = srv.type === 'dub' 
      ? listToUse.filter(s => s.type === 'dub') 
      : listToUse.filter(s => s.type === 'sub');
    
    const currentIndex = sameTypeServers.findIndex(s => s.videoUrl === srv.videoUrl);

    const tryNext = () => {
      if (currentIndex !== -1 && currentIndex < sameTypeServers.length - 1) {
        const nextSrv = sameTypeServers[currentIndex + 1];
        console.log(`[WatchPage] Server ${srv.name} failed. Falling back to next server: ${nextSrv.name}...`);
        selectServer(nextSrv, listToUse);
      } else {
        setStreamErr('All available servers failed to load. Please try another episode.');
      }
    };

    // For iframe-proxy servers: try HLS extraction first
    if (srv.videoUrl && srv.videoUrl.includes('iframe-proxy')) {
      let embedUrl = srv.videoUrl;
      try {
        const urlObj = new URL(srv.videoUrl, 'http://localhost');
        embedUrl = urlObj.searchParams.get('url') || srv.videoUrl;
      } catch {}

      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setIsActiveHLS(false);
      setActiveUrl(srv.videoUrl);
      setExtracting(false);

      // Run background stream extraction attempt
      const extractController = new AbortController();
      const extractTimeout = setTimeout(() => extractController.abort(), 18000);
      
      fetch(formatServerUrl(`/api/extract-stream?url=${encodeURIComponent(embedUrl)}`), {
        signal: extractController.signal
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.url) {
            console.log('[WatchPage] Extraction succeeded, switching to native HLS player');
            setActiveUrl(formatServerUrl(data.url));
            setIsActiveHLS(true);
          }
        })
        .catch(e => console.log('[WatchPage] Extraction skipped:', e.message))
        .finally(() => clearTimeout(extractTimeout));
      return;
    }

    // Regular HLS direct video URLs
    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
    setIsActiveHLS(!!srv.isHLS);
  }, []);

  // Fetch streaming links
  const fetchStream = useCallback(async () => {
    if (!anime) return;

    if (anime.status === 'NOT_YET_RELEASED') {
      setStreamErr('This anime has not been released yet.');
      return;
    }

    setLoadStream(true);
    setStreamErr('');
    setServers([]);
    setActiveUrl('');
    setActiveName('');
    setActiveServer(null);
    setIsPlaying(false);

    try {
      const result = await getAniNekoServers(anime, episode);
      if (result?.servers?.length) {
        setServers(result.servers);
        
        // Auto-select preferred audio track
        let matchingServers = result.servers.filter(s => s.type === audioTrack);
        if (matchingServers.length === 0) {
          matchingServers = result.servers.filter(s => s.type === (audioTrack === 'sub' ? 'dub' : 'sub'));
        }

        const preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                        || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                        || matchingServers[0]
                        || result.servers[0];

        setActiveType(preferred.type || 'sub');
        setAudioTrack(preferred.type || 'sub');
        selectServer(preferred, result.servers);
      } else {
        setStreamErr('No streaming servers available for this episode.');
      }
    } catch (e) {
      setStreamErr(e.message || 'Failed to fetch streaming links.');
    } finally {
      setLoadStream(false);
    }
  }, [anime, episode, audioTrack, selectServer]);

  useEffect(() => {
    fetchStream();
  }, [fetchStream]);

  // Persist watch progress
  useEffect(() => {
    if (anime) {
      setEpisodeProgress(anime.id, episode);
      addToRecentlyViewed(anime, episode);
    }
  }, [anime, episode]);

  if (loadAnime) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#e50914" />
        <Text style={styles.loadingText}>Loading Details...</Text>
      </View>
    );
  }

  const title = anime ? getTitle(anime) : '...';
  const cover = anime ? getCover(anime) : '';
  const totalEps = anime
    ? (anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : (anime.episodes || 12))
    : 12;

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');
  const hasDub = dubServers.length > 0;

  // Custom back button handler
  const handleBackToDetail = () => {
    navigation.navigate('AnimeDetail', { id });
  };

  // Full Screen Native Player Overlay
  if (isPlaying && activeUrl && isActiveHLS) {
    return (
      <AniPlayer
        url={activeUrl}
        title={`${title} – EP ${episode}`}
        onBack={() => setIsPlaying(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. Header Toolbar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBackToDetail}>
          <ArrowLeft size={20} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title} • EP {episode}
        </Text>
      </View>

      {/* 2. Video Player Frame */}
      <View style={styles.playerFrame}>
        {loadStream ? (
          <View style={styles.playerPlaceholder}>
            <ActivityIndicator size="large" color="#e50914" />
            <Text style={styles.placeholderText}>Searching servers...</Text>
          </View>
        ) : streamErr ? (
          <View style={styles.playerPlaceholder}>
            <AlertCircle size={40} color="#e50914" style={{ marginBottom: 10 }} />
            <Text style={styles.placeholderText}>Stream Not Found</Text>
            <Text style={styles.placeholderSubText}>{streamErr}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchStream}>
              <RefreshCw size={12} color="#ffffff" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : activeUrl ? (
          isActiveHLS ? (
            /* Native player preview container with play button */
            <TouchableOpacity 
              style={styles.playerPlaceholder} 
              activeOpacity={0.9}
              onPress={() => setIsPlaying(true)}
            >
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFillObject} blurRadius={3} />
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
              <View style={styles.playCircle}>
                <Play size={24} color="#ffffff" fill="#ffffff" />
              </View>
              <Text style={styles.playOverlayText}>Tap to play fullscreen</Text>
            </TouchableOpacity>
          ) : (
            /* Sandbox WebView player for iframes */
            <WebView
              source={{ uri: activeUrl }}
              style={styles.webview}
              allowsFullscreenVideo={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
            />
          )
        ) : (
          <View style={styles.playerPlaceholder}>
            <ActivityIndicator size="small" color="#e50914" />
          </View>
        )}
      </View>

      {/* 3. Details and Selection Controls */}
      <ScrollView style={styles.controlsScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.controlsPadding}>
          <Text style={styles.animeTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.episodeLabel}>Episode {episode} of {totalEps}</Text>

          {/* Sub / Dub track control */}
          {hasDub && (
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[styles.segmentBtn, audioTrack === 'sub' && styles.segmentBtnActive]}
                onPress={() => {
                  setAudioTrack('sub');
                  if (subServers.length > 0) selectServer(subServers[0], servers);
                }}
              >
                <Text style={[styles.segmentText, audioTrack === 'sub' && styles.segmentTextActive]}>Subtitled (SUB)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, audioTrack === 'dub' && styles.segmentBtnActive]}
                onPress={() => {
                  setAudioTrack('dub');
                  if (dubServers.length > 0) selectServer(dubServers[0], servers);
                }}
              >
                <Text style={[styles.segmentText, audioTrack === 'dub' && styles.segmentTextActive]}>Dubbed (DUB)</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Server List */}
          {servers.length > 0 && (
            <View style={styles.serversSection}>
              <Text style={styles.sectionTitle}>SELECT SERVER</Text>
              <View style={styles.serversRow}>
                {servers
                  .filter(s => s.type === audioTrack)
                  .map(s => {
                    const isSelected = activeServer?.videoUrl === s.videoUrl;
                    return (
                      <TouchableOpacity
                        key={s.videoUrl}
                        style={[styles.serverPill, isSelected && styles.serverPillActive]}
                        onPress={() => selectServer(s, servers)}
                      >
                        <View style={[styles.serverDot, isSelected && styles.serverDotActive]} />
                        <Text style={[styles.serverText, isSelected && styles.serverTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </View>
          )}

          {/* Episodes Horizontal list */}
          <View style={styles.episodesSection}>
            <Text style={styles.sectionTitle}>EPISODES</Text>
            <FlatList
              data={Array.from({ length: totalEps }, (_, i) => i + 1)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => `ep-nav-${item}`}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => {
                const isCurrent = item === episode;
                return (
                  <TouchableOpacity
                    style={[styles.epPill, isCurrent && styles.epPillActive]}
                    onPress={() => navigation.navigate('Watch', { id, ep: item })}
                  >
                    <Text style={[styles.epText, isCurrent && styles.epTextActive]}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#888888',
    fontSize: 12,
    marginTop: 10,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 52,
    borderBottomWidth: 1,
    borderColor: '#141414',
    backgroundColor: '#0f0f0f',
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 8,
    flex: 1,
  },
  playerFrame: {
    aspectRatio: 16/9,
    width: '100%',
    backgroundColor: '#000000',
    position: 'relative',
  },
  playerPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  placeholderText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  placeholderSubText: {
    color: '#888888',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 32,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e50914',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },
  playCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e50914',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  playOverlayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    zIndex: 4,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  controlsScroll: {
    flex: 1,
  },
  controlsPadding: {
    padding: 16,
  },
  animeTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  episodeLabel: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 16,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 24,
    padding: 3,
    marginBottom: 20,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 20,
  },
  segmentBtnActive: {
    backgroundColor: '#e50914',
  },
  segmentText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  serversSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  serversRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  serverPillActive: {
    backgroundColor: '#e50914',
    borderColor: '#e50914',
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#888888',
    marginRight: 6,
  },
  serverDotActive: {
    backgroundColor: '#ffffff',
  },
  serverText: {
    color: '#aaaaaa',
    fontSize: 11,
    fontWeight: '600',
  },
  serverTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  episodesSection: {
    marginBottom: 12,
  },
  epPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  epPillActive: {
    backgroundColor: '#e50914',
    borderColor: '#e50914',
  },
  epText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '700',
  },
  epTextActive: {
    color: '#ffffff',
  },
});
