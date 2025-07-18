import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, Text, ScrollView, ActivityIndicator, Platform, TouchableOpacity, Alert } from 'react-native';
import { Button, Card, TextInput, useTheme } from 'react-native-paper';
import { SearchBar } from '@rneui/themed';
// import { Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Toast from 'react-native-toast-message';
import ThemeToggle from '../components/ThemeToggle';
import { ThemeContext } from '../ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { BackHandler } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import jsPDF from 'jspdf';
import bwipjs from 'bwip-js';


// const BASE_URL = 'http://localhost:5000';
const BASE_URL = 'https://barcodescane-backend.onrender.com';

const isWeb = Platform.OS === 'web';

export default function SuperAdminDashboard({ navigation }) {
  const { colors } = useTheme();
  const { isDarkMode } = useContext(ThemeContext);
  const [admins, setAdmins] = useState([]);
  const [users, setUsers] = useState([]);
  const [barcodes, setBarcodes] = useState([]);
  const [searchAdmin, setSearchAdmin] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [searchBarcode, setSearchBarcode] = useState('');
  const [showPassword, setShowPassword] = useState(null);
  const [passwordAdminId, setPasswordAdminId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState('home');
  const [superAdmin, setSuperAdmin] = useState(null);
  const [selectedAdminId, setSelectedAdminId] = useState(null);
  const [userBarcodes, setUserBarcodes] = useState([]);
  const [barcodeSettings, setBarcodeSettings] = useState({
    prefix: 'OPT',
    startNumber: '1',
    count: '50',
    companyName: '',
    digitCount: '7',
    mode: 'with-outline',
    rightText: '20/-'
  });
  const [selectedAdminForUser, setSelectedAdminForUser] = useState('');

    const showConfirmDialog = useCallback((title, message, onConfirm) => {
    if (isWeb) {
      if (window.confirm(`${title}\n${message}`)) onConfirm();
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: title.includes('Delete') ? 'Delete' : 'Confirm', style: 'destructive', onPress: onConfirm },
      ]);
    }
  }, [isWeb]);
  
  useEffect(() => {
    const refreshToken = async () => {
      try {
        const credentials = await AsyncStorage.getItem('credentials');
        if (!credentials) return;
        const { mobile, password } = JSON.parse(credentials);
        const response = await axios.post(`${BASE_URL}/login`, { mobile, password });
        await AsyncStorage.setItem('token', response.data.token);
        await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
        Toast.show({ type: 'success', text1: 'Session Refreshed' });
      } catch (error) {
        Toast.show({ type: 'error', text1: 'Session Refresh Failed' });
        await AsyncStorage.clear();
        navigation.replace('Home');
      }
    };
    const interval = setInterval(refreshToken, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [navigation]);

  useEffect(() => {
    const fetchSuperAdmin = async () => {
      try {
        const storedUser = await AsyncStorage.getItem('user');
        if (storedUser) setSuperAdmin(JSON.parse(storedUser));
      } catch (error) {
        Toast.show({ type: 'error', text1: 'Super Admin Data Fetch Failed' });
      }
    };
    fetchSuperAdmin();
    fetchData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') {
        const onBackPress = () => {
          navigation.navigate('SuperAdminDashboard');
          return true;
        };
        BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      }
    }, [navigation])
  );

  const handleUnauthorized = useCallback(async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.clear();
      navigation.replace('Home');
      Toast.show({ type: 'error', text1: 'Session Expired' });
      return true;
    }
    return false;
  }, [navigation]);

  // Add function to view admin password
  const handleViewAdminPassword = useCallback((adminId) => {
    // Validate adminId format
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(adminId);
    if (!isValidObjectId) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Admin ID',
        text2: `Admin ID ${adminId} is not in a valid format`,
      });
      return;
    }
    showConfirmDialog('View Password', 'Are you sure you want to view this admin\'s password? This is a sensitive operation.', async () => {
      setLoading(true);
      try {
        console.log(`Fetching password for adminId: ${adminId}`); // Debugging
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await axios.get(`${BASE_URL}/admins/${adminId}/password`, { 
          headers: { Authorization: token } 
        });
        setShowPassword(response.data.password);
        setPasswordAdminId(adminId);
        Toast.show({ type: 'success', text1: 'Password Retrieved' });
      } catch (error) {
        console.error('Error fetching admin password:', error.response?.data || error.message); // Debugging
        if (await handleUnauthorized(error)) return;
        const errorMessage = error.response?.data?.message || `Failed to fetch password for admin ${adminId}`;
        Toast.show({ 
          type: 'error', 
          text1: 'Fetch Password Failed', 
          text2: errorMessage 
        });
      } finally {
        setLoading(false);
      }
    });
  }, [handleUnauthorized, showConfirmDialog]);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No token found');
      const [usersRes, barcodesRes, adminsRes] = await Promise.all([
        axios.get(`${BASE_URL}/users`, { headers: { Authorization: token } }),
        axios.get(`${BASE_URL}/barcodes`, { headers: { Authorization: token } }),
        axios.get(`${BASE_URL}/admins`, { headers: { Authorization: token } }),
      ]);
      const validUsers = usersRes.data.filter(user => user.name && user.mobile);
      const sortedUsers = validUsers.sort((a, b) => {
        if (a.status === 'approved' && b.status === 'approved') return b.points - a.points;
        if (a.status === 'approved') return -1;
        if (b.status === 'approved') return 1;
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return 0;
      });
      setUsers(sortedUsers.filter(user => user.role === 'user'));
      setAdmins(adminsRes.data.map(admin => ({ id: admin._id, name: admin.name, mobile: admin.mobile, status: admin.status, uniqueCode: admin.uniqueCode }))); // Include uniqueCode
      setBarcodes(barcodesRes.data);
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      Toast.show({
        type: 'error',
        text1: 'Fetch Failed',
        text2: error.response?.data?.message || 'Could not load data.',
      });
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized]);

  const handleStatusUpdate = useCallback(async (userId, status) => {
    if (status === 'approved' && !selectedAdminForUser) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Please select an admin before approving.' });
      return;
    }
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.put(
        `${BASE_URL}/users/${userId}/status`,
        { status, adminId: status === 'approved' ? selectedAdminForUser : undefined },
        { headers: { Authorization: token } }
      );
      Toast.show({ type: 'success', text1: 'Status Updated' });
      setSelectedAdminForUser('');
      await fetchData();
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      Toast.show({ type: 'error', text1: 'Update Failed', text2: error.response?.data?.message || 'Could not update status.' });
    } finally {
      setLoading(false);
    }
  }, [fetchData, handleUnauthorized, selectedAdminForUser]);

  // CHANGE: Added handleStatusUpdateAdmin to handle admin status updates via /admins/:id/status
  const handleStatusUpdateAdmin = useCallback(async (adminId, status) => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No token found');
      console.log(`Sending approval request for adminId: ${adminId}, status: ${status}`); // Debugging
      const response = await axios.put(
        `${BASE_URL}/admins/${adminId}/status`,
        { status },
        { headers: { Authorization: token } }
      );
      console.log('Approval response:', response.data); // Debugging
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: `Admin ${status} successfully`,
      });
      await fetchData(); // Refresh admin list
    } catch (error) {
      console.error('Error approving admin:', error.response?.data || error.message); // Debugging
      if (await handleUnauthorized(error)) return;
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.response?.data?.message || 'Failed to update admin status',
      });
    } finally {
      setLoading(false);
    }
  }, [fetchData, handleUnauthorized]);

  const handleDeleteAdmin = useCallback((adminId) => {
    showConfirmDialog('Confirm Delete', 'Delete this admin?', async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        await axios.delete(`${BASE_URL}/users/${adminId}`, { headers: { Authorization: token } });
        Toast.show({ type: 'success', text1: 'Admin Deleted' });
        await fetchData();
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        Toast.show({ type: 'error', text1: 'Delete Failed', text2: error.response?.data?.message || 'Could not delete admin.' });
      } finally {
        setLoading(false);
      }
    });
  }, [fetchData, handleUnauthorized, showConfirmDialog]);

  const handleSetAdminUserLimit = useCallback(async (adminId, limit) => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.put(`${BASE_URL}/admins/${adminId}/user-limit`, { userLimit: parseInt(limit) }, { headers: { Authorization: token } });
      Toast.show({ type: 'success', text1: 'User Limit Updated' });
      await fetchData();
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      Toast.show({ type: 'error', text1: 'Update Failed', text2: error.response?.data?.message || 'Could not update user limit.' });
    } finally {
      setLoading(false);
    }
  }, [fetchData, handleUnauthorized]);

  const fetchUserBarcodes = useCallback(async (userId) => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${BASE_URL}/barcodes/user/${userId}`, { headers: { Authorization: token } });
      setUserBarcodes(response.data);
      setSelectedAdminId(userId);
      if (!response.data.length) Toast.show({ type: 'info', text1: 'No Barcodes' });
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      Toast.show({ type: 'error', text1: 'Fetch Failed', text2: error.response?.data?.message || 'Could not fetch barcodes.' });
      setUserBarcodes([]);
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized]);

  const handleDeleteUser = useCallback((userId) => {
    showConfirmDialog('Confirm Delete', 'Delete this user?', async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        await axios.delete(`${BASE_URL}/users/${userId}`, { headers: { Authorization: token } });
        Toast.show({ type: 'success', text1: 'User Deleted' });
        await fetchData();
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        Toast.show({ type: 'error', text1: 'Delete Failed', text2: error.response?.data?.message || 'Could not delete user.' });
      } finally {
        setLoading(false);
      }
    });
  }, [fetchData, handleUnauthorized, showConfirmDialog]);

  const handleDeleteBarcode = useCallback((barcodeId) => {
    showConfirmDialog('Confirm Delete', 'Delete this barcode?', async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        await axios.delete(`${BASE_URL}/barcodes/${barcodeId}`, { headers: { Authorization: token } });
        Toast.show({ type: 'success', text1: 'Barcode Deleted' });
        if (selectedAdminId) await fetchUserBarcodes(selectedAdminId);
        else await fetchData();
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        Toast.show({ type: 'error', text1: 'Delete Failed', text2: error.response?.data?.message || 'Could not delete barcode.' });
      } finally {
        setLoading(false);
      }
    });
  }, [fetchData, fetchUserBarcodes, handleUnauthorized, selectedAdminId, showConfirmDialog]);

  const handleResetPoints = useCallback((userId) => {
    showConfirmDialog('Confirm Reset Points', 'Reset user points?', async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        await axios.put(`${BASE_URL}/users/${userId}/reset-points`, {}, { headers: { Authorization: token } });
        Toast.show({ type: 'success', text1: 'Points Reset' });
        await fetchData();
      } catch (error) {
        if (await handleUnauthorized(error)) return;
        Toast.show({ type: 'error', text1: 'Reset Failed', text2: error.response?.data?.message || 'Could not reset points.' });
      } finally {
        setLoading(false);
      }
    });
  }, [fetchData, handleUnauthorized, showConfirmDialog]);

  const handleLogout = useCallback(async () => {
    try {
      await AsyncStorage.clear();
      navigation.replace('Home');
      Toast.show({ type: 'success', text1: 'Logged Out' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Logout Failed', text2: error.message });
    }
  }, [navigation]);


//// a3 size works
  // const generateBarcodePDF = useCallback(async () => {
  //   try {
  //     const { prefix, startNumber, count, companyName, digitCount , mode: pdfMode} = barcodeSettings;
      
  //     if (!prefix || !startNumber || !count || !digitCount || isNaN(startNumber) || isNaN(count) || isNaN(digitCount) || parseInt(count) <= 0 || parseInt(digitCount) <= 0) {
  //       Toast.show({ type: 'error', text1: 'Invalid Inputs' });
  //       return;
  //     }
      
  //     const maxNumber = parseInt(startNumber) + parseInt(count) - 1;
  //     const minDigits = Math.ceil(Math.log10(maxNumber + 1));
  //     if (parseInt(digitCount) < minDigits) {
  //       Toast.show({ type: 'error', text1: `Digit count must be at least ${minDigits} for ${count} barcodes` });
  //       return;
  //     }

  //     // A3 in inches (13 x 19) converted to mm = 330.2 x 482.6
  //     const doc = new jsPDF({ unit: 'mm', format: [330.2, 482.6] });
  //     const cols = 7;
  //     const rows = 28;
  //     const layoutWidth = 286;
  //     const layoutHeight = 451.57;
  //     const marginX = (330.2 - layoutWidth) / 2;
  //     const marginY = (482.6 - layoutHeight) / 2;

  //     const boxWidth = layoutWidth / cols; // ≈ 40.86mm
  //     const boxHeight = layoutHeight / rows; // ≈ 16.13mm

  //     const barcodeWidth = boxWidth - 8; // padding inside box
  //     const barcodeHeight = 6;
  //     const companyFontSize = 5;
  //     const barcodeFontSize = 5;

  //     let x = marginX;
  //     let y = marginY;

  //     for (let i = 0; i < parseInt(count); i++) {
  //       const barcodeValue = `${prefix}${(parseInt(startNumber) + i).toString().padStart(parseInt(digitCount), '0')}`;
  //       let imgData;

  //       if (isWeb) {
  //         const canvas = document.createElement('canvas');
  //         await bwipjs.toCanvas(canvas, {
  //           bcid: 'code128',
  //           text: barcodeValue,
  //           scale: 2,
  //           height: barcodeHeight,
  //           includetext: false,
  //         });
  //         imgData = canvas.toDataURL('image/png');
  //       } else {
  //         const buffer = await new Promise((resolve, reject) => {
  //           bwipjs.toBuffer(
  //             {
  //               bcid: 'code128',
  //               text: barcodeValue,
  //               scale: 2,
  //               height: barcodeHeight,
  //               includetext: false,
  //             },
  //             (err, png) => {
  //               if (err) reject(err);
  //               else resolve(png);
  //             }
  //           );
  //         });
  //         imgData = `data:image/png;base64,${buffer.toString('base64')}`;
  //       }

  //       // Draw border box
  //       // doc.setDrawColor(0);
  //       // doc.setLineWidth(0.2);
  //       // doc.rect(x, y, boxWidth, boxHeight); //for with outline

  //       // doc.setDrawColor(0);
  //       // doc.setLineWidth(0.2);
  //       // doc.setFillColor(255, 255, 255); // Optional: white background
  //       // doc.rect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 'FD'); // Draw with small gap

  //       if (pdfMode !== 'without-outline') {
  //         doc.setDrawColor(0);
  //         doc.setLineWidth(0.2);
  //         doc.setFillColor(255, 255, 255);
  //         doc.rect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 'FD'); // Independent box
  //       }

  //       // Draw company name
  //       // if (companyName) {
  //       //   doc.setFontSize(companyFontSize);
  //       //   doc.setFont('helvetica', 'bold');
  //       //   const textWidth = doc.getTextWidth(companyName);
  //       //   doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
  //       // }


  //       // // Draw barcode image
  //       // const barcodeX = x + (boxWidth - barcodeWidth) / 2;
  //       // const barcodeY = y + 5.5;
  //       // doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight);

  //       // // Draw barcode number
  //       // doc.setFontSize(barcodeFontSize);
  //       // doc.setFont('helvetica', 'normal');
  //       // const valTextWidth = doc.getTextWidth(barcodeValue);
  //       // doc.text(barcodeValue, x + (boxWidth - valTextWidth) / 2, barcodeY + barcodeHeight + 3);

  //       // with other setting
  //       if (pdfMode === 'with-outline') {
  //         // Company name
  //         if (companyName) {
  //           doc.setFontSize(companyFontSize);
  //           doc.setFont('helvetica', 'bold');
  //           const textWidth = doc.getTextWidth(companyName);
  //           doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
  //         }

  //         // Barcode image
  //         const barcodeX = x + (boxWidth - barcodeWidth) / 2;
  //         const barcodeY = y + 5.5;
  //         doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight);

  //         // Barcode number
  //         doc.setFontSize(barcodeFontSize);
  //         doc.setFont('helvetica', 'normal');
  //         const valTextWidth = doc.getTextWidth(barcodeValue);
  //         doc.text(barcodeValue, x + (boxWidth - valTextWidth) / 2, barcodeY + barcodeHeight + 3);
  //       }

  //       if (pdfMode !== 'only-outline') {
  //         // Company name
  //         if (companyName) {
  //           doc.setFontSize(companyFontSize);
  //           doc.setFont('helvetica', 'bold');
  //           const textWidth = doc.getTextWidth(companyName);
  //           doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
  //         }

  //         // Barcode image
  //         const barcodeX = x + (boxWidth - barcodeWidth) / 2;
  //         const barcodeY = y + 5.5;
  //         doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight);

  //         // Barcode number
  //         doc.setFontSize(barcodeFontSize);
  //         doc.setFont('helvetica', 'normal');
  //         const valTextWidth = doc.getTextWidth(barcodeValue);
  //         doc.text(barcodeValue, x + (boxWidth - valTextWidth) / 2, barcodeY + barcodeHeight + 3);
  //       }


  //       // Update position
  //       x += boxWidth;
  //       if ((i + 1) % cols === 0) {
  //         x = marginX;
  //         y += boxHeight;
  //       }

  //       // New page
  //       if ((i + 1) % (cols * rows) === 0 && i + 1 < parseInt(count)) {
  //         doc.addPage();
  //         x = marginX;
  //         y = marginY;
  //       }
  //     }

  //     const batchName = 'barcodes.pdf';
  //     if (isWeb) {
  //       const pdfOutput = doc.output('blob');
  //       const url = window.URL.createObjectURL(pdfOutput);
  //       const link = document.createElement('a');
  //       link.href = url;
  //       link.download = batchName;
  //       document.body.appendChild(link);
  //       link.click();
  //       document.body.removeChild(link);
  //       window.URL.revokeObjectURL(url);
  //     } else {
  //       const pdfBase64 = doc.output('datauristring').split(',')[1];
  //       const fileUri = `${FileSystem.documentDirectory}${batchName}`;
  //       await FileSystem.writeAsStringAsync(fileUri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
  //       await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf' });
  //     }

  //     Toast.show({ type: 'success', text1: 'PDF Generated' });
  //   } catch (error) {
  //     Toast.show({ type: 'error', text1: 'PDF Generation Failed', text2: error.message });
  //   }
  // }, [barcodeSettings, isWeb]);

  // A4 size works
  const generateBarcodePDF = useCallback(async () => {
    try {
      const { prefix, startNumber, count, companyName, digitCount, mode: pdfMode, rightText } = barcodeSettings;

      if (!prefix || !startNumber || !count || !digitCount || isNaN(startNumber) || isNaN(count) || isNaN(digitCount) || parseInt(count) <= 0 || parseInt(digitCount) <= 0) {
        Toast.show({ type: 'error', text1: 'Invalid Inputs' });
        return;
      }

      const maxNumber = parseInt(startNumber) + parseInt(count) - 1;
      const minDigits = Math.ceil(Math.log10(maxNumber + 1));
      if (parseInt(digitCount) < minDigits) {
        Toast.show({ type: 'error', text1: `Digit count must be at least ${minDigits} for ${count} barcodes` });
        return;
      }

      // A4 size = 210 x 297 mm
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const cols = 4;
      const rows = 10;
      const pageWidth = 210;
      const pageHeight = 297;
      const layoutWidth = 180;
      const layoutHeight = 260;
      const marginX = (pageWidth - layoutWidth) / 2;
      const marginY = (pageHeight - layoutHeight) / 2;

      const boxWidth = layoutWidth / cols;
      const boxHeight = layoutHeight / rows;

      const barcodeWidth = boxWidth - 12;
      const barcodeHeight = 12;
      const companyFontSize = 5;
      const barcodeFontSize = 5;
      const rightTextFontSize = 4;

      let x = marginX;
      let y = marginY;

      for (let i = 0; i < parseInt(count); i++) {
        const barcodeValue = `${prefix}${(parseInt(startNumber) + i).toString().padStart(parseInt(digitCount), '0')}`;
        let imgData;

        if (isWeb) {
          const canvas = document.createElement('canvas');
          await bwipjs.toCanvas(canvas, {
            bcid: 'code128',
            text: barcodeValue,
            scale: 2,
            height: barcodeHeight,
            includetext: false,
          });
          imgData = canvas.toDataURL('image/png');
        } else {
          const buffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer(
              {
                bcid: 'code128',
                text: barcodeValue,
                scale: 2,
                height: barcodeHeight,
                includetext: false,
              },
              (err, png) => {
                if (err) reject(err);
                else resolve(png);
              }
            );
          });
          imgData = `data:image/png;base64,${buffer.toString('base64')}`;
        }

        if (pdfMode !== 'without-outline') {
          doc.setDrawColor(0);
          doc.setLineWidth(0.2);
          doc.setFillColor(255, 255, 255);
          doc.rect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 'FD'); // Independent box
        }

        // Draw company name
        // if (companyName) {
        //   doc.setFontSize(companyFontSize);
        //   doc.setFont('helvetica', 'bold');
        //   const textWidth = doc.getTextWidth(companyName);
        //   doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
        // }

        if (pdfMode === 'with-outline' || pdfMode !== 'only-outline') {
          // Company name
          if (companyName) {
            doc.setFontSize(companyFontSize);
            doc.setFont('helvetica', 'bold');
            const textWidth = doc.getTextWidth(companyName);
            doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
          }

          // Barcode image
          const barcodeX = x + (boxWidth - barcodeWidth) / 2;
          const barcodeY = y + 5.5;
          doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight);

          // Draw barcode number
          doc.setFontSize(barcodeFontSize);
          doc.setFont('helvetica', 'normal');
          const valTextWidth = doc.getTextWidth(barcodeValue);
          const barcodeNumberY = barcodeY + barcodeHeight + 3;
          const barcodeNumberX = x + (boxWidth - valTextWidth) / 2;

          doc.text(barcodeValue, barcodeNumberX, barcodeNumberY);

          // ✅ Draw rightText just after the barcode number (horizontally)
          if (rightText) {
            doc.setFontSize(rightTextFontSize);
            doc.setFont('helvetica', 'italic');
            doc.text(rightText, barcodeNumberX + valTextWidth + 1, barcodeNumberY); // 2mm gap after barcode number
          }
        }

        // Update position
        x += boxWidth;
        if ((i + 1) % cols === 0) {
          x = marginX;
          y += boxHeight;
        }

        // New page
        if ((i + 1) % (cols * rows) === 0 && i + 1 < parseInt(count)) {
          doc.addPage();
          x = marginX;
          y = marginY;
        }
      }

      const batchName = 'barcodes.pdf';
      if (isWeb) {
        const pdfOutput = doc.output('blob');
        const url = window.URL.createObjectURL(pdfOutput);
        const link = document.createElement('a');
        link.href = url;
        link.download = batchName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        const pdfBase64 = doc.output('datauristring').split(',')[1];
        const fileUri = `${FileSystem.documentDirectory}${batchName}`;
        await FileSystem.writeAsStringAsync(fileUri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf' });
      }

      Toast.show({ type: 'success', text1: 'PDF Generated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'PDF Generation Failed', text2: error.message });
    }
  }, [barcodeSettings, isWeb]);



  // for less storage commpressed one
  // const generateBarcodePDF = useCallback(async () => {
  //   try {
  //     const { prefix, startNumber, count, companyName, digitCount, mode: pdfMode } = barcodeSettings;

  //     if (!prefix || !startNumber || !count || !digitCount || isNaN(startNumber) || isNaN(count) || isNaN(digitCount) || parseInt(count) <= 0 || parseInt(digitCount) <= 0) {
  //       Toast.show({ type: 'error', text1: 'Invalid Inputs' });
  //       return;
  //     }

  //     const maxNumber = parseInt(startNumber) + parseInt(count) - 1;
  //     const minDigits = Math.ceil(Math.log10(maxNumber + 1));
  //     if (parseInt(digitCount) < minDigits) {
  //       Toast.show({ type: 'error', text1: `Digit count must be at least ${minDigits} for ${count} barcodes` });
  //       return;
  //     }

  //     const doc = new jsPDF({
  //       unit: 'mm',
  //       format: [330.2, 482.6], // A3 size
  //       compress: true, // Enable PDF compression
  //     });

  //     const cols = 7;
  //     const rows = 28;
  //     const layoutWidth = 286;
  //     const layoutHeight = 451.57;
  //     const marginX = (330.2 - layoutWidth) / 2;
  //     const marginY = (482.6 - layoutHeight) / 2;

  //     const boxWidth = layoutWidth / cols;
  //     const boxHeight = layoutHeight / rows;
  //     const barcodeWidth = boxWidth - 8;
  //     const barcodeHeight = 6;
  //     const companyFontSize = 5;
  //     const barcodeFontSize = 5;

  //     let x = marginX;
  //     let y = marginY;

  //     for (let i = 0; i < parseInt(count); i++) {
  //       const barcodeValue = `${prefix}${(parseInt(startNumber) + i).toString().padStart(parseInt(digitCount), '0')}`;
  //       let imgData = null;

  //       if (pdfMode !== 'only-outline') {
  //         if (isWeb) {
  //           const canvas = document.createElement('canvas');
  //           await bwipjs.toCanvas(canvas, {
  //             bcid: 'code128',
  //             text: barcodeValue,
  //             scale: 2, // High-quality resolution
  //             height: barcodeHeight * 3, // Full barcode height
  //             includetext: false,
  //           });
  //           imgData = canvas.toDataURL('image/png');
  //         } else {
  //           const buffer = await new Promise((resolve, reject) => {
  //             bwipjs.toBuffer(
  //               {
  //                 bcid: 'code128',
  //                 text: barcodeValue,
  //                 scale: 2,
  //                 height: barcodeHeight * 3,
  //                 includetext: false,
  //               },
  //               (err, png) => {
  //                 if (err) reject(err);
  //                 else resolve(png);
  //               }
  //             );
  //           });
  //           imgData = `data:image/png;base64,${buffer.toString('base64')}`;
  //         }
  //       }

  //       // Border box
  //       if (pdfMode !== 'without-outline') {
  //         doc.setDrawColor(0);
  //         doc.setLineWidth(0.2);
  //         doc.setFillColor(255, 255, 255);
  //         doc.rect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 'FD');
  //       }

  //       if (pdfMode !== 'only-outline') {
  //         // Company name
  //         if (companyName) {
  //           doc.setFontSize(companyFontSize);
  //           doc.setFont('helvetica', 'bold');
  //           const textWidth = doc.getTextWidth(companyName);
  //           doc.text(companyName, x + (boxWidth - textWidth) / 2, y + 4.2);
  //         }

  //         // Barcode
  //         const barcodeX = x + (boxWidth - barcodeWidth) / 2;
  //         const barcodeY = y + 5.5;
  //         doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight);

  //         // Barcode number
  //         doc.setFontSize(barcodeFontSize);
  //         doc.setFont('helvetica', 'normal');
  //         const valTextWidth = doc.getTextWidth(barcodeValue);
  //         doc.text(barcodeValue, x + (boxWidth - valTextWidth) / 2, barcodeY + barcodeHeight + 3);
  //       }

  //       x += boxWidth;
  //       if ((i + 1) % cols === 0) {
  //         x = marginX;
  //         y += boxHeight;
  //       }

  //       if ((i + 1) % (cols * rows) === 0 && i + 1 < parseInt(count)) {
  //         doc.addPage();
  //         x = marginX;
  //         y = marginY;
  //       }
  //     }

  //     const batchName = 'barcodes.pdf';

  //     if (isWeb) {
  //       const pdfOutput = doc.output('blob');
  //       const url = window.URL.createObjectURL(pdfOutput);
  //       const link = document.createElement('a');
  //       link.href = url;
  //       link.download = batchName;
  //       document.body.appendChild(link);
  //       link.click();
  //       document.body.removeChild(link);
  //       window.URL.revokeObjectURL(url);
  //     } else {
  //       const pdfBase64 = doc.output('datauristring').split(',')[1];
  //       const fileUri = `${FileSystem.documentDirectory}${batchName}`;
  //       await FileSystem.writeAsStringAsync(fileUri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
  //       await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf' });
  //     }

  //     Toast.show({ type: 'success', text1: 'PDF Generated' });
  //   } catch (error) {
  //     Toast.show({ type: 'error', text1: 'PDF Generation Failed', text2: error.message });
  //   }
  // }, [barcodeSettings, isWeb]);



  const debouncedSetSearchAdmin = useCallback(debounce((value) => setSearchAdmin(value), 2), []);
  const debouncedSetSearchUser = useCallback(debounce((value) => setSearchUser(value), 2), []);
  const debouncedSetSearchBarcode = useCallback(debounce((value) => setSearchBarcode(value), 2), []);

  const filteredAdmins = useMemo(() => admins.filter(
    (admin) => (admin.name || '').toLowerCase().includes(searchAdmin.toLowerCase()) || (admin.mobile || '').toLowerCase().includes(searchAdmin.toLowerCase()) || (admin.uniqueCode || '').toLowerCase().includes(searchAdmin.toLowerCase())
  ), [admins, searchAdmin]);

  const filteredUsers = useMemo(() => users.filter(
    (user) => (user.name || '').toLowerCase().includes(searchUser.toLowerCase()) || (user.mobile || '').toLowerCase().includes(searchUser.toLowerCase())
  ), [users, searchUser]);

  const filteredBarcodes = useMemo(() => barcodes.filter(
    (barcode) => (barcode.value || '').toLowerCase().includes(searchBarcode.toLowerCase())
  ), [barcodes, searchBarcode]);

  const getItemLayout = useCallback((data, index) => ({ length: 200, offset: 200 * index, index }), []);

  const renderContent = () => {
    switch (currentTab) {
      case 'home':
        return (
          <>
            <View style={styles.header}>
              <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Super Admin Home</Text>
              <ThemeToggle style={styles.toggle} />
            </View>
            <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
              <Card.Content>
                <Text style={[styles.cardText, { color: isDarkMode ? '#FFD700' : colors.text }]}>Super Admin: {superAdmin?.name || 'Unknown'}</Text>
                <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Admins: {admins.length}</Text>
                <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Users: {users.length}</Text>
                <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Barcodes: {barcodes.length}</Text>
              </Card.Content>
            </Card>
            <Button mode="contained" onPress={handleLogout} style={styles.button} buttonColor={colors.error} textColor="#FFF" labelStyle={styles.buttonLabel}>
              Logout
            </Button>
          </>
        );
      case 'admins':
        return (
          <>
            <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Admins</Text>
            <SearchBar
              placeholder="Search Admins"
              value={searchAdmin}
              onChangeText={debouncedSetSearchAdmin}
              inputStyle={{ color: isDarkMode ? '#FFF' : colors.text }}
              containerStyle={[styles.searchBar, { backgroundColor: isDarkMode ? '#555' : colors.surface }]}
              round
            />
            <FlatList
              data={filteredAdmins}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                  <Card.Content>
                    {selectedAdminId !== item.id ? (
                      <>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFD700' : colors.text }]}>Name: {item.name}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Mobile: {item.mobile}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Unique Code: {item.uniqueCode}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Status: {item.status === 'approved' ? 'Active' : item.status}</Text>
                        {passwordAdminId === item.id && showPassword && (
                          <View style={styles.passwordContainer}>
                            <Text style={[styles.cardText, { color: colors.error, fontWeight: 'bold' }]}>
                              Warning: Passwords are sensitive!
                            </Text>
                            <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>
                              Password: {showPassword}
                            </Text>
                            <Button
                              mode="text"
                              onPress={() => {
                                setShowPassword(null);
                                setPasswordAdminId(null); // Clear admin ID
                              }}
                              textColor={isDarkMode ? '#FF5555' : colors.error}
                            >
                              Hide
                            </Button>
                          </View>
                        )}
                        <View style={styles.buttonRow}>
                          {item.status === 'pending' ? (
                            <>
                              <Button
                                mode="contained"
                                onPress={() => handleStatusUpdateAdmin(item.id, 'approved')}
                                style={styles.actionButton}
                                buttonColor={colors.primary}
                                textColor={isDarkMode ? '#FFF' : '#212121'}
                                labelStyle={styles.buttonLabel}
                              >
                                Approve
                              </Button>
                              <Button
                                mode="contained"
                                onPress={() => handleStatusUpdateAdmin(item.id, 'disapproved')}
                                style={styles.actionButton}
                                buttonColor={colors.error}
                                textColor="#FFF"
                                labelStyle={styles.buttonLabel}
                              >
                                Disapprove
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteAdmin(item.id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                            </>
                          ) : item.status === 'disapproved' ? (
                            <Button
                              mode="outlined"
                              onPress={() => handleDeleteAdmin(item.id)}
                              style={styles.actionButton}
                              textColor={isDarkMode ? '#FF5555' : colors.error}
                              labelStyle={styles.buttonLabel}
                            >
                              Delete
                            </Button>
                          ) : (
                            <>
                              <Button
                                mode="outlined"
                                onPress={() => Toast.show({ type: 'info', text1: 'Not Available', text2: 'Barcodes are not applicable for admins.' })}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#00FF00' : colors.accent}
                                labelStyle={styles.buttonLabel}
                              >
                                View Barcodes
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteAdmin(item.id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                              <Button
                                mode="outlined"
                                // onPress={() => {
                                //   const limit = prompt('Enter user limit:');
                                //   if (limit && !isNaN(limit)) handleSetAdminUserLimit(item.id, limit);
                                // }}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FFD700' : colors.accent}
                                labelStyle={styles.buttonLabel}
                              >
                                Set Limit
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleViewAdminPassword(item.id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FFD700' : colors.accent}
                                labelStyle={styles.buttonLabel}
                              >
                                View Password
                              </Button>
                            </>
                          )}
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Barcodes of {item.name}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Total: {userBarcodes.length}</Text>
                        <FlatList
                          data={userBarcodes}
                          keyExtractor={(barcode) => barcode._id}
                          renderItem={({ item: barcode }) => (
                            <View style={styles.barcodeItem}>
                              <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text, flex: 1 }]}>{barcode.value} - {new Date(barcode.createdAt).toLocaleString()} - Points: {barcode.pointsAwarded}</Text>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteBarcode(barcode._id)}
                                style={[styles.actionButton, { minWidth: 80 }]}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                            </View>
                          )}
                          ListEmptyComponent={<Text style={[styles.emptyText, { color: isDarkMode ? '#FFF' : colors.text }]}>No barcodes found.</Text>}
                          initialNumToRender={10}
                          maxToRenderPerBatch={10}
                          windowSize={5}
                          getItemLayout={getItemLayout}
                        />
                        <Button
                          mode="contained"
                          onPress={() => setSelectedAdminId(null)}
                          style={styles.button}
                          buttonColor={colors.primary}
                          textColor={isDarkMode ? '#FFF' : '#212121'}
                          labelStyle={styles.buttonLabel}
                        >
                          Back
                        </Button>
                      </>
                    )}
                  </Card.Content>
                </Card>
              )}
              ListEmptyComponent={<Text style={[styles.emptyText, { color: isDarkMode ? '#FFF' : colors.text }]}>No admins found.</Text>}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              getItemLayout={getItemLayout}
            />
          </>
        );
      case 'users':
        return (
          <>
            <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Users</Text>
            <View style={[styles.pickerContainer, { backgroundColor: isDarkMode ? '#444' : '#fff' }]}>
              <Picker
                selectedValue={selectedAdminForUser}
                onValueChange={(itemValue) => setSelectedAdminForUser(itemValue)}
                style={[styles.picker, { color: isDarkMode ? '#FFF' : colors.text }]}
                dropdownIconColor={isDarkMode ? '#FFF' : colors.text}
              >
                <Picker.Item label="Select Admin" value="" />
                {admins.map((admin) => (
                  <Picker.Item key={admin.id} label={admin.name} value={admin.id} />
                ))}
              </Picker>
            </View>
            <SearchBar
              placeholder="Search Users"
              value={searchUser}
              onChangeText={debouncedSetSearchUser}
              inputStyle={{ color: isDarkMode ? '#FFF' : colors.text }}
              containerStyle={[styles.searchBar, { backgroundColor: isDarkMode ? '#555' : colors.surface }]}
              round
            />
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
                  <Card.Content>
                    {selectedAdminId !== item._id ? (
                      <>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFD700' : colors.text }]}>Name: {item.name}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Mobile: {item.mobile}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Status: {item.status === 'approved' ? 'Active' : item.status}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Points: {item.points}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Assigned Admin: {admins.find(admin => admin.id === item.adminId)?.name || 'None'}</Text>
                        <View style={styles.buttonRow}>
                          {item.status === 'pending' ? (
                            <>
                              <Button
                                mode="contained"
                                onPress={() => handleStatusUpdate(item._id, 'approved')}
                                style={styles.actionButton}
                                buttonColor={colors.primary}
                                textColor={isDarkMode ? '#FFF' : '#212121'}
                                labelStyle={styles.buttonLabel}
                                disabled={!selectedAdminForUser}
                              >
                                Approve
                              </Button>
                              <Button
                                mode="contained"
                                onPress={() => handleStatusUpdate(item._id, 'disapproved')}
                                style={styles.actionButton}
                                buttonColor={colors.error}
                                textColor="#FFF"
                                labelStyle={styles.buttonLabel}
                              >
                                Disapprove
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteUser(item._id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                            </>
                          ) : item.status === 'disapproved' ? (
                            <Button
                              mode="outlined"
                              onPress={() => handleDeleteUser(item._id)}
                              style={styles.actionButton}
                              textColor={isDarkMode ? '#FF5555' : colors.error}
                              labelStyle={styles.buttonLabel}
                            >
                              Delete
                            </Button>
                          ) : (
                            <>
                              <Button
                                mode="outlined"
                                onPress={() => fetchUserBarcodes(item._id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#00FF00' : colors.accent}
                                labelStyle={styles.buttonLabel}
                              >
                                View Barcodes
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteUser(item._id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                              <Button
                                mode="outlined"
                                onPress={() => handleResetPoints(item._id)}
                                style={styles.actionButton}
                                textColor={isDarkMode ? '#FFD700' : colors.accent}
                                labelStyle={styles.buttonLabel}
                              >
                                Reset Points
                              </Button>
                            </>
                          )}
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Barcodes of {item.name}</Text>
                        <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text }]}>Total: {userBarcodes.length}</Text>
                        <FlatList
                          data={userBarcodes}
                          keyExtractor={(barcode) => barcode._id}
                          renderItem={({ item: barcode }) => (
                            <View style={styles.barcodeItem}>
                              <Text style={[styles.cardText, { color: isDarkMode ? '#FFF' : colors.text, flex: 1 }]}>{barcode.value} - {new Date(barcode.createdAt).toLocaleString()} - Points: {barcode.pointsAwarded}</Text>
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteBarcode(barcode._id)}
                                style={[styles.actionButton, { minWidth: 80 }]}
                                textColor={isDarkMode ? '#FF5555' : colors.error}
                                labelStyle={styles.buttonLabel}
                              >
                                Delete
                              </Button>
                            </View>
                          )}
                          ListEmptyComponent={<Text style={[styles.emptyText, { color: isDarkMode ? '#FFF' : colors.text }]}>No barcodes found.</Text>}
                          initialNumToRender={10}
                          maxToRenderPerBatch={10}
                          windowSize={5}
                          getItemLayout={getItemLayout}
                        />
                        <Button
                          mode="contained"
                          onPress={() => setSelectedAdminId(null)}
                          style={styles.button}
                          buttonColor={colors.primary}
                          textColor={isDarkMode ? '#FFF' : '#212121'}
                          labelStyle={styles.buttonLabel}
                        >
                          Back
                        </Button>
                      </>
                    )}
                  </Card.Content>
                </Card>
              )}
              ListEmptyComponent={<Text style={[styles.emptyText, { color: isDarkMode ? '#FFF' : colors.text }]}>No users found.</Text>}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              getItemLayout={getItemLayout}
            />
          </>
        );
      case 'barcode':
        return (
          <>
            <Text style={[styles.subtitle, { color: isDarkMode ? '#FFF' : colors.text }]}>Barcode Generator</Text>
            <Card style={[styles.card, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
              <Card.Title title="Barcode Settings" titleStyle={[styles.cardTitle, { color: isDarkMode ? '#FFF' : colors.text }]} />
              <Card.Content>
                <TextInput
                  label="Prefix"
                  value={barcodeSettings.prefix}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, prefix: text.toUpperCase() })}
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />
                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>Barcode prefix (e.g., OPT)</Text>
                <TextInput
                  label="Start Number"
                  value={barcodeSettings.startNumber}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, startNumber: text })}
                  keyboardType="numeric"
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />
                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>Starting barcode number</Text>
                <TextInput
                  label="Count"
                  value={barcodeSettings.count}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, count: text })}
                  keyboardType="numeric"
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />
                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>Number of barcodes</Text>
                <TextInput
                  label="Digit Count"
                  value={barcodeSettings.digitCount}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, digitCount: text })}
                  keyboardType="numeric"
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />
                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>Number of digits for barcode number (e.g., 7 for OPT0000001)</Text>
                <TextInput
                  label="Company Name"
                  value={barcodeSettings.companyName}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, companyName: text.toUpperCase() })}
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />

                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>Company name above barcode</Text>
                
                <TextInput
                  label="Right Side Text"
                  value={barcodeSettings.rightText}
                  onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, rightText: text })}
                  style={styles.input}
                  theme={{ colors: { text: colors.text, primary: colors.primary } }}
                  mode="outlined"
                />
                <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666' }]}>
                  Text to show on right side of barcode (e.g., price or batch)
                </Text>
                <View style={{ marginTop: 16 }}>
                  <Text style={[styles.hintText, { color: isDarkMode ? '#AAA' : '#666', marginBottom: 4 }]}>PDF Mode</Text>
                  <Picker
                    selectedValue={barcodeSettings.mode}
                    onValueChange={(value) => setBarcodeSettings({ ...barcodeSettings, mode: value })}
                    style={{ color: isDarkMode ? '#FFF' : '#000' }}
                    dropdownIconColor={colors.primary}
                    mode="dropdown"
                  >
                    <Picker.Item label="With Outline" value="with-outline" />
                    <Picker.Item label="Without Outline" value="without-outline" />
                    <Picker.Item label="Only Outline" value="only-outline" />
                  </Picker>
                </View>


                <Button
                  mode="contained"
                  onPress={generateBarcodePDF}
                  style={styles.button}
                  buttonColor={colors.primary}
                  textColor="#FFF"
                  labelStyle={styles.buttonLabel}
                >
                  Generate PDF
                </Button>
              </Card.Content>
            </Card>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#212121' : colors.background }]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderContent()}
      </ScrollView>
      <View style={[styles.tabBar, { backgroundColor: isDarkMode ? '#333' : colors.surface }]}>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'home' && styles.activeTab]} onPress={() => setCurrentTab('home')}>
          <MaterialIcons name="home" size={24} color={currentTab === 'home' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'home' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'admins' && styles.activeTab]} onPress={() => setCurrentTab('admins')}>
          <MaterialIcons name="supervisor-account" size={24} color={currentTab === 'admins' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'admins' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Admins</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'users' && styles.activeTab]} onPress={() => setCurrentTab('users')}>
          <MaterialIcons name="people" size={24} color={currentTab === 'users' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'users' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Users</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, currentTab === 'barcode' && styles.activeTab]} onPress={() => setCurrentTab('barcode')}>
          <MaterialIcons name="qr-code" size={24} color={currentTab === 'barcode' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text)} />
          <Text style={[styles.tabText, { color: currentTab === 'barcode' ? (isDarkMode ? '#FFD700' : colors.primary) : (isDarkMode ? '#FFF' : colors.text) }]}>Barcode</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 80 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  subtitle: { fontSize: 24, fontWeight: 'bold' },
  toggle: { marginLeft: 10 },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  cardText: { fontSize: 16, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: 'bold' },
  searchBar: {
    marginBottom: 16,
    borderRadius: 25,
    paddingHorizontal: 10,
    borderWidth: 0,
  },
  pickerContainer: {
    width: '100%',
    borderRadius: 12,
    elevation: 4,
    marginBottom: 16,
    overflow: 'hidden',
  },
  picker: {
    height: 48,
    width: '100%',
  },
  button: {
    marginVertical: 8,
    borderRadius: 8,
    paddingVertical: 4,
  },
  actionButton: {
    marginHorizontal: 4,
    marginVertical: 4,
    borderRadius: 8,
    minWidth: 80,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
  emptyText: { fontSize: 16, textAlign: 'center', marginVertical: 20 },
  barcodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#FFD700' },
  tabText: { fontSize: 12, marginTop: 4 },
  input: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  hintText: {
    fontSize: 12,
    marginBottom: 12,
  },
});
