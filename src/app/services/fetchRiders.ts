import { API_ENDPOINT } from '../config/index';
import Cookies from 'js-cookie';
// import { riders } from "../api/mockData";
import { RiderProps } from "@/types/types";

export const fetchRiders = async (raceUuid: string): Promise<RiderProps[]> => {
  try {
    const riders:RiderProps[] = [];
    console.log(`Fetching riders for raceUuid: ${raceUuid}`);
    // Simulate a delay for fetching data
    return new Promise((resolve) => {
      setTimeout(() => {
        const filteredRiders = riders?.filter((rider) => rider.raceUuid === raceUuid);
        resolve(filteredRiders as RiderProps[]);
      }, 500); // Simulate a 500ms delay
    });
  } catch (error) {
    console.error("Error fetching riders:", error);
    return [];
  }
};


