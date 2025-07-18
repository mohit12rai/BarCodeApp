import React, { useState, useContext } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Platform } from 'react-native';
import { Button, Card, TextInput, useTheme } from 'react-native-paper';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Toast from 'react-native-toast-message';
import jsPDF from 'jspdf';
import bwipjs from 'bwip-js';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../AuthContext';

const isWeb = Platform.OS === 'web';

export default function BarcodeGenerator({ navigation }) {
  const { colors } = useTheme();
  const { user } = useContext(AuthContext);

  // Redirect to Login if not authenticated or not authorized
  if (!user || !['user', 'admin', 'superadmin'].includes(user.role)) {
    console.log('Unauthorized access to BarcodeGenerator:', user ? user.role : 'No user');
    navigation.replace('Login');
    return null;
  }

  const [barcodeSettings, setBarcodeSettings] = useState({
    prefix: 'OPT',
    startNumber: '1',
    count: '50',
    companyName: '',
    digitCount: '7',
  });

  const generateBarcodePDF = async () => {
    try {
      const { prefix, startNumber, count, companyName, digitCount } = barcodeSettings;

      // Validate inputs, including digitCount
      if (
        !prefix ||
        !startNumber ||
        !count ||
        !digitCount ||
        isNaN(startNumber) ||
        isNaN(count) ||
        isNaN(digitCount) ||
        parseInt(count) <= 0 ||
        parseInt(digitCount) <= 0
      ) {
        Toast.show({ type: 'error', text1: 'Invalid Inputs' });
        return;
      }

      // Ensure digitCount is sufficient for count
      const maxNumber = parseInt(startNumber) + parseInt(count) - 1;
      const minDigits = Math.ceil(Math.log10(maxNumber + 1));
      if (parseInt(digitCount) < minDigits) {
        Toast.show({ type: 'error', text1: `Digit count must be at least ${minDigits} for ${count} barcodes` });
        return;
      }

      const doc = new jsPDF({ format: 'A4', unit: 'mm' });
      const pageWidth = doc.internal.pageSize.getWidth(); // 210 mm
      const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm

      // Layout settings
      const cols = 4;
      const rows = 20;
      const barcodeWidth = 38; // mm
      const barcodeHeight = 6; // mm
      const companyFontSize = 8; // mm
      const barcodeFontSize = 8; // mm
      const marginX = 10; // mm
      const marginY = 5; // mm
      const gapX = 10; // mm
      const gapY = -8; // mm
      const boxHeight = barcodeHeight + companyFontSize + barcodeFontSize + 0.3;

      // Verify layout fits A4
      const totalWidth = cols * barcodeWidth + (cols - 1) * gapX + 2 * marginX;
      const totalHeight = rows * boxHeight + (rows - 1) * gapY + 2 * marginY;
      console.log(`Total width: ${totalWidth} mm, Total height: ${totalHeight} mm`);

      let x = marginX;
      let y = marginY;
      let barcodeCount = 0;

      for (let i = 0; i < parseInt(count); i++) {
        const barcodeValue = `${prefix}${(parseInt(startNumber) + i).toString().padStart(parseInt(digitCount), '0')}`;

        // Generate barcode data using bwip-js
        const canvas = document.createElement('canvas');
        await bwipjs.toCanvas(canvas, {
          bcid: 'code128',
          text: barcodeValue,
          scale: 1.5,
          height: barcodeHeight / 2,
          width: barcodeWidth / 2,
          includetext: false,
        });

        // Convert canvas to image data
        const imgData = canvas.toDataURL('image/png');

        // Draw company name above
        if (companyName) {
          doc.setFontSize(companyFontSize);
          doc.setFont('Arial', 'bold');
          const textWidth = doc.getTextWidth(companyName);
          const textX = x + (barcodeWidth - textWidth) / 2;
          doc.text(companyName, textX, y + companyFontSize);
        }

        // Draw barcode
        const companyToBarcodeGap = 0.8;
        const barcodeToNumberGap = 2.5;
        doc.addImage(imgData, 'PNG', x, y + companyFontSize + companyToBarcodeGap, barcodeWidth, barcodeHeight);

        // Draw barcode number below
        doc.setFontSize(barcodeFontSize);
        doc.setFont('Arial', 'normal');
        const textWidth = doc.getTextWidth(barcodeValue);
        const textX = x + (barcodeWidth - textWidth) / 2;
        doc.text(barcodeValue, textX, y + companyFontSize + companyToBarcodeGap + barcodeHeight + barcodeToNumberGap);

        barcodeCount++;
        console.log(`Rendered barcode ${barcodeCount}: x=${x}, y=${y}, value=${barcodeValue}`);

        // Move to next position
        x += barcodeWidth + gapX;
        if ((i + 1) % cols === 0) {
          x = marginX;
          y += boxHeight + gapY;
        }

        // New page if 80 barcodes are filled
        if ((i + 1) % (cols * rows) === 0 && i + 1 < parseInt(count)) {
          console.log(`Adding page after ${barcodeCount} barcodes`);
          doc.addPage();
          x = marginX;
          y = marginY;
          barcodeCount = 0;
        }
      }

      const pdfOutput = doc.output('blob');
      const batchName = 'barcodes.pdf';
      if (isWeb) {
        const url = window.URL.createObjectURL(pdfOutput);
        const link = document.createElement('a');
        link.href = url;
        link.download = batchName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        const fileUri = `${FileSystem.documentDirectory}${batchName}`;
        const base64 = Buffer.from(pdfOutput).toString('base64');
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf' });
      }
      Toast.show({ type: 'success', text1: 'PDF Generated' });
    } catch (error) {
      console.error('Barcode generation error:', error);
      Toast.show({ type: 'error', text1: 'PDF Generation Failed', text2: error.message });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Barcode Generator</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={[styles.card, { backgroundColor: colors.surface }]}>
          <Card.Title title="Barcode Settings" titleStyle={[styles.cardTitle, { color: colors.text }]} />
          <Card.Content>
            <TextInput
              label="Prefix"
              value={barcodeSettings.prefix}
              onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, prefix: text.toUpperCase() })}
              style={styles.input}
              theme={{ colors: { text: colors.text, primary: colors.primary } }}
              mode="outlined"
            />
            <Text style={[styles.hintText, { color: '#666' }]}>Barcode prefix (e.g., OPT)</Text>
            <TextInput
              label="Start Number"
              value={barcodeSettings.startNumber}
              onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, startNumber: text })}
              keyboardType="numeric"
              style={styles.input}
              theme={{ colors: { text: colors.text, primary: colors.primary } }}
              mode="outlined"
            />
            <Text style={[styles.hintText, { color: '#666' }]}>Starting barcode number</Text>
            <TextInput
              label="Count"
              value={barcodeSettings.count}
              onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, count: text })}
              keyboardType="numeric"
              style={styles.input}
              theme={{ colors: { text: colors.text, primary: colors.primary } }}
              mode="outlined"
            />
            <Text style={[styles.hintText, { color: '#666' }]}>Number of barcodes</Text>
            <TextInput
              label="Digit Count"
              value={barcodeSettings.digitCount}
              onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, digitCount: text })}
              keyboardType="numeric"
              style={styles.input}
              theme={{ colors: { text: colors.text, primary: colors.primary } }}
              mode="outlined"
            />
            <Text style={[styles.hintText, { color: '#666' }]}>Number of digits for barcode number (e.g., 7 for OPT0000001)</Text>
            <TextInput
              label="Company Name"
              value={barcodeSettings.companyName}
              onChangeText={(text) => setBarcodeSettings({ ...barcodeSettings, companyName: text.toUpperCase() })}
              style={styles.input}
              theme={{ colors: { text: colors.text, primary: colors.primary } }}
              mode="outlined"
            />
            <Text style={[styles.hintText, { color: '#666' }]}>Company name above barcode</Text>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  title: { fontSize: 20, fontWeight: 'bold' },
  scrollContent: { padding: 16, paddingBottom: 80 },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold' },
  input: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  hintText: {
    fontSize: 12,
    marginBottom: 12,
  },
  button: {
    marginVertical: 8,
    borderRadius: 8,
    paddingVertical: 4,
  },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
});