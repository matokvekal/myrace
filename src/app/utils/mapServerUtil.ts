
// utils/mapServerUtil.ts
export async function fetchStaticMapUrl(center: { lat: number; lng: number }, addresses: string[]): Promise<string> {
   const API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
   if (!API_KEY) {
      throw new Error("Google Maps API key is not defined");
   }
   const markers = addresses.map(address => `markers=${encodeURIComponent(address)}`).join('&');
   const centerParam = `center=${center.lat},${center.lng}`;
   const size = 'size=600x400';
   const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?${centerParam}&${markers}&${size}&key=${API_KEY}`;
   return mapUrl;
}
