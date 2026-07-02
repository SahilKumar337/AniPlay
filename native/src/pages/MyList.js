import React, { useState } from 'react';
import { StyleSheet, View, Text, FlatList, Image, TouchableOpacity, Dimensions } from 'react-native';
import { Bookmark, Heart, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';

const { width } = Dimensions.get('window');

const TABS = [
  { id: 'all',           label: 'All' },
  { id: 'favourites',    label: 'Favourites' },
  { id: 'watching',      label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan' },
  { id: 'completed',     label: 'Completed' },
  { id: 'dropped',       label: 'Dropped' },
];

export default function MyList({ navigation }) {
  const { watchlist, removeFromWatchlist, progress, isFavorite, toggleFavorite } = useApp();
  const [activeTab, setActiveTab] = useState('all');

  const items = Object.values(watchlist);
  const filtered = activeTab === 'all'
    ? items
    : activeTab === 'favourites'
      ? items.filter(item => isFavorite(item.anime.id))
      : items.filter(item => item.status === activeTab);

  return (
    <View style={styles.container}>
      {/* Subheader and count */}
      <View style={styles.subheader}>
        <Text style={styles.countText}>{filtered.length} anime filtered</Text>
      </View>

      {/* Tabs list */}
      <View style={styles.tabBar}>
        <FlatList
          data={TABS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === item.id && styles.tabBtnActive]}
              onPress={() => setActiveTab(item.id)}
            >
              <Text style={[styles.tabBtnText, activeTab === item.id && styles.tabBtnTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Grid Content */}
      {filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Bookmark size={48} color="#444" />
          <Text style={styles.emptyTitle}>No anime here</Text>
          <Text style={styles.emptySub}>
            Tap the bookmark icon on any anime page to add it here
          </Text>
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => navigation.navigate('HomeTab')}
          >
            <Text style={styles.browseBtnText}>Browse Anime</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          numColumns={3}
          key={`mylist-cols-3`}
          keyExtractor={(item) => `list-${item.anime.id}`}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => {
            const anime = item.anime;
            const status = item.status;
            const title = getTitle(anime);
            const cover = getCover(anime);
            const ep = progress[anime.id];
            const isFav = isFavorite(anime.id);

            return (
              <View style={styles.cardWrapper}>
                <TouchableOpacity
                  style={styles.card}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('AnimeDetail', { id: anime.id })}
                >
                  <Image source={{ uri: cover }} style={styles.cardImage} />

                  {/* Status Badge */}
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
                    <Text style={styles.statusBadgeText}>{statusLabel(status)}</Text>
                  </View>

                  {/* Favorite Heart indicator */}
                  {isFav ? (
                    <View style={styles.favBadge}>
                      <Heart size={8} color="#e50914" fill="#e50914" />
                    </View>
                  ) : null}

                  {/* Progress Line */}
                  {ep && anime.episodes ? (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressBar, { width: `${(ep.episode / anime.episodes) * 100}%` }]} />
                    </View>
                  ) : null}

                  {/* Remove Button */}
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => {
                      removeFromWatchlist(anime.id);
                      if (isFav) toggleFavorite(anime.id);
                    }}
                  >
                    <XCircle size={14} color="#fff" />
                  </TouchableOpacity>
                </TouchableOpacity>

                <Text style={styles.cardTitle} numberOfLines={1}>
                  {title}
                </Text>
                {ep ? (
                  <Text style={styles.progressText}>Watched Ep {ep.episode}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function statusColor(status) {
  switch (status) {
    case 'watching':      return '#4caf50';
    case 'completed':     return '#2196f3';
    case 'dropped':       return '#9e9e9e';
    case 'plan_to_watch': return '#e50914';
    default:              return '#e50914';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'watching':      return 'Watch';
    case 'completed':     return 'Done';
    case 'dropped':       return 'Drop';
    case 'plan_to_watch': return 'Plan';
    default:              return 'List';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  subheader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  countText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '500',
  },
  tabBar: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#141414',
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#141414',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  tabBtnActive: {
    backgroundColor: '#e50914',
    borderColor: '#e50914',
  },
  tabBtnText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#ffffff',
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
    marginBottom: 20,
  },
  browseBtn: {
    backgroundColor: '#e50914',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  browseBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
  },
  cardWrapper: {
    width: (width - 40) / 3,
    marginHorizontal: 4,
    marginBottom: 16,
  },
  card: {
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#141414',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  statusBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  favBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#e50914',
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: 2,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
  },
  cardTitle: {
    color: '#eaeaea',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  progressText: {
    color: '#e50914',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    paddingHorizontal: 2,
  },
});
