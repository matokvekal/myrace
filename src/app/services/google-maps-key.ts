// src/app/services/google-maps-key.ts

export const fetchGoogleMapsApiKey = async (): Promise<string> => {
  try {
    const response = await fetch('/api/google-maps-key');
    if (!response.ok) {
      console.warn('Failed to fetch the Google Maps API key from server');
      return '';
    }
    const data = await response.json();
    return data.key || '';
  } catch (error) {
    console.warn('Google Maps API is not configured:', error);
    return '';
  }
};
