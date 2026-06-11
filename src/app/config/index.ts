export const ENV_PROCESS = import.meta.env.MODE || 'development';

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Your App Name';
export const API_URL = import.meta.env.VITE_API_URL;
export const VERSION = import.meta.env.VITE_VERSION || '0.0.1';
export const GOOGLE_MAP_API_KEY = import.meta.env.VITE_GOOGLE_MAP_API_KEY;

export const API_ENDPOINT = ENV_PROCESS === 'production'
   ? 'https111://commissaire.us/api'
   : 'http:111//18.199.57.38:5000/api';
export const SupportedCountries = ['IL'];
