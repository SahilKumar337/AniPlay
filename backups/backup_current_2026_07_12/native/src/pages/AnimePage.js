import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, Image, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, Share } from 'react-native';
import { Bookmark, Star, Play, Download, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react-native';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { swrFetch } from '../utils/cache';
import { useApp } from '../context/AppContext';
import AnimeCard from '../components/AnimeCard';

const { width } = Dimensions.get('window');

export default function AnimePage({ route, navigation }) {
  const { id } = route.params;
  const {
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    toggleFavorite, isFavorite, getEpisodeProgress
  } = useApp();

  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('episodes');
  const [synOpen, setSynOpen] = useState(false);
  const [epQuery, setEpQuery] = useState('');

  const loadDetail = useCallback(() => {
    setError('');
    swrFetch(
      `anime_detail_${id}`,
      'animeDetail',
      () => getAnimeDetail(Number(id)),
      (data, stale) => {
        setAnime(data);
        setIsStale(stale);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to load details');
        setLoading(false);
      }
    );
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleShare = async () => {
    if (!anime) return;
    try {
      await Share.share({
        message: `Check out ${getTitle(anime)} on AniLab!`,
        url: `https://anilist.co/anime/${anime.id}`,
      });
    } catch (e) {
      console.warn('Share error:', e.message);
    }
  };

  // Configure navigation header title and actions
  useEffect(() => {
    if (anime) {
      const title = getTitle(anime);
      const isFav = isFavorite(anime.id);

      navigation.setOptions({
        title: title,
        headerTitleStyle: {
          fontSize: 15,
          fontWeight: '800',
        },
        headerRight: () => (
          <View style={styles.headerRightWrapper}>
            <TouchableOpacity 
              style={styles.headerIconBtn} 
              onPress={() => toggleFavorite(anime.id, anime)}
            >
              <Bookmark size={18} color={isFav ? '#e50914' : '#ffffff'} fill={isFav ? '#e50914' : 'none'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} onPress={handleShare}>
              <Play size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [anime, isFavorite, navigation]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#e50914" />
      </View>
    );
  }

  if (error || !anime) {
    return (
      <View style={styles.centerContainer}>
        <AlertCircle size={48} color="#e50914" style={{ marginBottom: 12 }} />
        <Text style={styles.errorTitle}>Couldn't load anime</Text>
        <Text style={styles.errorSub}>{error}</Text>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.retryBtn} onPress={loadDetail}>
            <RefreshCw size={14} color="#fff" />
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const title = getTitle(anime);
  const cover = getCover(anime);
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const eps = anime.episodes || 0;
  const studios = anime.studios?.nodes?.map(s => s.name).join(', ') || '';
  const desc = (anime.description || 'No description available.')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
  const prog = getEpisodeProgress(anime.id);
  const isNotReleased = anime.status === 'NOT_YET_RELEASED';
  
  const totalEps = isNotReleased ? 0 : (
    anime.nextAiringEpisode 
      ? anime.nextAiringEpisode.episode - 1 
      : (eps || 12)
  );
  
  const resumeEp = prog?.episode ? Math.min(prog.episode, totalEps) : 1;
  const allEps = Array.from({ length: totalEps }, (_, i) => i + 1);
  const filteredEps = epQuery ? allEps.filter(n => String(n).includes(epQuery.trim())) : allEps;
  
  const recs = anime.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || [];
  const chars = (anime.characters?.edges || []).map(e => ({ ...e.node, voiceActors: e.voiceActors || [] }));

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 1. Blurred Banner + Cover Image */}
      <View style={styles.heroWrapper}>
        <Image source={{ uri: cover }} style={styles.heroBlurImage} blurRadius={15} />
        <View style={styles.heroDim} />
        <Image source={{ uri: cover }} style={styles.heroImage} />
        <View style={styles.heroGradient} />
      </View>

      {/* Stale refresh indicator */}
      {isStale && (
        <View style={styles.staleIndicator}>
          <ActivityIndicator size="small" color="#e50914" style={{ marginRight: 6 }} />
          <Text style={styles.staleText}>Updating...</Text>
        </View>
      )}

      {/* 2. Title & Studio */}
      <View style={styles.metaSection}>
        <Text style={styles.mainTitle}>{title}</Text>
        {studios ? <Text style={styles.studioText}>Studio: {studios}</Text> : null}
      </View>

      {/* 3. Metadata Badges */}
      <View style={styles.badgesRow}>
        {score ? (
          <View style={styles.scoreBadge}>
            <Star size={12} color="#f5c518" fill="#f5c518" />
            <Text style={styles.scoreBadgeText}>{score}</Text>
          </View>
        ) : null}
        {anime.startDate?.year ? <Text style={styles.badgeLabel}>{anime.startDate.year}</Text> : null}
        <Text style={styles.badgePG}>PG-13</Text>
        <Text style={styles.badgeHD}>HD</Text>
        {anime.format ? <Text style={styles.badgeFormat}>{anime.format.replace('_', ' ')}</Text> : null}
        {totalEps > 0 ? <Text style={styles.badgeEps}>{totalEps} eps</Text> : null}
      </View>

      {/* 4. Action Buttons */}
      <View style={styles.actionsRow}>
        {isNotReleased ? (
          <View style={styles.notReleasedBadge}>
            <AlertCircle size={16} color="rgba(255,255,255,0.4)" />
            <Text style={styles.notReleasedText}>Not Yet Released</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.playBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Watch', { id: anime.id, ep: resumeEp })}
            >
              <Play size={16} color="#fff" fill="#fff" />
              <Text style={styles.playBtnText}>
                {prog && resumeEp > 0 ? `Resume Ep ${resumeEp}` : 'Play'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.downloadBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Watch', { id: anime.id, ep: resumeEp })}
            >
              <Download size={16} color="#fff" />
              <Text style={styles.playBtnText}>Download</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* 5. Genre Tags & Synopsis Description */}
      <View style={styles.synopsisSection}>
        <Text style={styles.genreLabel}>
          <Text style={{ fontWeight: '700', color: '#fff' }}>Genres: </Text>
          {anime.genres?.slice(0, 5).join(', ')}
        </Text>
        <Text style={styles.synopsisText} numberOfLines={synOpen ? undefined : 4}>
          {desc}
        </Text>
        <TouchableOpacity style={styles.moreBtn} onPress={() => setSynOpen(!synOpen)}>
          <Text style={styles.moreBtnText}>{synOpen ? 'View Less' : '... View More'}</Text>
          {synOpen ? <ChevronUp size={12} color="#e50914" /> : <ChevronDown size={12} color="#e50914" />}
        </TouchableOpacity>
      </View>

      {/* 6. Tabs Header */}
      <View style={styles.tabHeader}>
        {[
          { k: 'episodes', l: 'Episodes' },
          { k: 'similar', l: 'More Like This' },
          { k: 'characters', l: 'Characters' },
        ].map(t => (
          <TouchableOpacity
            key={t.k}
            style={[styles.tabBtn, tab === t.k && styles.tabBtnActive]}
            onPress={() => setTab(t.k)}
          >
            <Text style={[styles.tabBtnText, tab === t.k && styles.tabBtnTextActive]}>{t.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 7. Tab Content */}
      <View style={styles.tabContent}>
        {/* Episodes */}
        {tab === 'episodes' && (
          <View>
            <View style={styles.epSearchHeader}>
              <Text style={styles.epCountTitle}>Episodes ({totalEps})</Text>
              <View style={styles.epSearchBox}>
                <Search size={12} color="#888888" />
                <TextInput
                  placeholder="Ep #"
                  placeholderTextColor="#888888"
                  keyboardType="numeric"
                  value={epQuery}
                  onChangeText={setEpQuery}
                  style={styles.epSearchInput}
                />
              </View>
            </View>

            <View style={styles.epGrid}>
              {filteredEps.map(n => {
                const isWatched = prog?.episode > n;
                const isCurrent = prog?.episode === n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.epCard, isCurrent && styles.epCardCurrent]}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('Watch', { id: anime.id, ep: n })}
                  >
                    <View style={styles.epThumbWrapper}>
                      <Image source={{ uri: cover }} style={[styles.epThumb, isWatched && styles.epThumbWatched]} />
                      <View style={styles.epPlayCircle}>
                        <Play size={10} color="#fff" fill="#fff" />
                      </View>
                      {isWatched ? (
                        <View style={styles.watchedCheck}>
                          <Text style={styles.checkText}>✓</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.epLabel}>
                      <Text style={[styles.epLabelText, isCurrent && styles.epLabelTextCurrent]}>Episode {n}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Similar / Recommendations */}
        {tab === 'similar' && (
          <View style={styles.similarGrid}>
            {recs.length === 0 ? (
              <Text style={styles.emptyTabText}>No recommendations available</Text>
            ) : (
              recs.map(r => (
                <AnimeCard
                  key={r.id}
                  anime={r}
                  navigation={navigation}
                  width={(width - 48) / 3}
                  height={150}
                  style={{ marginRight: 0, marginBottom: 12 }}
                />
              ))
            )}
          </View>
        )}

        {/* Characters */}
        {tab === 'characters' && (
          <View style={styles.charList}>
            {chars.length === 0 ? (
              <Text style={styles.emptyTabText}>No character data available</Text>
            ) : (
              chars.map(c => {
                const va = c.voiceActors?.[0];
                return (
                  <View key={c.id} style={styles.charRow}>
                    <View style={styles.charHalf}>
                      <Image source={{ uri: c.image?.large }} style={styles.charAvatar} />
                      <View style={{ marginLeft: 8 }}>
                        <Text style={styles.charName} numberOfLines={1}>{c.name?.full}</Text>
                        <Text style={styles.charSub}>Character</Text>
                      </View>
                    </View>
                    {va ? (
                      <View style={styles.vaHalf}>
                        <View style={{ marginRight: 8, alignItems: 'flex-end' }}>
                          <Text style={styles.charName} numberOfLines={1}>{va.name?.full}</Text>
                          <Text style={styles.charSub}>Voice Actor</Text>
                        </View>
                        <Image source={{ uri: va.image?.large }} style={styles.charAvatar} />
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
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
    padding: 24,
  },
  headerRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  headerIconBtn: {
    padding: 8,
    marginLeft: 8,
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  errorSub: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 240,
  },
  btnRow: {
    flexDirection: 'row',
  },
  retryBtn: {
    backgroundColor: '#e50914',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 10,
  },
  backBtn: {
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
  },
  heroWrapper: {
    height: 220,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroBlurImage: {
    ...StyleSheet.absoluteFillObject,
    resizeMode: 'cover',
  },
  heroDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.5)',
  },
  heroImage: {
    height: '80%',
    aspectRatio: 2/3,
    borderRadius: 8,
    zIndex: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    backgroundColor: '#0a0a0a',
    opacity: 0.9,
  },
  metaSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  mainTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 26,
  },
  studioText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  badgesRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  scoreBadgeText: {
    color: '#f5c518',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 3,
  },
  badgeLabel: {
    color: '#888888',
    fontSize: 12,
    marginRight: 8,
    fontWeight: '600',
  },
  badgePG: {
    fontSize: 9,
    color: '#ffffff',
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    fontWeight: '700',
  },
  badgeHD: {
    fontSize: 9,
    color: '#e50914',
    borderWidth: 1,
    borderColor: '#e50914',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 8,
    fontWeight: '700',
  },
  badgeFormat: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
    marginRight: 8,
  },
  badgeEps: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
  },
  actionsRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  playBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#e50914',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
  downloadBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#b50010',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notReleasedBadge: {
    flex: 1,
    height: 44,
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notReleasedText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  synopsisSection: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  genreLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  synopsisText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  moreBtnText: {
    color: '#e50914',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 4,
  },
  tabHeader: {
    flexDirection: 'row',
    marginTop: 24,
    borderBottomWidth: 1,
    borderColor: '#141414',
    paddingHorizontal: 16,
  },
  tabBtn: {
    paddingVertical: 12,
    marginRight: 18,
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  tabBtnActive: {
    borderColor: '#e50914',
  },
  tabBtnText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#e50914',
    fontWeight: '700',
  },
  tabContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  epSearchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  epCountTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  epSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 30,
    width: 90,
  },
  epSearchInput: {
    color: '#ffffff',
    fontSize: 11,
    marginLeft: 6,
    flex: 1,
    height: '100%',
    padding: 0,
  },
  epGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  epCard: {
    width: (width - 48) / 3,
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 8,
  },
  epCardCurrent: {
    borderColor: '#e50914',
  },
  epThumbWrapper: {
    aspectRatio: 16/9,
    backgroundColor: '#141414',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  epThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  epThumbWatched: {
    opacity: 0.4,
  },
  epPlayCircle: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(229,9,20,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#4caf50',
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '800',
  },
  epLabel: {
    padding: 5,
  },
  epLabelText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  epLabelTextCurrent: {
    color: '#e50914',
  },
  similarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emptyTabText: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 32,
    width: '100%',
  },
  charList: {
    gap: 8,
  },
  charRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  charHalf: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
  },
  vaHalf: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: '48%',
  },
  charAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#141414',
    resizeMode: 'cover',
  },
  charName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  charSub: {
    color: '#888888',
    fontSize: 9,
    marginTop: 1,
  },
  staleIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(229, 9, 20, 0.1)',
    borderBottomWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.2)',
    paddingVertical: 6,
  },
  staleText: {
    color: '#e50914',
    fontSize: 11,
    fontWeight: '700',
  },
});
