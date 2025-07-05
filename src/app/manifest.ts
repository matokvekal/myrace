import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Commissaire race app',
    short_name: 'Commissaire',
    description: 'manage bike race application ',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#caf3f9',
    icons: [
      {
        src: '/logo.png', // Your logo for the icon
        sizes: '192x192',  // Adjust size as needed
        type: 'image/png',
      },
      {
        src: '/logo.png', // Larger icon
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
