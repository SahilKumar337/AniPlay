import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { User, Settings, Info, Shield, LogOut, ChevronRight, Heart, Bookmark, Clock, Database } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { clearAllCaches } from '../utils/cache';

const { width } = Dimensions.get('window');

export default function Profile({ navigation }) {
  const { watchlist, favorites, progress, showToast } = useApp();

  const watchlistCount = Object.keys(watchlist).length;
  const favCount = favorites.size;
  const progressCount = Object.keys(progress).length;

  const handleClearCache = async () => {
    const count = await clearAllCaches();
    showToast(`Cleared cache (${count} entries)`);
  };

  const MENU_ITEMS = [
    { icon: Settings,  label: 'Settings',     action: () => {} },
    { icon: Database,  label: 'Clear Cache',  action: handleClearCache },
    { icon: Info,      label: 'About AniLab', action: () => {} },
    { icon: Shield,    label: 'Privacy Policy', action: () => {} },
    { icon: LogOut,    label: 'Sign Out',     action: () => {}, color: '#e50914' },
  ];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.wrapper}>
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarWrapper}>
            <User size={36} color="#ffffff" />
          </View>
          <Text style={styles.usernameText}>Anime Fan</Text>
          <Text style={styles.memberText}>AniLab Member</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          {[
            { icon: Bookmark, label: 'My List',   value: watchlistCount, action: () => navigation.navigate('MyList') },
            { icon: Heart,    label: 'Favorites',  value: favCount,       action: () => navigation.navigate('MyList') },
            { icon: Clock,    label: 'Watched',    value: progressCount,  action: () => navigation.navigate('MyList') },
          ].map(stat => (
            <TouchableOpacity
              key={stat.label}
              style={styles.statBox}
              activeOpacity={0.8}
              onPress={stat.action}
            >
              <stat.icon size={20} color="#e50914" />
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Menu Rows */}
        <View style={styles.menuContainer}>
          {MENU_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              style={[
                styles.menuItem,
                index === MENU_ITEMS.length - 1 && { borderBottomWidth: 0 }
              ]}
              activeOpacity={0.7}
              onPress={item.action}
            >
              <item.icon size={20} color={item.color || '#aaaaaa'} />
              <Text style={[styles.menuItemText, item.color ? { color: item.color } : null]}>
                {item.label}
              </Text>
              <ChevronRight size={16} color="#444444" />
            </TouchableOpacity>
          ))}
        </View>

        {/* App Version footer */}
        <Text style={styles.footerText}>
          AniLab Mobile v1.0.0 {'\n'} Made with ❤️ for anime fans
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  wrapper: {
    padding: 20,
    alignItems: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 12,
  },
  avatarWrapper: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#e50914',
    borderWidth: 3,
    borderColor: 'rgba(229, 9, 20, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#e50914',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  usernameText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
  },
  memberText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 32,
  },
  statBox: {
    width: (width - 64) / 3,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  statLabel: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  menuContainer: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    width: '100%',
    overflow: 'hidden',
    marginBottom: 32,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  menuItemText: {
    color: '#eaeaea',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginLeft: 12,
  },
  footerText: {
    color: '#444444',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 12,
  },
});
