// commissaire/pages/api/geocode.ts
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const address = req.query.address as string;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(400).json({ error: 'Geocoding failed', details: data });
    }

    res.status(200).json(data);
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error', details: 'Unknown error' });
    }
  }
}
