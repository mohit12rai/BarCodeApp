import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import Swiper from 'react-native-swiper';
import { ProgressBar } from 'react-native-paper';
import { View, StyleSheet, Platform, FlatList, ActivityIndicator, Animated, BackHandler, TouchableOpacity, ScrollView, Image, Alert, Text as RNText } from 'react-native';
import { Button, Card, Text, TextInput, useTheme } from 'react-native-paper';
import { BarCodeScanner } from 'expo-barcode-scanner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Toast from 'react-native-toast-message';
import ThemeToggle from '../components/ThemeToggle';
import { ThemeContext } from '../ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';


// const BASE_URL = 'http://localhost:5000';
const BASE_URL = 'https://patidarbarcodedev.onrender.com';
// const BASE_URL = 'http://35.175.71.43:5001';

export default function UserDashboard({ navigation }) {
  // State Declarations
  const { colors } = useTheme();
  const { isDarkMode } = useContext(ThemeContext);
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [barcodeData, setBarcodeData] = useState(null);
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [barcodes, setBarcodes] = useState([]);
  const [searchBarcode, setSearchBarcode] = useState('');
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [currentTab, setCurrentTab] = useState('home');
  const [scanRegion, setScanRegion] = useState(null);
  const scanLineAnim = React.useRef(new Animated.Value(0)).current;
  const [rewards, setRewards] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [showRewardHistory, setShowRewardHistory] = useState(true);
  const [forceRender, setForceRender] = useState(0); // Force re-render counter

  const toggleRewardHistory = useCallback(() => {
    setShowRewardHistory((prev) => {
      const newState = !prev;
      setForceRender((count) => count + 1); // Trigger re-render
      return newState;
    });
  }, [showRewardHistory]);

 
  // Navigation Options
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => null,
      gestureEnabled: false,
    });
  }, [navigation]);

  // Helper Functions
  useEffect(() => {
    const refreshToken = async () => {
      try {
        const credentials = await AsyncStorage.getItem('credentials');
        if (!credentials) return;
        const { mobile, password } = JSON.parse(credentials);
        const response = await axios.post(`${BASE_URL}/login`, { mobile, password });
        await AsyncStorage.setItem('token', response.data.token);
        const updatedUser = {
          id: response.data.user.id,
          name: response.data.user.name,
          mobile: response.data.user.mobile,
          points: response.data.user.points || 0,
          location: response.data.user.location || 'Unknown',
          adminId: response.data.user.adminId,
          status: response.data.user.status,
          rewardProgress: response.data.user.rewardProgress || [],
        };
        setUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
        Toast.show({ type: 'success', text1: 'Session Refreshed' });
      } catch (error) {
        await AsyncStorage.clear();
        navigation.replace('Home');
        Toast.show({
          type: 'error',
          text1: 'Session Refresh Failed',
          text2: error.response?.data?.message || 'Please log in again.',
        });
      }
    };
    const interval = setInterval(refreshToken, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [navigation]);

  useEffect(() => {
    const initialize = async () => {
      try {
        const storedUser = await AsyncStorage.getItem('user');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          if (!parsedUser.id) throw new Error('Invalid user ID');
          setUser(parsedUser);
          await fetchUserProfile(parsedUser.id);
          await fetchUserBarcodes(parsedUser.id);
          await fetchRewards();
          await fetchNotifications();
          await fetchRedemptions();
        } else {
          throw new Error('No user data found');
        }
      } catch (err) {
        await AsyncStorage.clear();
        navigation.replace('Home');
        Toast.show({
          type: 'error',
          text1: 'Initialization Failed',
          text2: err.message || 'Could not load user data.',
        });
      }
    };
    initialize();
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') {
        const onBackPress = () => {
          navigation.navigate('UserDashboard');
          return true;
        };
        BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      }
    }, [navigation])
  );

  useEffect(() => {
    if (showScanner) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [showScanner]);

  const scanLineTranslate = useMemo(
    () => scanLineAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 180],
    }),
    [scanLineAnim]
  );

  const handleUnauthorized = useCallback(
    async (error) => {
      if (error.response?.status === 401 || error.response?.status === 403) {
        await AsyncStorage.clear();
        navigation.replace('Home');
        Toast.show({
          type: 'error',
          text1: error.response?.status === 403 ? 'Account Not Approved' : 'Session Expired',
          text2: error.response?.data?.message || (error.response?.status === 403 ? 'Your account is pending admin approval.' : 'Please log in again.'),
        });
        return true;
      }
      return false;
    },
    [navigation]
  );

  const fetchUserProfile = useCallback(
    async (userId) => {
      if (!userId) return;
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await axios.get(`${BASE_URL}/users/${userId}`, {
          headers: { Authorization: token },
        });
        if (response.data.status !== 'approved') {
          await AsyncStorage.clear();
          navigation.replace('Home');
          Toast.show({
            type: 'error',
            text1: 'Account Not Approved',
            text2: response.data.status === 'pending' ? 'Your account is pending admin approval.' : 'Your account has been disapproved.',
          });
          return;
        }
        const updatedUser = {
          id: response.data._id,
          name: response.data.name,
          mobile: response.data.mobile,
          points: response.data.points || 0,
          location: response.data.location || 'Unknown',
          adminId: response.data.adminId,
          status: response.data.status,
          rewardProgress: response.data.rewardProgress || [],
        };
        setUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
        if (response.data.adminId) {
          try {
            const adminResponse = await axios.get(`${BASE_URL}/users/${response.data.adminId}`, {
              headers: { Authorization: token },
            });
            setAdmin(adminResponse.data);
          } catch (adminError) {
            console.warn('Failed to fetch admin details:', adminError.message);
          }
        }
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        Toast.show({
          type: 'error',
          text1: 'Profile Fetch Failed',
          text2: error.response?.data?.message || 'Could not load profile.',
        });
      } finally {
        setLoading(false);
      }
    },
    [handleUnauthorized, navigation]
  );

  const fetchUserBarcodes = useCallback(
    async (userId) => {
      if (!userId) return;
      setLoading(true);
      setFetchError('');
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await axios.get(`${BASE_URL}/barcodes/user/${userId}`, {
          headers: { Authorization: token },
        });
        const barcodeData = Array.isArray(response.data) ? response.data : response.data.barcodes || [];
        setBarcodes(barcodeData);
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        const errorMessage = error.response?.data?.message || 'Failed to fetch barcodes';
        setFetchError(errorMessage);
        setBarcodes([]);
        Toast.show({
          type: 'error',
          text1: 'Barcode Fetch Failed',
          text2: errorMessage,
        });
      } finally {
        setLoading(false);
      }
    },
    [handleUnauthorized]
  );

  const fetchRewards = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${BASE_URL}/rewards`, { headers: { Authorization: token } });
      setRewards(response.data);
    } catch (error) {
      console.error('Error fetching rewards:', error);
      Toast.show({
        type: 'error',
        text1: 'Rewards Fetch Failed',
        text2: error.response?.data?.message || 'Could not load rewards.',
      });
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${BASE_URL}/notifications`, { headers: { Authorization: token } });
      setNotifications(response.data);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      Toast.show({
        type: 'error',
        text1: 'Notifications Fetch Failed',
        text2: error.response?.data?.message || 'Could not load notifications.',
      });
    }
  }, []);

  const fetchRedemptions = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${BASE_URL}/redemptions`, { headers: { Authorization: token } });
      setRedemptions(response.data);
    } catch (error) {
      console.error('Error fetching redemptions:', error);
      Toast.show({
        type: 'error',
        text1: 'Redemptions Fetch Failed',
        text2: error.response?.data?.message || 'Could not load reward history.',
      });
    }
  }, []);

  const clearNotification = useCallback(async (notificationId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.delete(`${BASE_URL}/notifications/${notificationId}`, { headers: { Authorization: token } });
      setNotifications(notifications.filter(n => n._id !== notificationId));
      Toast.show({ type: 'success', text1: 'Notification Cleared' });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Clear Failed',
        text2: error.response?.data?.message || 'Could not clear notification.',
      });
    }
  }, [notifications]);

  const clearRedemption = useCallback(async (redemptionId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.delete(`${BASE_URL}/redemptions/${redemptionId}`, { 
        headers: { Authorization: token } 
      });
      setRedemptions(redemptions.filter(r => r._id !== redemptionId));
      Toast.show({ type: 'success', text1: 'History Item Cleared' });
    } catch (error) {
      console.error('Error clearing redemption:', error);
      Toast.show({
        type: 'error',
        text1: 'Clear Failed',
        text2: error.response?.data?.message || 'Could not clear history item.',
      });
    }
  }, [redemptions]);

  const memoizedBarcodes = useMemo(() => barcodes, [barcodes]);

  const filteredBarcodes = useMemo(() => {
    if (!Array.isArray(barcodes) || barcodes.length === 0) return [];
    if (!searchBarcode?.trim()) return barcodes;
    const searchLower = searchBarcode.toLowerCase().trim();
    return barcodes.filter((barcode) => barcode?.value?.toLowerCase().includes(searchLower));
  }, [barcodes, searchBarcode]);

  const handleBarCodeScanned = useCallback(
    async ({ data }) => {
      setScanned(true);
      setShowScanner(false);
      setLoading(true);
      setBarcodeData(data);
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await axios.post(
          `${BASE_URL}/barcodes`,
          { value: data.toUpperCase(), location: user?.location || 'Unknown' },
          { headers: { Authorization: token } }
        );
        await fetchUserProfile(user?.id);
        await fetchRewards();
        await fetchNotifications();
        setError('');
        Toast.show({
          type: 'success',
          text1: 'Scan Successful',
          text2: `You earned ${response.data.pointsAwarded} points!`,
        });
        await fetchUserBarcodes(user?.id);
        setTimeout(() => setScanned(false), 1000);
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        const errorMessage =
          error.response?.data?.message === 'Barcode already scanned'
            ? 'Barcode already scanned'
            : error.response?.data?.message || 'Scan failed';
        setError(errorMessage);
        Toast.show({
          type: 'error',
          text1: 'Scan Failed',
          text2: errorMessage,
        });
      } finally {
        setLoading(false);
      }
    },
    [fetchUserProfile, fetchUserBarcodes, handleUnauthorized, user, fetchRewards, fetchNotifications]
  );

  const handleScanAction = useCallback(async () => {
    try {
      if (hasPermission === null || hasPermission === false) {
        const { status } = await BarCodeScanner.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        if (status === 'granted') {
          await AsyncStorage.setItem('cameraPermission', 'granted');
        } else {
          Toast.show({
            type: 'error',
            text1: 'Permission Denied',
            text2: 'Camera access is required to scan barcodes.',
          });
          return;
        }
      }
      if (scanned) {
        setScanned(false);
        setBarcodeData(null);
        setError('');
      }
      setShowScanner(true);
      setScanRegion(null);
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Permission Error',
        text2: 'Could not request camera permission.',
      });
    }
  }, [hasPermission, scanned]);

  const handleScanTabPress = useCallback(async () => {
    setCurrentTab('scan');
    if (hasPermission === null) {
      try {
        const { status } = await BarCodeScanner.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        if (status === 'granted') {
          await AsyncStorage.setItem('cameraPermission', 'granted');
        } else {
          Toast.show({
            type: 'error',
            text1: 'Permission Denied',
            text2: 'Camera access is required to scan barcodes.',
          });
        }
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Permission Error',
          text2: 'Could not request camera permission.',
        });
      }
    }
  }, [hasPermission]);

  const handleCancelScan = useCallback(() => {
    setShowScanner(false);
    setScanned(false);
    setBarcodeData(null);
    setError('');
    setScanRegion(null);
  }, []);

  const handleSelectScanArea = useCallback(() => {
    setScanRegion({
      top: 100,
      left: 50,
      width: 200,
      height: 200,
    });
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await AsyncStorage.clear();
      navigation.replace('Home');
      Toast.show({
        type: 'success',
        text1: 'Logged Out',
        text2: 'You have been logged out successfully.',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Logout Failed',
        text2: 'Could not log out.',
      });
    }
  }, [navigation]);

  // Render Functions
  const renderContent = useCallback(() => {
    switch (currentTab) {
      case 'home':
        return (
          <>
            {user && (
              <>
                <Card style={[styles.profileCard, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                  <Card.Content>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFD700' : colors.text, fontWeight: 'bold' }]}>
                      Welcome, {user.name || 'Unknown'}
                    </Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                      Mobile: {user.mobile || 'Unknown'}
                    </Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                      Location: {user.location || 'Unknown'}
                    </Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text, fontSize: 20, fontWeight: 'bold' }]}>
                      Points: {user.points ?? 0}
                    </Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text, fontSize: 20, fontWeight: 'bold' }]}>
                      Total Scanned: {barcodes.length}
                    </Text>
                  </Card.Content>
                </Card>
                <View style={styles.sliderContainer}>
                  <Text style={[styles.subtitle, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Rewards</Text>
                  {rewards.length > 0 && (
                    <Swiper
                      autoplay
                      autoplayTimeout={0.7} // Half second slide
                      height={350}
                      showsPagination
                      loop
                    >
                      {rewards.map((reward, index) => (
                        <View key={index} style={styles.slide}>
                          {reward.image ? (
                            <Image
                              source={{ uri: reward.image }}
                              style={{ width: '100%', height: 330, resizeMode: 'contain' }}
                            />
                          ) : (
                            <Text>{reward.name}</Text>
                          )}
                        </View>
                      ))}
                    </Swiper>
                  )}

                </View>
                
                {admin && (
                  <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                    <Card.Content>
                      <Text style={[styles.cardText, { color: isDarkMode ? '#FFD700' : colors.text, fontWeight: 'bold' }]}>
                        Assigned Admin: {admin.name || 'Unknown'}
                      </Text>
                      <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                        Admin Unique Code: {admin.uniqueCode || 'N/A'}
                      </Text>
                    </Card.Content>
                  </Card>
                )}
              </>
            )}
          </>
        );
      case 'scan':
        return Platform.OS === 'web' ? (
          <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
            <Card.Content>
              <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                Barcode scanning is not supported on web browsers. Use the mobile app instead.
              </Text>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Button
              mode="contained"
              onPress={handleScanAction}
              style={styles.button}
              buttonColor={colors.primary}
              textColor={isDarkMode ? '#FFFFFF' : '#212121'}
              disabled={showScanner || loading}
              labelStyle={styles.buttonLabel}
            >
              {scanned ? 'Scan Again' : 'Scan Barcode'}
            </Button>
            {showScanner && (
              <View style={styles.scannerContainer}>
                <BarCodeScanner
                  onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
                  style={styles.camera}
                  barCodeTypes={[
                    BarCodeScanner.Constants.BarCodeType.qr,
                    BarCodeScanner.Constants.BarCodeType.ean13,
                    BarCodeScanner.Constants.BarCodeType.code128,
                  ]}
                  scanInterval={100}
                  region={scanRegion}
                />
                <TouchableOpacity
                  style={styles.scanAreaOverlay}
                  onPress={handleSelectScanArea}
                  activeOpacity={0.7}
                >
                  <View style={styles.scanAreaBox} />
                </TouchableOpacity>
                <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslate }] }]}>
                  <View style={styles.scanLineInner} />
                </Animated.View>
                <Button
                  mode="contained"
                  onPress={handleCancelScan}
                  style={styles.cancelButton}
                  buttonColor={colors.error}
                  textColor="#FFFFFF"
                  labelStyle={styles.buttonLabel}
                >
                  Cancel
                </Button>
              </View>
            )}
            {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.loading} />}
            {scanned && (
              <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                <Card.Content>
                  <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                    Scanned Barcode: {barcodeData || 'N/A'}
                  </Text>
                  {error ? (
                    <Text style={[styles.error, { color: isDarkMode ? '#FF5555' : colors.error }]}>
                      {error}
                    </Text>
                  ) : (
                    <Text style={[styles.success, { color: isDarkMode ? '#00FF00' : colors.accent }]}>
                      Success!
                    </Text>
                  )}
                </Card.Content>
              </Card>
            )}
          </>
        );
      case 'search':
        return (
          <>
            {fetchError && (
              <Text style={[styles.error, { color: isDarkMode ? '#FF5555' : colors.error }]}>
                {fetchError}
              </Text>
            )}
            <TextInput
              placeholder="Search Barcodes..."
              value={searchBarcode}
              onChangeText={setSearchBarcode}
              style={[styles.searchBar, { backgroundColor: isDarkMode ? '#444' : '#fff', color: isDarkMode ? '#FFFFFF' : colors.text }]}
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              autoCapitalize="none"
              mode="outlined"
              outlineColor={isDarkMode ? '#555' : '#ccc'}
              activeOutlineColor={colors.primary}
            />
            <FlatList
              data={filteredBarcodes}
              keyExtractor={(item) => item._id || `barcode-${item.value}`}
              renderItem={({ item }) => (
                <Card key={item._id} style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                  <Card.Content>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Value: {item.value || 'N/A'}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Points: {item.points ?? 0}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Timestamp: {item.scannedAt ? new Date(item.scannedAt).toLocaleString() : 'N/A'}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Location: {item.location || 'Unknown'}</Text>
                  </Card.Content>
                </Card>
              )}
              ListEmptyComponent={() => (
                !loading && (
                  <Text style={[styles.emptyText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>No barcodes found.</Text>
                )
              )}
              contentContainerStyle={{ paddingBottom: 80 }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
            />
          </>
        );
      case 'barcode':
        return (
          <>
            {fetchError && (
              <Text style={[styles.error, { color: isDarkMode ? '#FF5555' : colors.error }]}>
                {fetchError}
              </Text>
            )}
            <Text style={[styles.subtitle, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
              Your Barcodes
            </Text>
            <FlatList
              data={memoizedBarcodes}
              keyExtractor={(item) => item._id || `barcode-${item.value}`}
              renderItem={({ item }) => (
                <Card key={item._id} style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                  <Card.Content>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Value: {item.value || 'N/A'}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>User: {item.userId?.name || 'Unknown'} ({item.userId?.mobile || 'N/A'})</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Points Awarded: {item.points ?? 0}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Timestamp: {item.scannedAt ? new Date(item.scannedAt).toLocaleString() : 'N/A'}</Text>
                    <Text style={[styles.cardText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Location: {item.location || 'N/A'}</Text>
                  </Card.Content>
                </Card>
              )}
              ListEmptyComponent={() => (
                !loading && (
                  <Text style={[styles.emptyText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>No barcodes scanned yet.</Text>
                )
              )}
              contentContainerStyle={{ paddingBottom: 80 }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
            />
          </>
        );
      case 'rewards':
        return (
          <View style={styles.rewardsContainer}>
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Available Rewards</Text>
            <FlatList
              data={rewards}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => {
                const progress = user?.rewardProgress?.find(
                  (prog) => prog?.rewardId?.toString() === item._id
                );
                const pointsEarned = progress?.pointsEarned ?? user?.points ?? 0;
                const pointsRequired = item.pointsRequired || 100;
                const percentage = Math.min((pointsEarned / pointsRequired) * 100, 100);
                const remainingPoints = Math.max(pointsRequired - pointsEarned, 0);
                const remainingPercentage = (100 - percentage).toFixed(2);
                const isAchieved = pointsEarned >= pointsRequired;

                return (
                  <Card style={[styles.rewardItem, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                    <Card.Content>
                      {item.image && (
                        <Image source={{ uri: item.image }} style={styles.rewardImage} resizeMode="contain" />
                      )}
                      <Text style={[styles.rewardName, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.rewardDetails, { color: isDarkMode ? '#999' : '#666' }]}>
                        Price: ₹{item.price} | Points Required: {pointsRequired}
                      </Text>
                      <View style={styles.progressContainer}>
                        <View style={styles.progressBar}>
                          <View
                            style={[
                              styles.progressFill,
                              {
                                width: `${percentage}%`,
                                backgroundColor: isAchieved ? '#2196F3' : '#4CAF50',
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.progressText, { color: isDarkMode ? '#999' : '#666' }]}>
                          {pointsEarned}/{pointsRequired} points ({percentage.toFixed(2)}% achieved)
                        </Text>
                        <Text style={[styles.progressText, { color: isDarkMode ? '#999' : '#666' }]}>
                          {remainingPoints} points remaining ({remainingPercentage}% to go)
                        </Text>
                        {isAchieved ? (
                          <Text style={styles.rewardAchieved}>🎉 Reward Achieved</Text>
                        ) : (
                          <Text style={styles.remainingPoints}>
                            Need {remainingPoints} more points to unlock
                          </Text>
                        )}
                      </View>
                      {isAchieved && !redemptions.some(
                        (r) => r.rewardId?._id === item._id && ['pending', 'approved'].includes(r.status)
                      ) && (
                        <Button
                          mode="contained"
                          onPress={async () => {
                            console.log('Redeem button clicked:', { rewardId: item._id, userId: user.id });
                            const confirmRedeem = Platform.OS === 'web'
                              ? window.confirm(`Do you want to redeem "${item.name}"?`)
                              : await new Promise((resolve) => {
                                  Alert.alert(
                                    'Confirm Redemption',
                                    `Do you want to redeem "${item.name}"?`,
                                    [
                                      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                                      { text: 'Redeem', onPress: () => resolve(true) },
                                    ]
                                  );
                                });
                            if (!confirmRedeem) return;
                            try {
                              const token = await AsyncStorage.getItem('token');
                              console.log('Sending redemption request:', { rewardId: item._id, token: token ? 'Present' : 'Missing' });
                              const response = await axios.post(`${BASE_URL}/redemptions`, { rewardId: item._id }, {
                                headers: { Authorization: token },
                              });
                              console.log('Redemption response:', response.data);
                              Toast.show({ type: 'success', text1: 'Redemption Request Submitted' });
                              await fetchRedemptions();
                              await fetchNotifications();
                              await fetchUserProfile(user.id);
                            } catch (error) {
                              console.error('Redemption error:', {
                                message: error.message,
                                response: error.response?.data,
                                status: error.response?.status,
                              });
                              Toast.show({
                                type: 'error',
                                text1: 'Redemption Failed',
                                text2: error.response?.data?.message || 'Could not submit request.',
                              });
                            }
                          }}
                          style={styles.redeemButton}
                          buttonColor="#4CAF50"
                          textColor="#FFFFFF"
                        >
                          Redeem
                        </Button>
                      )}
                    </Card.Content>
                  </Card>
                );
              }}
              ListEmptyComponent={() => (
                <Text style={[styles.emptyText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>No rewards available.</Text>
              )}
              contentContainerStyle={{ paddingBottom: 80 }}
            />
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Notifications</Text>
            <FlatList
              data={notifications}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.notificationItem, item.read ? styles.read : styles.unread, { backgroundColor: item.read ? (isDarkMode ? '#444' : '#e0e0e0') : (isDarkMode ? '#333' : '#fff') }]}
                  onPress={async () => {
                    try {
                      const token = await AsyncStorage.getItem('token');
                      await axios.put(
                        `${BASE_URL}/notifications/${item._id}/read`,
                        {},
                        { headers: { Authorization: token } }
                      );
                      setNotifications(notifications.map(n => n._id === item._id ? { ...n, read: true } : n));
                      if (item.type === 'reward_achieved') {
                        Alert.alert('🎉 Congratulations!', `You've won the reward: ${item.rewardId?.name}`);
                      } else if (item.type === 'redemption_approved') {
                        Alert.alert('🎉 Reward Redeemed!', `Your reward "${item.rewardId?.name}" has been approved by admin.`);
                      }
                    } catch (error) {
                      console.error('Error marking notification:', error);
                    }
                  }}
                >
                  <View style={styles.notificationContent}>
                    <Text style={[styles.notificationText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>{item.message}</Text>
                    <Text style={[styles.notificationDate, { color: isDarkMode ? '#999' : '#666' }]}>
                      {new Date(item.createdAt).toLocaleString()}
                    </Text>
                    <Button
                      mode="text"
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          if (window.confirm('Are you sure you want to clear this notification?')) {
                            clearNotification(item._id);
                          }
                        } else {
                          Alert.alert(
                            'Clear Notification',
                            'Are you sure you want to clear this notification?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Clear', style: 'destructive', onPress: () => clearNotification(item._id) },
                            ]
                          );
                        }
                      }}
                      textColor={colors.error}
                      style={styles.clearButton}
                    >
                      Clear
                    </Button>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <Text style={[styles.emptyText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>No notifications.</Text>
              )}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
            <View style={styles.rewardHistoryHeader}>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>Reward History</Text>
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={toggleRewardHistory}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleButtonText, { color: isDarkMode ? '#FFFFFF' : colors.primary }]}>
                  {showRewardHistory ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
            </View>
            {showRewardHistory && (
              <FlatList
                key={`reward-history-${showRewardHistory}`} // Force re-mount on state change
                data={redemptions}
                keyExtractor={(item) => item._id}
                renderItem={({ item }) => (
                  <Card style={[styles.historyItem, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                    <Card.Content>
                      {item.rewardId?.image && <Image source={{ uri: item.rewardId.image }} style={styles.historyImage} />}
                      <Text style={[styles.historyName, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>{item.rewardId?.name}</Text>
                      <Text style={[styles.historyDetails, { color: isDarkMode ? '#999' : '#666' }]}>
                        Redeemed: {new Date(item.redeemedAt).toLocaleString()} | Status: {item.status}
                      </Text>
                    </Card.Content>
                  </Card>
                )}
                ListEmptyComponent={() => (
                  <Text style={[styles.emptyText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>No reward history.</Text>
                )}
                contentContainerStyle={{ paddingBottom: 80 }}
              />
            )}
          </View>
        );
      default:
        return null;
    }
  }, [currentTab, user, admin, barcodes, filteredBarcodes, isDarkMode, colors, showScanner, scanned, barcodeData, error, loading, fetchError, handleScanAction, handleCancelScan, handleSelectScanArea, scanLineTranslate, rewards, notifications, redemptions, fetchRedemptions, fetchNotifications, fetchUserProfile, clearNotification, clearRedemption]);

  // Component Body
  if (hasPermission === false) {
    return (
      <Text style={[styles.permissionText, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
        No access to camera
      </Text>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      <View style={styles.header}>
        <ThemeToggle style={styles.toggle} />
        <Button
          mode="contained"
          onPress={handleLogout}
          style={styles.logoutButton}
          buttonColor={colors.error}
          textColor="#FFFFFF"
          labelStyle={styles.buttonLabel}
        >
          Logout
        </Button>
      </View>
      <Text style={[styles.title, { color: isDarkMode ? '#FFFFFF' : colors.text }]}>
        User Dashboard
      </Text>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {renderContent()}
      </ScrollView>
      <View style={[styles.tabBar, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'home' && styles.activeTab]} onPress={() => setCurrentTab('home')}>
          <MaterialIcons name="home" size={24} color={currentTab === 'home' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'home' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'scan' && styles.activeTab]} onPress={handleScanTabPress}>
          <MaterialIcons name="qr-code-scanner" size={24} color={currentTab === 'scan' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'scan' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Scan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'search' && styles.activeTab]} onPress={() => setCurrentTab('search')}>
          <MaterialIcons name="search" size={24} color={currentTab === 'search' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'search' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'barcode' && styles.activeTab]} onPress={() => setCurrentTab('barcode')}>
          <MaterialIcons name="qr-code" size={24} color={currentTab === 'barcode' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'barcode' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Barcodes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'rewards' && styles.activeTab]} onPress={() => setCurrentTab('rewards')}>
          <MaterialIcons name="card-giftcard" size={24} color={currentTab === 'rewards' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'rewards' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Rewards</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
} // End of UserDashboard function

// Styles
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  toggle: { marginLeft: 10 },
  logoutButton: { borderRadius: 12, paddingVertical: 8, marginVertical: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  title: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3, padding: 16 },
  subtitle: { fontSize: 22, fontWeight: '600', marginVertical: 20, textAlign: 'center', textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 2 },
  scrollContent: { padding: 16, paddingBottom: 80 },
  profileCard: { marginVertical: 10, borderRadius: 12, elevation: 8, shadowColor: '#000', shadowOffset: { width: 2, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6, transform: [{ perspective: 1000 }, { rotateX: '2deg' }] },
  card: { marginVertical: 10, borderRadius: 12, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  cardText: { fontSize: 16, marginVertical: 4, fontWeight: '500', textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 1 },
  scannerContainer: { position: 'relative', marginTop: -10, marginBottom: 20 },
  camera: { height: 300, marginVertical: 20, borderRadius: 12, overflow: 'hidden' },
  scanAreaOverlay: { position: 'absolute', top: 20, left: 0, right: 0, bottom: 20, alignItems: 'center', justifyContent: 'center' },
  scanAreaBox: { width: 200, height: 200, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(0, 0, 0, 0.3)' },
  scanLine: { position: 'absolute', top: 50, left: '10%', width: '80%', height: 2, backgroundColor: 'red' },
  scanLineInner: { width: '20%', height: 4, backgroundColor: '#FF5555', alignSelf: 'center' },
  cancelButton: { position: 'absolute', bottom: 20, alignSelf: 'center', borderRadius: 12, paddingVertical: 8, marginVertical: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  button: { marginVertical: 15, borderRadius: 12, paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  buttonLabel: { fontSize: 14, textAlign: 'center', adjustsFontSizeToFit: true, minimumFontScale: 0.7, paddingHorizontal: 5 },
  error: { marginTop: 10, fontSize: 16, textAlign: 'center', fontWeight: '500', textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 1 },
  success: { marginTop: 10, fontSize: 16, textAlign: 'center', fontWeight: '500', textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 1 },
  loading: { marginVertical: 20 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  emptyText: { textAlign: 'center', fontSize: 16, marginVertical: 10, textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 1 },
  permissionText: { flex: 1, textAlign: 'center', fontSize: 18, textShadowColor: '#000', textShadowOffset: { width: 0.5, height: 0.5 }, textShadowRadius: 1 },
  searchBar: { marginBottom: 16, borderRadius: 25, paddingHorizontal: 10, height: 50 },
  tabBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#ccc', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  tabItem: { flex: 1, alignItems: 'center', paddingBottom: 8 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#FFD700' },
  tabText: { fontSize: 12, marginTop: 4 },

  sliderContainer: { 
    height: 400, 
    marginBottom: 20,
    
  },

  slide: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f0f0' },
  
  sliderImage: { 
    width: '100%', 
    // height: '100%', 
    height: 350,
    resizeMode: 'contain',
    alignSelf: 'center',
    // resizeMode: 'cover'
  },

  sliderText: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  rewardsContainer: { padding: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  rewardItem: { marginVertical: 10, borderRadius: 12, elevation: 6 },

  rewardImage: { 
    width: '100%', 
    height: 330, 
    resizeMode: 'contain', 
    alignSelf: 'center',
    marginVertical: 10, 
    borderRadius: 8 },

  rewardName: { fontSize: 18, fontWeight: 'bold' },
  rewardDetails: { fontSize: 14, marginBottom: 10 },
  // progressBar: { height: 10, borderRadius: 5, marginBottom: 5 }, remove
  progressBar: { height: 10, backgroundColor: '#e0e0e0', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#4CAF50' },
  
  progressText: { fontSize: 12 },
  redeemButton: { marginTop: 10, borderRadius: 12 },
  notificationContent: { flex: 1 },
  notificationItem: { padding: 15, borderRadius: 10, marginBottom: 10, elevation: 2, flexDirection: 'row', alignItems: 'center' },
  read: { opacity: 0.7 },
  unread: { elevation: 4 },
  notificationText: { fontSize: 16 },
  notificationDate: { fontSize: 12 },
  historyItem: { marginVertical: 10, borderRadius: 12, elevation: 6 },
  historyImage: { width: 80, height: 80, borderRadius: 10, marginBottom: 10 },
  historyName: { fontSize: 16, fontWeight: 'bold' },
  // historyDetails: { fontSize: 14 },
  // rewardAchieved: { color: '#2196F3', fontWeight: 'bold', textAlign: 'center', marginTop: 5 },
  remainingPoints: { color: '#FF9800', textAlign: 'center', marginTop: 5 },
  rewardAchieved: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2196F3',
    marginTop: 8,
  },
  remainingPoints: {
    fontSize: 14,
    color: '#FF5722',
    marginTop: 6,
  },
  redeemButton: {
    marginTop: 10,
    borderRadius: 6,
  },

  rewardHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 10,
  },
  toggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    backgroundColor: 'transparent',
  },
  toggleButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },

  clearButton: { marginTop: 5 },
});