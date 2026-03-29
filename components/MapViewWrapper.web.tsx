import { View, Text, StyleSheet } from "react-native";

export const PROVIDER_GOOGLE = undefined;

export function MapView({ style, children, ...props }: any) {
  return (
    <View style={[style, styles.container]}>
      <Text style={styles.text}>Map not available on web</Text>
    </View>
  );
}

export function Marker(_props: any) {
  return null;
}

export function Polyline(_props: any) {
  return null;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "#64748B",
    fontSize: 14,
  },
});
