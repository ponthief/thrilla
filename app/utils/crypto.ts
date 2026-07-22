import CryptoJS from 'crypto-js';

export function encryptData(data: string, password: string): string {
  return CryptoJS.AES.encrypt(data, password).toString();
}

export function decryptData(encryptedData: string, password: string): string {
  const decrypted = CryptoJS.AES.decrypt(encryptedData, password);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

export function hashData(data: string): string {
  return CryptoJS.SHA256(data).toString();
}

export function generateRandomBytes(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}