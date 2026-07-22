import axios from 'axios';
import Config from 'react-native-config';
import * as Keychain from 'react-native-keychain';
import { useAuthStore } from '@stores/authStore';

const getLnbitsUrl = () => {
  return Config.LNBITS_URL || '';
};

const getSilntPrefix = () => {
  return Config.SILNT_PREFIX || '/siLNt';
};

const apiClient = axios.create({
  timeout: 10000,
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  try {
    const credentials = await Keychain.getGenericPassword();
    if (credentials && credentials.password) {
      config.headers.Authorization = `Bearer ${credentials.password}`;
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
    await Keychain.setGenericPassword('lnbits_token', token);
    useAuthStore.setState({ token });
  } catch (error) {
    console.error('Failed to save token', error);
    throw error;
  }
}

export async function loadToken() {
  try {
    const credentials = await Keychain.getGenericPassword();
    if (credentials && credentials.password) {
      useAuthStore.setState({ token: credentials.password });
      return credentials.password;
    }
    return null;
  } catch (error) {
    console.error('Failed to load token', error);
    return null;
  }
}

export async function clearToken() {
  try {
    await Keychain.resetGenericPassword();
    useAuthStore.setState({ token: null });
  } catch (error) {
    console.error('Failed to clear token', error);
  }
}
