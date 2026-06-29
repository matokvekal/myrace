import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import styles from './raceMap.module.css';

interface RaceMapProps {
  latitude?: number;
  longitude?: number;
  location?: string;
  title?: string;
}

// Default location: Nes Hareem, Israel
const DEFAULT_LAT = 31.9325;
const DEFAULT_LNG = 35.1825;
const DEFAULT_LOCATION = 'Nes Hareem, Israel';

const RaceMap: React.FC<RaceMapProps> = ({
  latitude = DEFAULT_LAT,
  longitude = DEFAULT_LNG,
  location = DEFAULT_LOCATION,
  title = 'Race Location'
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize map
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([latitude, longitude], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    // Update view and marker
    if (mapRef.current) {
      mapRef.current.setView([latitude, longitude], 13);

      // Remove existing markers
      mapRef.current.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker) {
          mapRef.current?.removeLayer(layer);
        }
      });

      // Add new marker
      L.marker([latitude, longitude])
        .bindPopup(location)
        .addTo(mapRef.current)
        .openPopup();
    }
  }, [latitude, longitude, location]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4>{title}</h4>
        <p className={styles.location}>{location}</p>
      </div>
      <div className={styles.mapContainer} ref={mapContainerRef} />
    </div>
  );
};

export default RaceMap;
