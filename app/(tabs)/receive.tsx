import { StyleSheet, Text, View, Button } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as BarCodeScanner from 'expo-barcode-scanner';
import { useState, useEffect } from 'react';

export default function ReceiveScreen() {
  const [scanned, setScanned] = useState(false);

  const handleBarCodeScanned = ({ type, data }) => {
    setScanned(true);
    console.log(`Bar code with type ${type} and data ${data} has been scanned!`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Receive Bitcoin</Text>
          <View style={styles.qrPlaceholder}>
            <Text style={styles.placeholderText}>QR Code will appear here</Text>
          </View>
          <Text style={styles.address}>Your receiving address</Text>
          <Button title="Copy Address" onPress={() => {}} color="#007AFF" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  qrPlaceholder: {
    width: 250,
    height: 250,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#ddd',
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
  },
  address: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
});