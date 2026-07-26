import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#007AFF',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="wallet" size={24} color={color} />
          ),
          headerTitle: 'Silent Payments Wallet',
        }}
      />
      <Tabs.Screen
        name="receive"
        options={{
          title: 'Receive',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="qrcode" size={24} color={color} />
          ),
          headerTitle: 'Receive Payment',
        }}
      />
      <Tabs.Screen
        name="send"
        options={{
          title: 'Send',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="send" size={24} color={color} />
          ),
          headerTitle: 'Send Payment',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="cog" size={24} color={color} />
          ),
          headerTitle: 'Settings',
        }}
      />
    </Tabs>
  );
}