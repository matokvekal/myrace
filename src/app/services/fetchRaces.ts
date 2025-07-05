import { API_ENDPOINT } from '../config/index';
import Cookies from 'js-cookie';
// import { getCookie } from "@/utils/storageUtils";
import { RaceProps } from '@/types/types';
// import  raceData  from '../api/mockData';


export const fetchRaces = async (): Promise<RaceProps[]> => {
  try {
    console.log('fetch Race Simulated Data');
    // Simulate a delay for fetching data, if needed
    return new Promise((resolve) => {
      setTimeout(() => resolve([] as RaceProps[]), 0); // Simulate a 500ms fetch delay
    });
  } catch (error) {
    console.error('Error fetching races:', error);
    return [];
  }
};
