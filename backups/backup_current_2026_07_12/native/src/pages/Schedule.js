import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Search, Plus, Check } from 'lucide-react-native';
import { getSchedule, getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function Schedule({ navigation }) {
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(() => {
    const d = new Date().getDay(); // 0=Sun
    return d === 0 ? 6 : d - 1; // convert Sun to 6, Mon to 0
  });

  useEffect(() => {
    getSchedule(1, 50)
      .then(setSchedule)
      .catch(() => setSchedule([]))
      .finally(() => setLoading(false));
  }, []);

  // Group items by day of the week
  const byDay = DAYS.map((_, idx) => {
    return schedule.filter(item => {
      const d = new Date(item.airingAt * 1000).getDay();
      const normalized = d === 0 ? 6 : d - 1;
      return normalized === idx;
    });
  });

  const dayItems = byDay[activeDay] || [];
  
  // Group active day items by hour slot (e.g. 18:00)
  const grouped = {};
  dayItems.forEach(item => {
    const hour = new Date(item.airingAt * 1000).getHours();
    const key = `${String(hour).padStart(2,'0')}:00`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });
  
  const timeKeys = Object.keys(grouped).sort();
  const now = Date.now() / 1000;
  const currentHourKey = `${String(new Date().getHours()).padStart(2,'0')}:00`;

  // Get date day numbers for this week based on offset
  const todayDate = new Date();
  const dayNum = (offset) => {
    const d = new Date(todayDate);
    const todayDay = todayDate.getDay() === 0 ? 6 : todayDate.getDay() - 1;
    d.setDate(d.getDate() + (offset - todayDay));
    return d.getDate();
  };

  // Header Search button integration
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={{ marginRight: 16, padding: 8 }}
          onPress={() => navigation.navigate('Browse')}
        >
          <Search size={18} color="#ffffff" />
        </TouchableOpacity>
      )
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Day Tabs */}
      <View style={styles.tabBar}>
        {DAYS.map((day, idx) => (
          <TouchableOpacity
            key={day}
            style={[styles.tabBtn, activeDay === idx && styles.tabBtnActive]}
            onPress={() => setActiveDay(idx)}
          >
            <Text style={[styles.tabDayName, activeDay === idx && styles.tabDayNameActive]}>{day}</Text>
            <Text style={[styles.tabDayNum, activeDay === idx && styles.tabDayNumActive]}>{dayNum(idx)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Main Scrollable Timeline */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#e50914" />
        </View>
      ) : dayItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No schedule for this day</Text>
          <Text style={styles.emptySub}>Try another day</Text>
        </View>
      ) : (
        <ScrollView style={styles.timelineScroll} showsVerticalScrollIndicator={false}>
          {timeKeys.map(timeKey => {
            const isCurrent = timeKey === currentHourKey;
            return (
              <View key={timeKey} style={styles.timeGroup}>
                {/* Time slot indicator */}
                <View style={styles.timeHeader}>
                  <Text style={[styles.timeLabel, isCurrent && styles.timeLabelCurrent]}>
                    {timeKey} {isCurrent ? ' • Now' : ''}
                  </Text>
                  <View style={styles.timeLine} />
                </View>

                {/* Items in this time slot */}
                {grouped[timeKey].map(item => {
                  const anime = item.media;
                  const title = getTitle(anime);
                  const cover = getCover(anime);
                  const inList = isInWatchlist(anime.id);
                  const isPast = item.airingAt < now;

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.itemCard, isPast && styles.itemCardPast]}
                      activeOpacity={0.8}
                      onPress={() => navigation.navigate('AnimeDetail', { id: anime.id })}
                    >
                      <Image source={{ uri: cover }} style={styles.itemThumb} />
                      <View style={styles.itemDetails}>
                        <Text style={styles.itemTitle} numberOfLines={1}>
                          {title}
                        </Text>
                        <Text style={styles.itemEpText}>Episode {item.episode}</Text>
                        
                        <TouchableOpacity
                          style={[styles.mylistBtn, inList && styles.mylistBtnActive]}
                          onPress={(e) => {
                            inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime);
                          }}
                        >
                          {inList ? <Check size={11} color="#ffffff" /> : <Plus size={11} color="#ffffff" />}
                          <Text style={styles.mylistBtnText}>{inList ? 'In List' : 'My List'}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#0f0f0f',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  tabBtn: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    width: 48,
  },
  tabBtnActive: {
    backgroundColor: '#e50914',
  },
  tabDayName: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tabDayNameActive: {
    color: '#ffffff',
  },
  tabDayNum: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  tabDayNumActive: {
    color: '#ffffff',
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
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  emptySub: {
    color: '#888888',
    fontSize: 12,
    marginTop: 4,
  },
  timelineScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  timeGroup: {
    marginBottom: 20,
  },
  timeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  timeLabel: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 10,
  },
  timeLabelCurrent: {
    color: '#e50914',
  },
  timeLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1f1f1f',
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    alignItems: 'center',
  },
  itemCardPast: {
    opacity: 0.6,
  },
  itemThumb: {
    width: 60,
    height: 45,
    borderRadius: 4,
    backgroundColor: '#141414',
    marginRight: 12,
    resizeMode: 'cover',
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  itemEpText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 6,
  },
  mylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mylistBtnActive: {
    borderColor: '#e50914',
    backgroundColor: 'rgba(229,9,20,0.15)',
  },
  mylistBtnText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 4,
  },
});
