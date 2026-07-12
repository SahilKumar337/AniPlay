import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, FlatList, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Play, X, Bell, Search } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import { swrFetch } from '../utils/cache';
import {
  getTrending, getTopRated,
  getAiring, getMovies,
  getNewReleases, getPopularThisSeason,
  getSchedule, getCurrentSeason, getCover, getTitle
} from '../api/anilist';
import HeroBanner from '../components/HeroBanner';
import AnimeCard from '../components/AnimeCard';

export default function Home({ navigation }) {
  const { recentlyViewed, removeFromRecentlyViewed } = useApp();

  const [trending, setTrending] = useState([]);
  const [airing, setAiring] = useState([]);
  const [newReleases, setNewReleases] = useState([]);
  const [popularSeason, setPopularSeason] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [movies, setMovies] = useState([]);
  const [weekSchedule, setWeekSchedule] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;

    const set = (setter) => (data, isStale) => {
      if (live && data?.length) {
        setter(data.filter(a => getCover(a)));
      }
    };

    async function load() {
      // 1. Trending — show instantly from cache, triggers hero banner
      await swrFetch(
        'home_trending', 'trending',
        () => getTrending(1, 15),
        (data, stale) => { if (live && data?.length) { setTrending(data.filter(a => getCover(a))); if (live) setReady(true); } },
        () => { if (live) setReady(true); }
      );

      if (!live) return;

      // 2. All other sections in parallel, each independently cached
      await Promise.allSettled([
        swrFetch('home_airing', 'airing', () => getAiring(1, 20), set(setAiring), () => {}),
        swrFetch('home_newReleases', 'newReleases', () => getNewReleases(1, 20), set(setNewReleases), () => {}),
        swrFetch('home_popularSeason', 'popularSeason', () => getPopularThisSeason(1, 15), set(setPopularSeason), () => {}),
        swrFetch('home_topRated', 'topRated', () => getTopRated(1, 15), set(setTopRated), () => {}),
        swrFetch('home_movies', 'movies', () => getMovies(1, 12), set(setMovies), () => {}),
        swrFetch('home_schedule', 'schedule',
          async () => {
            const sched = await getSchedule(1, 30);
            return sched
              .filter(s => getCover(s.media))
              .map(s => ({ ...s.media, _schedEp: s.episode, _schedAt: s.airingAt }));
          },
          set(setWeekSchedule),
          () => {}
        ),
      ]);
    }

    load();
    return () => { live = false; };
  }, []);

  // Header options: Custom search and notifications icons
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <View style={styles.headerLeftWrapper}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>A</Text>
          </View>
          <Text style={styles.headerTitleText}>AniLab</Text>
        </View>
      ),
      headerRight: () => (
        <View style={styles.headerRightWrapper}>
          <TouchableOpacity 
            style={styles.headerIconBtn}
            onPress={() => navigation.navigate('Browse')}
          >
            <Search size={18} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn}>
            <Bell size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  if (!ready) {
    return (
      <View style={styles.skeletonContainer}>
        <ActivityIndicator size="large" color="#e50914" />
        <Text style={styles.skeletonText}>Loading AniLab...</Text>
      </View>
    );
  }

  // Personalize lists using KNN Recommendation System based on watch history
  const personalizedAiring = rankAnimeByKnn(airing, recentlyViewed);
  const personalizedNewReleases = rankAnimeByKnn(newReleases, recentlyViewed);
  const personalizedPopularSeason = rankAnimeByKnn(popularSeason, recentlyViewed);
  const personalizedTrending = rankAnimeByKnn(trending, recentlyViewed);
  const personalizedTopRated = rankAnimeByKnn(topRated.filter(a => a.format === 'TV'), recentlyViewed);
  const personalizedMovies = rankAnimeByKnn(movies, recentlyViewed);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 1. Hero Banner Carousel */}
      {trending.length > 0 && (
        <HeroBanner animes={trending} navigation={navigation} />
      )}

      {/* 2. Continue Watching (Recently Viewed) */}
      {recentlyViewed && recentlyViewed.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Continue Watching</Text>
          <FlatList
            data={recentlyViewed}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `recent-${item.anime.id}-${index}`}
            renderItem={({ item }) => {
              const cover = getCover(item.anime);
              const title = getTitle(item.anime);
              return (
                <View style={styles.recentCardWrapper}>
                  <TouchableOpacity
                    style={styles.recentCard}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('Watch', { id: item.anime.id, ep: item.episode })}
                  >
                    <Image source={{ uri: cover }} style={styles.recentImage} />
                    
                    {/* Ep badge */}
                    <View style={styles.recentEpBadge}>
                      <Play size={8} color="#fff" fill="#fff" />
                      <Text style={styles.recentEpText}>EP {item.episode}</Text>
                    </View>

                    {/* Remove button */}
                    <TouchableOpacity
                      style={styles.recentRemoveBtn}
                      onPress={() => removeFromRecentlyViewed(item.anime.id)}
                    >
                      <X size={10} color="#fff" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {title}
                  </Text>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* 3. New Episode Releases */}
      {personalizedNewReleases.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>New Episode Releases</Text>
              <Text style={styles.sectionSubtitle}>Last 2 weeks</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'new-releases' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedNewReleases}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `new-${item.id}`}
            renderItem={({ item }) => (
              <AnimeCard 
                anime={item} 
                navigation={navigation} 
                epLabel={item._latestEp} 
                showBadges={false} 
              />
            )}
          />
        </View>
      )}

      {/* 4. Top Airing */}
      {personalizedAiring.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Top Airing</Text>
              <Text style={styles.sectionSubtitle}>Trending now</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'airing' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedAiring}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `airing-${item.id}`}
            renderItem={({ item }) => (
              <AnimeCard anime={item} navigation={navigation} />
            )}
          />
        </View>
      )}

      {/* 5. Airing This Week Schedule */}
      {weekSchedule.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Airing This Week</Text>
              <Text style={styles.sectionSubtitle}>Next 7 days</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Schedule')}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={weekSchedule.slice(0, 15)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `week-${item.id}`}
            renderItem={({ item }) => {
              const airedDate = item._schedAt
                ? new Date(item._schedAt * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : '';
              return (
                <View style={styles.scheduleCardWrapper}>
                  <TouchableOpacity
                    style={styles.scheduleCard}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('AnimeDetail', { id: item.id })}
                  >
                    <Image source={{ uri: getCover(item) }} style={styles.scheduleImage} />
                    <View style={styles.scheduleInfoOverlay}>
                      {item._schedEp && (
                        <View style={styles.scheduleEpBadge}>
                          <Text style={styles.scheduleEpText}>EP {item._schedEp}</Text>
                        </View>
                      )}
                      {airedDate ? <Text style={styles.scheduleDateText}>{airedDate}</Text> : null}
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.scheduleTitle} numberOfLines={1}>
                    {getTitle(item)}
                  </Text>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* 6. Popular This Season */}
      {personalizedPopularSeason.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Popular This Season</Text>
              <Text style={styles.sectionSubtitle}>
                {(() => {
                  const { season, year } = getCurrentSeason();
                  return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`;
                })()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'seasonal' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedPopularSeason}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `season-${item.id}`}
            renderItem={({ item }) => (
              <AnimeCard anime={item} navigation={navigation} />
            )}
          />
        </View>
      )}

      {/* 7. Top Trending */}
      {personalizedTrending.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Top Trending</Text>
              <Text style={styles.sectionSubtitle}>All time</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'trending' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedTrending}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `trending-${item.id}`}
            renderItem={({ item, index }) => (
              <AnimeCard 
                anime={item} 
                navigation={navigation} 
                rank={index + 1} 
                width={120} 
                height={170} 
              />
            )}
          />
        </View>
      )}

      {/* 8. Top TV Series */}
      {personalizedTopRated.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Top TV Series</Text>
              <Text style={styles.sectionSubtitle}>Highest rated</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'top-rated' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedTopRated}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `rated-${item.id}`}
            renderItem={({ item }) => (
              <AnimeCard anime={item} navigation={navigation} />
            )}
          />
        </View>
      )}

      {/* 9. Top Movies */}
      {personalizedMovies.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Top Movies</Text>
              <Text style={styles.sectionSubtitle}>Films & specials</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Browse', { category: 'movies' })}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={personalizedMovies}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `movies-${item.id}`}
            renderItem={({ item }) => (
              <AnimeCard anime={item} navigation={navigation} />
            )}
          />
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  skeletonContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  headerLeftWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },
  brandBadge: {
    width: 28,
    height: 28,
    backgroundColor: '#e50914',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  brandBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  headerTitleText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  headerIconBtn: {
    padding: 8,
    marginRight: 8,
  },
  section: {
    paddingTop: 16,
    paddingLeft: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  seeAllText: {
    color: '#e50914',
    fontSize: 12,
    fontWeight: '600',
    paddingBottom: 2,
  },
  recentCardWrapper: {
    width: 120,
    marginRight: 12,
    marginBottom: 8,
  },
  recentCard: {
    height: 155,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#141414',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  recentImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  recentEpBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: '#e50914',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentEpText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    marginLeft: 3,
  },
  recentRemoveBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: {
    color: '#eaeaea',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 14,
  },
  scheduleCardWrapper: {
    width: 100,
    marginRight: 12,
    marginBottom: 8,
  },
  scheduleCard: {
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#141414',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  scheduleImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  scheduleInfoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 6,
  },
  scheduleEpBadge: {
    backgroundColor: '#e50914',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  scheduleEpText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '800',
  },
  scheduleDateText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 8,
    fontWeight: '600',
  },
  scheduleTitle: {
    color: '#eaeaea',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 14,
  },
});
