// src/app/services/google-maps-key.ts

export const fetchGoogleMapsApiKey = async (): Promise<string> => {
   const response = await fetch('/api/google-maps-key');
   if (!response.ok) {
     throw new Error('Failed to fetch the Google Maps API key');
   }
   const data = await response.json();
   return data.key;
 };
 