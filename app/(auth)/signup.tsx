import { Picker } from "@react-native-picker/picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { supabase } from "../../supabase";

const InputBox = ({
  label,
  value,
  onChange,
  id,
  secure = false,
  keyboardType = "default",
  focusedInput,
  setFocusedInput,
  editable = true,
}: any) => (
  <View
    style={[
      styles.inputWrapper,
      focusedInput === id && styles.inputWrapperFocused,
      !editable && { opacity: 0.8 },
    ]}
  >
    <TextInput
      style={styles.input}
      placeholder={label}
      placeholderTextColor="#64748B"
      value={value}
      onChangeText={onChange}
      secureTextEntry={secure}
      keyboardType={keyboardType}
      onFocus={() => setFocusedInput && setFocusedInput(id)}
      onBlur={() => setFocusedInput && setFocusedInput(null)}
      autoCapitalize="none"
      editable={editable}
    />
  </View>
);

const PrimaryButton = ({
  text,
  onPress,
  loading = false,
  disabled = false,
  style = {},
}: any) => (
  <TouchableOpacity
    style={[
      styles.primaryButton,
      (disabled || loading) && styles.buttonDisabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled || loading}
  >
    {loading ? (
      <ActivityIndicator color="#fff" />
    ) : (
      <Text style={styles.primaryButtonText}>{text}</Text>
    )}
  </TouchableOpacity>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.reviewRow}>
    <Text style={styles.reviewLabel}>{label}</Text>
    <Text style={styles.reviewValue}>{value || "Not provided"}</Text>
  </View>
);

export default function MultiStepSignUp() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [insuranceProviders, setInsuranceProviders] = useState<string[]>([]);
  const [isOtherProvider, setIsOtherProvider] = useState(false);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    avatar_url: "",
    zipCode: "",
    insuranceProvider: "",
    customProvider: "",
    insurancePlan: "",
    dob: "",
    gender: "",
    language: "English",
  });

  useEffect(() => {
    async function fetchProviders() {
      const mockProviders = [
        "Aetna",
        "Amerigroup",
        "Anthem Blue Cross",
        "Blue Cross Blue Shield",
        "Cigna",
        "Centene",
        "Humana",
        "Kaiser Permanente",
        "Molina Healthcare",
        "Oscar Health",
        "UnitedHealthcare",
        "Wellcare",
        "Other",
      ];
      setInsuranceProviders(mockProviders);
    }
    fetchProviders();
  }, []);

  const updateForm = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleGetLocation = async () => {
    setLocLoading(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Allow location access to autofill.");
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      let reverseGeocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      if (reverseGeocode.length > 0 && reverseGeocode[0].postalCode) {
        updateForm("zipCode", reverseGeocode[0].postalCode);
      } else {
        Alert.alert("Notice", "Could not find a specific zip code.");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to get location.");
    } finally {
      setLocLoading(false);
    }
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      const manipResult = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 300, height: 300 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
      updateForm("avatar_url", `data:image/jpeg;base64,${manipResult.base64}`);
    }
  };

  const handleConfirmDate = (date: Date) => {
    updateForm("dob", date.toISOString().split("T")[0]);
    setDatePickerVisibility(false);
  };

  const nextStep = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStep(step + 1);
  };

  const prevStep = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStep(step - 1);
  };

  async function handleFinalSubmit() {
    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: { first_name: formData.firstName, last_name: formData.lastName },
      },
    });

    if (authError) {
      Alert.alert("Account Creation Failed", authError.message);
      setLoading(false);
      return;
    }

    const user = authData.user;
    if (user) {
      const finalProvider = isOtherProvider
        ? formData.customProvider
        : formData.insuranceProvider;
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        first_name: formData.firstName,
        last_name: formData.lastName,
        avatar_url: formData.avatar_url,
        zip_code: formData.zipCode,
        insurance_provider: finalProvider,
        insurance_plan: formData.insurancePlan,
        dob: formData.dob,
        gender: formData.gender,
        language: formData.language,
        updated_at: new Date(),
      });

      if (profileError) {
        Alert.alert("Profile Error", profileError.message);
        setLoading(false);
      } else {
        setLoading(false);
        router.replace("/(tabs)");
      }
    }
  }

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 1</Text>
            <Text style={styles.title}>What's your name?</Text>
            <InputBox
              label="First Name"
              value={formData.firstName}
              onChange={(v: string) => updateForm("firstName", v)}
              id="fn"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <InputBox
              label="Last Name"
              value={formData.lastName}
              onChange={(v: string) => updateForm("lastName", v)}
              id="ln"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <PrimaryButton
              text="Next"
              onPress={nextStep}
              disabled={!formData.firstName || !formData.lastName}
            />
          </View>
        );
      case 2:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 2</Text>
            <Text style={styles.title}>Security</Text>
            <InputBox
              label="Email Address"
              value={formData.email}
              onChange={(v: string) => updateForm("email", v)}
              id="email"
              keyboardType="email-address"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <InputBox
              label="Password"
              value={formData.password}
              onChange={(v: string) => updateForm("password", v)}
              id="pass"
              secure
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <PrimaryButton
              text="Continue"
              onPress={nextStep}
              disabled={!formData.email || formData.password.length < 6}
            />
          </View>
        );
      case 3:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 3</Text>
            <Text style={styles.title}>Profile Picture</Text>
            <TouchableOpacity
              onPress={pickImage}
              style={styles.avatarPlaceholder}
            >
              {formData.avatar_url ? (
                <Image
                  source={{ uri: formData.avatar_url }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={{ color: "#94A3B8" }}>Tap to upload</Text>
              )}
            </TouchableOpacity>
            <PrimaryButton text="Continue" onPress={nextStep} />
            <TouchableOpacity
              onPress={nextStep}
              style={{ marginTop: 12, alignSelf: "center" }}
            >
              <Text style={{ color: "#94A3B8" }}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        );
      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 4</Text>
            <Text style={styles.title}>Location</Text>
            <InputBox
              label="ZIP Code"
              value={formData.zipCode}
              onChange={(v: string) => updateForm("zipCode", v)}
              id="zip"
              keyboardType="numeric"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <PrimaryButton
              text={locLoading ? "Locating..." : "Use Current Location"}
              onPress={handleGetLocation}
              style={{ backgroundColor: "#334155", marginBottom: 12 }}
              loading={locLoading}
            />
            <PrimaryButton
              text="Continue"
              onPress={nextStep}
              disabled={!formData.zipCode}
            />
          </View>
        );
      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 5</Text>
            <Text style={styles.title}>Insurance</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={formData.insuranceProvider}
                onValueChange={(v) => {
                  updateForm("insuranceProvider", v);
                  setIsOtherProvider(v === "Other");
                }}
                style={{ color: "#FFF" }}
                dropdownIconColor="#7C3AED"
              >
                <Picker.Item label="Select Provider" value="" color="#94A3B8" />
                {insuranceProviders.map((p) => (
                  <Picker.Item
                    key={p}
                    label={p}
                    value={p}
                    color={Platform.OS === "ios" ? "#FFF" : "#000"}
                  />
                ))}
              </Picker>
            </View>
            {isOtherProvider && (
              <InputBox
                label="Type Provider Name"
                value={formData.customProvider}
                onChange={(v: string) => updateForm("customProvider", v)}
                id="cp"
                focusedInput={focusedInput}
                setFocusedInput={setFocusedInput}
              />
            )}
            <InputBox
              label="Insurance Plan (e.g. PPO, HMO)"
              value={formData.insurancePlan}
              onChange={(v: string) => updateForm("insurancePlan", v)}
              id="plan"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <PrimaryButton
              text="Continue"
              onPress={nextStep}
              disabled={!formData.insuranceProvider || !formData.insurancePlan}
            />
          </View>
        );
      case 6:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 6</Text>
            <Text style={styles.title}>Basic Info</Text>
            <TouchableOpacity onPress={() => setDatePickerVisibility(true)}>
              <View pointerEvents="none">
                <InputBox
                  label="Birthday"
                  value={formData.dob || "Select Date"}
                  id="dob"
                  editable={false}
                />
              </View>
            </TouchableOpacity>
            <DateTimePickerModal
              isVisible={isDatePickerVisible}
              mode="date"
              onConfirm={handleConfirmDate}
              onCancel={() => setDatePickerVisibility(false)}
              isDarkModeEnabled={true}
              textColor="white"
            />

            <Text style={[styles.brandName, { marginTop: 10 }]}>GENDER</Text>
            <View style={styles.genderButtonGroup}>
              {["Male", "Female", "Non-binary", "Prefer not to say"].map(
                (g) => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.genderButton,
                      formData.gender === g && styles.genderButtonActive,
                    ]}
                    onPress={() => updateForm("gender", g)}
                  >
                    <Text
                      style={[
                        styles.genderButtonText,
                        formData.gender === g && styles.genderButtonTextActive,
                      ]}
                    >
                      {g}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>

            <PrimaryButton
              text="Continue"
              onPress={nextStep}
              disabled={!formData.dob || !formData.gender}
            />
          </View>
        );
      case 7:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>STEP 7</Text>
            <Text style={styles.title}>Language</Text>
            <InputBox
              label="Preferred Language"
              value={formData.language}
              onChange={(v: string) => updateForm("language", v)}
              id="lang"
              focusedInput={focusedInput}
              setFocusedInput={setFocusedInput}
            />
            <PrimaryButton text="Review Details" onPress={nextStep} />
          </View>
        );
      case 8:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.brandName}>FINAL STEP</Text>
            <Text style={styles.title}>Review Profile</Text>
            <View style={styles.reviewContainer}>
              <ReviewRow
                label="Name"
                value={`${formData.firstName} ${formData.lastName}`}
              />
              <ReviewRow label="Email" value={formData.email} />
              <ReviewRow label="Zip Code" value={formData.zipCode} />
              <ReviewRow
                label="Insurance"
                value={`${isOtherProvider ? formData.customProvider : formData.insuranceProvider} (${formData.insurancePlan})`}
              />
              <ReviewRow label="Birthday" value={formData.dob} />
              <ReviewRow label="Gender" value={formData.gender} />
              <ReviewRow label="Language" value={formData.language} />
            </View>
            <PrimaryButton
              text="Confirm & Create Account"
              onPress={handleFinalSubmit}
              loading={loading}
            />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.topNav}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={step === 1 ? () => router.back() : prevStep}
          >
            <Text style={styles.backButtonText}>
              {step === 1 ? "CANCEL" : "BACK"}
            </Text>
          </TouchableOpacity>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${(step / 8) * 100}%` }]}
            />
          </View>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.flex}
        >
          <ScrollView contentContainerStyle={styles.inner}>
            {renderStep()}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  flex: { flex: 1 },
  topNav: {
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "android" ? 40 : 10,
    flexDirection: "row",
    alignItems: "center",
    height: 60,
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
    paddingBottom: 40,
  },
  stepContainer: { width: "100%" },
  brandName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
    opacity: 0.6,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 24,
  },
  inputWrapper: {
    backgroundColor: "#1E293B",
    height: 64,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  inputWrapperFocused: { borderColor: "#7C3AED" },
  input: { color: "#FFFFFF", fontSize: 16, fontWeight: "500" },
  pickerWrapper: {
    backgroundColor: "#1E293B",
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  primaryButton: {
    backgroundColor: "#7C3AED",
    height: 58,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  backButton: {
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 100,
    marginRight: 16,
  },
  backButtonText: { color: "#94A3B8", fontSize: 10, fontWeight: "700" },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: "#1E293B",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#7C3AED" },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#1E293B",
    alignSelf: "center",
    marginBottom: 30,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  genderButtonGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  genderButton: {
    width: "48%",
    backgroundColor: "#1E293B",
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  genderButtonActive: { borderColor: "#7C3AED", backgroundColor: "#2D2159" },
  genderButtonText: { color: "#94A3B8", fontWeight: "600" },
  genderButtonTextActive: { color: "#FFF" },
  reviewContainer: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  reviewRow: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    paddingBottom: 8,
  },
  reviewLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  reviewValue: { color: "#FFF", fontSize: 16, fontWeight: "500" },
});
