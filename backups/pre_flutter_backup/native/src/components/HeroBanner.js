import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Dimensions, Animated } from 'react-native';
import { Play, Plus, Check, AlertCircle } from 'lucide-react-native';
import { getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';

const { width } = Dimensions.get('window');
const AUTO_INTERVAL = 5000;

export default function HeroBanner({ animes = [], navigation }) {
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [current, setCurrent] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);
  const total = Math.min(animes.length, 6);

  const advance = useCallback((to) => {
    if (!total) return;
    const target = to !== undefined ? to : (current + 1) % total;

    // Fade out -> Change slide -> Fade in
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setCurrent(target);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    });
  }, [current, total, fadeAnim]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (total > 1) {
      timerRef.current = setInterval(() => advance(), AUTO_INTERVAL);
    }
  }, [advance, total]);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resetTimer]);

  if (!animes.length) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loader} />
      </View>
    );
  }

  const featured = animes[current];
  const title = getTitle(featured);
  const cover = getCover(featured);
  const inList = isInWatchlist(featured.id);

  const goTo = (idx) => {
    if (idx === current) return;
    advance(idx);
    resetTimer();
  };

  return (
    <View style={styles.heroContainer}>
      {/* Background blurred cover */}
      <Image
        source={{ uri: cover }}
        style={StyleSheet.absoluteFillObject}
        blurRadius={20}
      />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(10,10,10,0.65)' }]} />

      {/* Main Content (Animated) */}
      <Animated.View style={[styles.contentContainer, { opacity: fadeAnim }]}>
        {/* Cover image (Right) */}
        <View style={styles.coverWrapper}>
          <Image source={{ uri: cover }} style={styles.coverImage} />
        </View>

        {/* Text Details (Left) */}
        <View style={styles.detailsWrapper}>
          {/* Genres */}
          <Text style={styles.genres} numberOfLines={1}>
            {featured.genres?.slice(0, 3).join(', ')}
          </Text>

          {/* Title */}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>

          {/* Buttons Row */}
          <View style={styles.buttonRow}>
            {featured.status === 'NOT_YET_RELEASED' ? (
              <View style={styles.comingSoonBadge}>
                <AlertCircle size={12} color="rgba(255,255,255,0.6)" />
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.playButton}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Watch', { id: featured.id, ep: 1 })}
              >
                <Play size={14} color="#fff" fill="#fff" />
                <Text style={styles.playButtonText}>Play</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.listButton}
              activeOpacity={0.8}
              onPress={() => (inList ? removeFromWatchlist(featured.id) : addToWatchlist(featured))}
            >
              {inList ? <Check size={14} color="#fff" /> : <Plus size={14} color="#fff" />}
              <Text style={styles.listButtonText}>{inList ? 'Added' : 'My List'}</Text>
            </TouchableOpacity>
          </View>

          {/* Slide Indicator Dots */}
          <View style={styles.dotsContainer}>
            {Array.from({ length: total }).map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => goTo(i)}
                style={[
                  styles.dot,
                  i === current ? styles.activeDot : styles.inactiveDot,
                ]}
              />
            ))}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    height: 250,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#e50914',
    borderTopColor: 'transparent',
  },
  heroContainer: {
    height: 270,
    position: 'relative',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderColor: '#141414',
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  coverWrapper: {
    width: '40%',
    height: '80%',
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  detailsWrapper: {
    width: '56%',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  genres: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    marginBottom: 12,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  playButton: {
    backgroundColor: '#e50914',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
  },
  comingSoonBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  comingSoonText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  listButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    height: 3,
    borderRadius: 3,
    marginRight: 4,
  },
  activeDot: {
    width: 18,
    backgroundColor: '#e50914',
  },
  inactiveDot: {
    width: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
});
