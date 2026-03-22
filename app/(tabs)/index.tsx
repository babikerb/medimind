import { MaterialIcons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native"; // Ensure this is installed
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";

const { width, height } = Dimensions.get("window");

const APP_BG_COLOR = "#0f172a";

export default function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const isFocused = useIsFocused(); // Tracks if this screen is currently active

  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );
  const [symptoms, setSymptoms] = useState("");

  const updateLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    let loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    setLocation(loc);
    centerMap(loc.coords.latitude, loc.coords.longitude);
  };

  useEffect(() => {
    updateLocation();
  }, []);

  const centerMap = (lat: number, lon: number) => {
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      1000,
    );
  };

  // ZOOM LOGIC
  const handleZoom = (type: "in" | "out") => {
    mapRef.current?.getCamera().then((cam) => {
      if (cam.zoom !== undefined) {
        cam.zoom += type === "in" ? 1 : -1;
        mapRef.current?.animateCamera(cam);
      } else {
        // Fallback for providers that don't support camera zoom directly
        mapRef.current?.animateToRegion({
          latitude: cam.center.latitude,
          longitude: cam.center.longitude,
          latitudeDelta: type === "in" ? 0.005 : 0.05,
          longitudeDelta: type === "in" ? 0.005 : 0.05,
        });
      }
    });
  };

  return (
    <View style={styles.container}>
      {/* The 'isFocused' check forces the StatusBar to re-apply 
         "dark" (black text) every time you navigate back to this screen.
      */}
      {isFocused && (
        <StatusBar
          style="dark"
          backgroundColor="transparent"
          translucent={true}
        />
      )}

      {location ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          showsUserLocation={true}
          showsMyLocationButton={false}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        />
      ) : (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      )}

      {/* Control Group - Location and Zoom */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() =>
            location &&
            centerMap(location.coords.latitude, location.coords.longitude)
          }
          activeOpacity={0.7}
        >
          <MaterialIcons name="my-location" size={26} color="#7C3AED" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, { marginTop: 12 }]}
          onPress={() => handleZoom("in")}
          activeOpacity={0.7}
        >
          <MaterialIcons name="add" size={26} color="#7C3AED" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, { marginTop: 12 }]}
          onPress={() => handleZoom("out")}
          activeOpacity={0.7}
        >
          <MaterialIcons name="remove" size={26} color="#7C3AED" />
        </TouchableOpacity>
      </View>

      {/* Symptoms Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <MaterialIcons name="healing" size={22} color="#7C3AED" />
          <TextInput
            placeholder="Enter symptoms..."
            style={styles.searchInput}
            value={symptoms}
            onChangeText={setSymptoms}
            placeholderTextColor="#94A3B8"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_BG_COLOR,
  },
  map: { width, height },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: APP_BG_COLOR,
  },
  controlsContainer: {
    position: "absolute",
    right: 16,
    top: height * 0.15, // Starts below the search bar
  },
  controlButton: {
    backgroundColor: "#FFFFFF",
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  searchContainer: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 50,
    width: "100%",
    paddingHorizontal: 20,
  },
  searchBar: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    padding: 14,
    borderRadius: 15,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: "#1E293B",
  },
});
