import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Home as HomeIcon, Compass, Calendar, List, User } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// State Provider
import { AppProvider } from './src/context/AppContext';

// Screens
import Home from './src/pages/Home';
import Browse from './src/pages/Browse';
import Schedule from './src/pages/Schedule';
import MyList from './src/pages/MyList';
import Profile from './src/pages/Profile';
import AnimePage from './src/pages/AnimePage';
import WatchPage from './src/pages/WatchPage';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Bottom Tab Navigation
function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let IconComponent;
          if (route.name === 'HomeTab') IconComponent = HomeIcon;
          else if (route.name === 'Browse') IconComponent = Compass;
          else if (route.name === 'Schedule') IconComponent = Calendar;
          else if (route.name === 'MyList') IconComponent = List;
          else if (route.name === 'Profile') IconComponent = User;

          return <IconComponent color={color} size={size} />;
        },
        tabBarActiveTintColor: '#e50914',
        tabBarInactiveTintColor: '#888888',
        tabBarStyle: {
          backgroundColor: '#0f0f0f',
          borderTopColor: '#1a1a1a',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        headerStyle: {
          backgroundColor: '#0f0f0f',
        },
        headerShadowVisible: false,
        headerTintColor: '#ffffff',
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
        headerTitleAlign: 'center',
      })}
    >
      <Tab.Screen 
        name="HomeTab" 
        component={Home} 
        options={{ title: 'Home', headerTitle: 'AniLab' }} 
      />
      <Tab.Screen 
        name="Browse" 
        component={Browse} 
        options={{ title: 'Browse', headerTitle: 'Browse Anime' }} 
      />
      <Tab.Screen 
        name="Schedule" 
        component={Schedule} 
        options={{ title: 'Schedule', headerTitle: 'Release Schedule' }} 
      />
      <Tab.Screen 
        name="MyList" 
        component={MyList} 
        options={{ title: 'My List', headerTitle: 'My Watchlist' }} 
      />
      <Tab.Screen 
        name="Profile" 
        component={Profile} 
        options={{ title: 'Profile', headerTitle: 'User Profile' }} 
      />
    </Tab.Navigator>
  );
}

// Root Stack Navigation
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AppProvider>
      <NavigationContainer theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: '#e50914',
          background: '#0a0a0a',
          card: '#0f0f0f',
          text: '#ffffff',
          border: '#1a1a1a',
          notification: '#e50914',
        }
      }}>
        <StatusBar style="light" backgroundColor="#0f0f0f" translucent={false} />
        <Stack.Navigator
          screenOptions={{
            headerStyle: {
              backgroundColor: '#0f0f0f',
            },
            headerShadowVisible: false,
            headerTintColor: '#ffffff',
            headerTitleStyle: {
              fontWeight: '700',
            },
            headerTitleAlign: 'center',
            contentStyle: { backgroundColor: '#0a0a0a' },
          }}
        >
          <Stack.Screen 
            name="Main" 
            component={TabNavigator} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="AnimeDetail" 
            component={AnimePage} 
            options={{ title: 'Loading...', headerBackTitleVisible: false }} 
          />
          <Stack.Screen 
            name="Watch" 
            component={WatchPage} 
            options={{ headerShown: false }} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
    </GestureHandlerRootView>
  );
}
