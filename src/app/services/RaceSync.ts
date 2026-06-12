import { RaceProps, CategoryProps, RiderProps } from "@/types/types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const MOCK_MODE = true; // Set to false when backend is ready

interface RacePackage {
   race: RaceProps;
   categories: CategoryProps[];
   riders: RiderProps[];
   version: number;
   syncedAt: Date;
}

interface SearchResult {
   raceId: string;
   name: string;
   date: string;
   location: string;
   organizer: string;
   ridersCount: number;
   isPrivate: boolean;
}

/**
 * Generate a formatted race ID from date and name
 * Format: YYYY-MM-DD-normalized-name
 */
export function generateRaceId(date: string, name: string): string {
   // Normalize name: lowercase, replace spaces with hyphens, remove special chars
   const normalized = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .substring(0, 50); // Limit length

   return `${date}-${normalized}`;
}

/**
 * Upload/Sync race to server
 */
export async function uploadRace(
   race: RaceProps,
   categories: CategoryProps[],
   riders: RiderProps[],
   isPrivate: boolean = false,
   password?: string
): Promise<{ success: boolean; raceId: string; error?: string }> {
   try {
      // Generate race ID if not exists
      const raceId = race.raceId || generateRaceId(race.date, race.name);

      const racePackage: RacePackage = {
         race: {
            ...race,
            raceId,
            isPrivate,
            password: isPrivate ? password : undefined,
            syncedAt: new Date(),
            serverVersion: (race.serverVersion || 0) + 1,
         },
         categories,
         riders,
         version: (race.serverVersion || 0) + 1,
         syncedAt: new Date(),
      };

      if (MOCK_MODE) {
         // Mock implementation using localStorage
         const stored = localStorage.getItem("syncedRaces") || "{}";
         const syncedRaces = JSON.parse(stored);
         syncedRaces[raceId] = racePackage;
         localStorage.setItem("syncedRaces", JSON.stringify(syncedRaces));

         return { success: true, raceId };
      } else {
         // Real API call
         const response = await fetch(`${API_BASE_URL}/races/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(racePackage),
         });

         if (!response.ok) {
            throw new Error("Upload failed");
         }

         const data = await response.json();
         return { success: true, raceId: data.raceId };
      }
   } catch (error) {
      console.error("Upload error:", error);
      return { success: false, raceId: "", error: String(error) };
   }
}

/**
 * Download race by ID (with password for private races)
 */
export async function downloadRace(
   raceId: string,
   password?: string
): Promise<{ success: boolean; data?: RacePackage; error?: string }> {
   try {
      if (MOCK_MODE) {
         // Mock implementation
         const stored = localStorage.getItem("syncedRaces") || "{}";
         const syncedRaces = JSON.parse(stored);
         const racePackage = syncedRaces[raceId];

         if (!racePackage) {
            return { success: false, error: "Race not found" };
         }

         // Check password for private races
         if (racePackage.race.isPrivate) {
            if (!password || password !== racePackage.race.password) {
               return { success: false, error: "Invalid password" };
            }
         }

         return { success: true, data: racePackage };
      } else {
         // Real API call
         const response = await fetch(`${API_BASE_URL}/races/${raceId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
         });

         if (response.status === 401) {
            return { success: false, error: "Invalid password" };
         }

         if (response.status === 404) {
            return { success: false, error: "Race not found" };
         }

         if (!response.ok) {
            throw new Error("Download failed");
         }

         const data = await response.json();
         return { success: true, data };
      }
   } catch (error) {
      console.error("Download error:", error);
      return { success: false, error: String(error) };
   }
}

/**
 * Search for public races
 */
export async function searchPublicRaces(
   query: string = "",
   filters?: {
      dateFrom?: string;
      dateTo?: string;
      location?: string;
   }
): Promise<{ success: boolean; results?: SearchResult[]; error?: string }> {
   try {
      if (MOCK_MODE) {
         // Mock implementation
         const stored = localStorage.getItem("syncedRaces") || "{}";
         const syncedRaces = JSON.parse(stored);

         const results: SearchResult[] = Object.entries(syncedRaces)
            .filter(([_, pkg]: [string, any]) => !pkg.race.isPrivate)
            .map(([raceId, pkg]: [string, any]) => ({
               raceId,
               name: pkg.race.name,
               date: pkg.race.date,
               location: pkg.race.location,
               organizer: pkg.race.orgenizer,
               ridersCount: pkg.riders.length,
               isPrivate: false,
            }))
            .filter((result) => {
               if (query) {
                  const q = query.toLowerCase();
                  return (
                     result.name.toLowerCase().includes(q) ||
                     result.location.toLowerCase().includes(q) ||
                     result.raceId.toLowerCase().includes(q)
                  );
               }
               return true;
            });

         return { success: true, results };
      } else {
         // Real API call
         const params = new URLSearchParams({
            q: query,
            ...filters,
         });

         const response = await fetch(`${API_BASE_URL}/races/search?${params}`);

         if (!response.ok) {
            throw new Error("Search failed");
         }

         const data = await response.json();
         return { success: true, results: data.results };
      }
   } catch (error) {
      console.error("Search error:", error);
      return { success: false, error: String(error) };
   }
}

/**
 * Check if race ID exists
 */
export async function checkRaceExists(raceId: string): Promise<boolean> {
   if (MOCK_MODE) {
      const stored = localStorage.getItem("syncedRaces") || "{}";
      const syncedRaces = JSON.parse(stored);
      return !!syncedRaces[raceId];
   } else {
      try {
         const response = await fetch(`${API_BASE_URL}/races/${raceId}/exists`);
         const data = await response.json();
         return data.exists;
      } catch {
         return false;
      }
   }
}

/**
 * Delete race from server (only owner can delete)
 */
export async function deleteRaceFromServer(
   raceId: string,
   ownerToken: string
): Promise<{ success: boolean; error?: string }> {
   try {
      if (MOCK_MODE) {
         const stored = localStorage.getItem("syncedRaces") || "{}";
         const syncedRaces = JSON.parse(stored);
         delete syncedRaces[raceId];
         localStorage.setItem("syncedRaces", JSON.stringify(syncedRaces));
         return { success: true };
      } else {
         const response = await fetch(`${API_BASE_URL}/races/${raceId}`, {
            method: "DELETE",
            headers: {
               "Content-Type": "application/json",
               Authorization: `Bearer ${ownerToken}`,
            },
         });

         if (!response.ok) {
            throw new Error("Delete failed");
         }

         return { success: true };
      }
   } catch (error) {
      console.error("Delete error:", error);
      return { success: false, error: String(error) };
   }
}
