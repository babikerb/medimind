import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";

import { HapticTab } from "@/components/haptic-tab";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: "#A78BFA",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: {
          position: "relative",
          height: Platform.OS === "ios" ? 88 : 68,

          backgroundColor: "#0f172a",

          borderRadius: 0,
          left: 0,
          right: 0,
          bottom: 0,

          borderTopWidth: 1,
          borderTopColor: "rgba(124, 58, 237, 0.2)",
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.5,
          marginBottom: Platform.OS === "ios" ? 0 : 10,
        },
        tabBarIconStyle: {
          marginTop: 5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "HOME",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="home" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "EXPLORE",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="search" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "PROFILE",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="person" size={26} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
