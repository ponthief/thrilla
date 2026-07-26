import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@stores/authStore';

const getLnbitsUrl = () => {
  return process.env.EXPO_PUBLIC_LNBITS_URL || '';
};

const getSilntPrefix = () => {
  return process.env.EXPO_PUBLIC_SILNT_PREFIX || '/siLNt';
};

const apiClient = axios.create({
  timeout: 10000,
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('lnbits_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Failed to retrieve auth token', error);
  }
  return config;
});

export async function getWallets() {
  try {
    const url = `${getLnbitsUrl()}/api/v1/wallets`;
    const response = await apiClient.get(url);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch wallets', error);
    throw error;
  }
}

export async function getBalance(walletId: string) {
  try {
    const url = `${getLnbitsUrl()}/api/v1/wallet/${walletId}`;
    const response = await apiClient.get(url);
    return response.data.balance;
  } catch (error) {
    console.error('Failed to fetch balance', error);
    throw error;
  }
}

export async function createInvoice(
  walletId: string,
  amount: number,
  memo: string
) {
  try {
    const url = `${getLnbitsUrl()}${getSilntPrefix()}/api/v1/invoices`;
    const response = await apiClient.post(url, {
      out: false,
      amount,
      memo,
      wallet_id: walletId,
    });
    return response.data;
  } catch (error) {
    console.error('Failed to create invoice', error);
    throw error;
  }
}

export async function payInvoice(invoice: string, walletId: string) {
  try {
    const url = `${getLnbitsUrl()}${getSilntPrefix()}/api/v1/payments`;
    const response = await apiClient.post(url, {
      bolt11: invoice,
      wallet_id: walletId,
    });
    return response.data;
  } catch (error) {
    console.error('Failed to pay invoice', error);
    throw error;
  }
}

export async function saveToken(token: string) {
  try {
    await SecureStore.setItemAsync('lnbits_token', token);
    useAuthStore.setState({ token });
  } catch (error) {
    console.error('Failed to save token', error);
    throw error;
  }
}

export async function loadToken() {
  try {
    const token = await SecureStore.getItemAsync('lnbits_token');
    if (token) {
      useAuthStore.setState({ token });
    }
    return token;
  } catch (error) {
    console.error('Failed to load token', error);
    return null;
  }
}

export async function clearToken() {
  try {
    await SecureStore.deleteItemAsync('lnbits_token');
    useAuthStore.setState({ token: null });
  } catch (error) {
    console.error('Failed to clear token', error);
  }
}