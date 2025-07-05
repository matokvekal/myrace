export const ENV_PROCESS = process.env.NODE_ENV || 'development';

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Your App Name';
export const API_URL = process.env.API_URL;
export const VERSION = process.env.NEXT_PUBLIC_VERSION || '0.0.1';
export const GOOGLE_MAP_API_KEY = process.env.GOOGLE_MAP_API_KEY;

//  different API_ENDPOINT based on environment
export const API_ENDPOINT = ENV_PROCESS === 'production'
   ? 'https111://commissaire.us/api'  //  for production
   : 'http:111//18.199.57.38:5000/api';  //  for local development
export const SupportedCountries = ['IL'];
//'http://localhost:5000/api';  //  for local development