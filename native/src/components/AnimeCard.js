import React, { useState } from 'react';
import { TouchableOpacity, Image, View, Text, StyleSheet } from 'react-native';
import { Play } from 'lucide-react-native';
import { getTitle, getCover, getColor } from '../api/anilist';

export default function AnimeCard({
  anime,
  navigation,
  width = 110,
  height = 160,
  rank = null,
  epLabel = null,
  showBadges = true,
  style = {},
}) {
  const [imgError, setImgError] = useState(false);
  const title = getTitle(anime);
  const cover = getCover(anime);
  const color = getColor(anime);

  const handlePress = () => {
    navigation.navigate('AnimeDetail', { id: anime.id });
  };

  return (
    <TouchableOpacity
      style={[styles.cardContainer, { width }, style]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <View style={[styles.imageContainer, { height }]}>
        {cover && !imgError ? (
          <Image
            source={{ uri: cover }}
            style={styles.image}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.fallbackContainer, { backgroundColor: `${color}15` }]}>
            <Play size={20} color={color} fill={color} />
          </View>
        )}

        {/* Ep label (Top Left) */}
        {epLabel && !rank && (
          <View style={styles.epBadge}>
            <Text style={styles.epBadgeText}>EP {epLabel}</Text>
          </View>
        )}

        {/* Rank Number (overlay bottom left) */}
        {rank !== null && (
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>{rank}</Text>
          </View>
        )}

        {/* Top-right score badge */}
        {showBadges && anime.averageScore && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>⭐ {Math.round(anime.averageScore) / 10}</Text>
          </View>
        )}
      </View>

      {/* Text block below card */}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    marginRight: 12,
    marginBottom: 8,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#141414',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  fallbackContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  epBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: '#e50914',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  epBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  rankBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  rankBadgeText: {
    color: '#e50914',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  scoreBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
  },
  scoreBadgeText: {
    color: '#ffc107',
    fontSize: 9,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#eaeaea',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    paddingHorizontal: 2,
    lineHeight: 14,
  },
});
