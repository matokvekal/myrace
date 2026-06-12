
// utils/mapServerUtil.ts
export async function fetchStaticMapUrl(center: { lat: number; lng: number }, addresses: string[]): Promise<string> {
   const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
   if (!API_KEY) {
      console.warn("Google Maps API key is not configured. Map features will be unavailable.");
      return ""; // Return empty string instead of throwing error
   }
   const markers = addresses.map(address => `markers=${encodeURIComponent(address)}`).join('&');
   const centerParam = `center=${center.lat},${center.lng}`;
   const size = 'size=600x400';
   const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?${centerParam}&${markers}&${size}&key=${API_KEY}`;
   return mapUrl;
}
