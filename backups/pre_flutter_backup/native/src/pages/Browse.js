import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, FlatList, Image, ActivityIndicator } from 'react-native';
import { Search, SlidersHorizontal, X, Star, Play, Tag } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import { searchAndRankAnime } from '../utils/searchEngine';
import {
  searchAnime, getTitle, getCover,
  getTrending, getAiring, getSeasonal,
  getMostPopular, getTopRated, getMovies, getCurrentSeason
} from '../api/anilist';

const GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mecha','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Thriller','Supernatural'];
const FORMATS = [
  { label: 'All', value: null },
  { label: 'TV',  value: 'TV' },
  { label: 'Movie', value: 'MOVIE' },
  { label: 'OVA', value: 'OVA' },
  { label: 'ONA', value: 'ONA' },
];
const STATUSES = [
  { label: 'All',      value: null        },
  { label: 'Airing',   value: 'RELEASING' },
  { label: 'Finished', value: 'FINISHED'  },
  { label: 'Upcoming', value: 'NOT_YET_RELEASED' },
];

const CATEGORY_TITLES = {
  'airing': 'Top Airing',
  'new-releases': 'New Episode Releases',
  'trending': 'Top Hits Anime',
  'seasonal': 'This Season',
  'popular': 'Most Favorite',
  'top-rated': 'Top TV Series',
  'movies': 'Top Movies'
};

export default function Browse({ route, navigation }) {
  const { recentlyViewed } = useApp();
  
  const passedCategory = route.params?.category || null;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [genre, setGenre] = useState(null);
  const [format, setFormat] = useState(null);
  const [status, setStatus] = useState(null);
  const [category, setCategory] = useState(passedCategory);
  
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);

  // Debounce query search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 400);
    return () => clearTimeout(handler);
  }, [query]);

  // Sync route category param when navigating
  useEffect(() => {
    if (route.params?.category) {
      setCategory(route.params.category);
    }
  }, [route.params?.category]);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      if (debouncedQuery || genre || format || status) {
        // Clear category filter when user uses active search/filters
        setCategory(null);
        
        const searchResults = await searchAnime(
          debouncedQuery || null, 1, 30,
          genre, format, status
        );

        let finalCandidates = searchResults;

        if (debouncedQuery) {
          const [trendPool, popPool] = await Promise.all([
            getTrending(1, 40).catch(() => []),
            getMostPopular(1, 40).catch(() => [])
          ]);

          const combined = [...searchResults, ...trendPool, ...popPool];
          const seen = new Set();
          finalCandidates = combined.filter(item => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });

          // Run full 4-layer matching algorithm
          finalCandidates = searchAndRankAnime(debouncedQuery, finalCandidates);
        }

        setResults(finalCandidates);
      } else if (category) {
        let r = [];
        if (category === 'airing') {
          r = await getAiring(1, 24);
        } else if (category === 'new-releases') {
          const list = await getAiring(1, 24);
          r = [...list].reverse();
        } else if (category === 'trending') {
          r = await getTrending(1, 24);
        } else if (category === 'seasonal') {
          const { season, year } = getCurrentSeason();
          r = await getSeasonal(season, year, 1, 24);
        } else if (category === 'popular') {
          r = await getMostPopular(1, 24);
        } else if (category === 'top-rated') {
          const list = await getTopRated(1, 24);
          r = list.filter(a => a.format === 'TV');
        } else if (category === 'movies') {
          r = await getMovies(1, 24);
        }
        setResults(r);
      } else {
        const r = await searchAnime(null, 1, 24);
        setResults(r);
      }
    } catch (e) {
      console.warn('[Browse] Search query failed:', e.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, genre, format, status, category]);

  useEffect(() => {
    doSearch();
  }, [doSearch]);

  const categoryTitle = category ? CATEGORY_TITLES[category] : null;

  // Personalize results using KNN if the user is not actively searching text
  const personalizedResults = debouncedQuery ? results : rankAnimeByKnn(results, recentlyViewed);

  const handleClearSearch = () => {
    setQuery('');
    setDebouncedQuery('');
  };

  const handleClearCategory = () => {
    setCategory(null);
    setFormat(null);
    setStatus(null);
    setGenre(null);
    navigation.setParams({ category: null });
  };

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.searchHeader}>
        <View style={styles.searchBar}>
          <Search size={16} color="#888888" style={styles.searchIcon} />
          <TextInput
            placeholder={categoryTitle ? `Search in ${categoryTitle}...` : "Search anime..."}
            placeholderTextColor="#888888"
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            clearButtonMode="never"
          />
          {query ? (
            <TouchableOpacity onPress={handleClearSearch} style={styles.clearIconBtn}>
              <X size={14} color="#888888" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, showFilter && styles.filterBtnActive]}
          onPress={() => setShowFilter(!showFilter)}
        >
          <SlidersHorizontal size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Slide-out Filters Panel */}
      {showFilter ? (
        <View style={styles.filterPanel}>
          {/* Format */}
          <Text style={styles.filterTitle}>Format</Text>
          <View style={styles.pillsRow}>
            {FORMATS.map(f => (
              <TouchableOpacity
                key={f.value || 'all-f'}
                style={[styles.pill, format === f.value && styles.pillActive]}
                onPress={() => setFormat(f.value)}
              >
                <Text style={[styles.pillText, format === f.value && styles.pillTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Status */}
          <Text style={styles.filterTitle}>Status</Text>
          <View style={styles.pillsRow}>
            {STATUSES.map(s => (
              <TouchableOpacity
                key={s.value || 'all-s'}
                style={[styles.pill, status === s.value && styles.pillActive]}
                onPress={() => setStatus(s.value)}
              >
                <Text style={[styles.pillText, status === s.value && styles.pillTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* Horizontal Genre Selector */}
      <View style={styles.genreBar}>
        <FlatList
          data={[null, ...GENRES]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item || 'all-g'}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.pill, genre === item && styles.pillActive, { marginHorizontal: 4 }]}
              onPress={() => setGenre(item)}
            >
              <Text style={[styles.pillText, genre === item && styles.pillTextActive]}>{item || 'All Genres'}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Category Indicator Card */}
      {categoryTitle ? (
        <View style={styles.categoryCard}>
          <View>
            <View style={styles.categoryBadgeRow}>
              <Tag size={9} color="#e50914" />
              <Text style={styles.categoryBadgeText}>CATEGORY FILTER</Text>
            </View>
            <Text style={styles.categoryNameText}>{categoryTitle}</Text>
          </View>
          <TouchableOpacity style={styles.categoryClearBtn} onPress={handleClearCategory}>
            <Text style={styles.categoryClearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Result list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#e50914" />
        </View>
      ) : personalizedResults.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Search size={48} color="#444" />
          <Text style={styles.emptyTitle}>No anime found</Text>
          <Text style={styles.emptySub}>Try adjusting search query or filters</Text>
        </View>
      ) : (
        <FlatList
          data={personalizedResults}
          keyExtractor={(item) => `search-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          renderItem={({ item }) => {
            const title = getTitle(item);
            const cover = getCover(item);
            const score = item.averageScore ? (item.averageScore / 10).toFixed(1) : null;
            return (
              <TouchableOpacity
                style={styles.resultItem}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('AnimeDetail', { id: item.id })}
              >
                <Image source={{ uri: cover }} style={styles.resultThumb} />
                <View style={styles.resultDetails}>
                  <Text style={styles.resultTitle} numberOfLines={2}>
                    {title}
                  </Text>
                  
                  {/* Meta tag row */}
                  <View style={styles.metaRow}>
                    {score ? (
                      <View style={styles.scoreRow}>
                        <Star size={11} color="#f5c518" fill="#f5c518" />
                        <Text style={styles.scoreText}>{score}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.metaText}>{item.format || 'TV'}</Text>
                    {item.startDate?.year ? <Text style={styles.metaText}>{item.startDate.year}</Text> : null}
                    {item.episodes ? <Text style={styles.metaText}>{item.episodes} eps</Text> : null}
                    {item.status ? (
                      <Text style={[styles.statusText, item.status === 'RELEASING' && styles.statusAiring]}>
                        {item.status === 'RELEASING' ? 'Airing' : 'Finished'}
                      </Text>
                    ) : null}
                  </View>

                  {/* Genre tags */}
                  <View style={styles.genreTags}>
                    {item.genres?.slice(0, 3).map(g => (
                      <View key={g} style={styles.genreTag}>
                        <Text style={styles.genreTagText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBar: {
    flex: 1,
    height: 40,
    backgroundColor: '#141414',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    height: '100%',
  },
  clearIconBtn: {
    padding: 6,
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  filterBtnActive: {
    borderColor: '#e50914',
    backgroundColor: 'rgba(229, 9, 20, 0.15)',
  },
  filterPanel: {
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  filterTitle: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#141414',
    marginRight: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  pillActive: {
    backgroundColor: '#e50914',
    borderColor: '#e50914',
  },
  pillText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  genreBar: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: '#141414',
  },
  categoryCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(229, 9, 20, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#e50914',
    marginLeft: 4,
    letterSpacing: 1,
  },
  categoryNameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  categoryClearBtn: {
    backgroundColor: 'rgba(229, 9, 20, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryClearBtnText: {
    color: '#e50914',
    fontSize: 10,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 12,
  },
  emptySub: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  resultItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#121212',
    alignItems: 'center',
  },
  resultThumb: {
    width: 60,
    height: 80,
    borderRadius: 6,
    backgroundColor: '#141414',
    marginRight: 12,
    resizeMode: 'cover',
  },
  resultDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  resultTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  scoreText: {
    color: '#f5c518',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 3,
  },
  metaText: {
    color: '#888888',
    fontSize: 11,
    marginRight: 8,
    fontWeight: '500',
  },
  statusText: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '600',
  },
  statusAiring: {
    color: '#4caf50',
  },
  genreTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  genreTag: {
    backgroundColor: '#141414',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  genreTagText: {
    color: '#aaaaaa',
    fontSize: 9,
    fontWeight: '600',
  },
});
