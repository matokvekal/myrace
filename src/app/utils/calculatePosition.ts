import { RiderProps } from "@/types/types";

const parseTime = (time: string | null): Date | null => (time ? new Date(time) : null);

const calculatePositions = (riders: RiderProps[]): RiderProps[] => {
   // Filter out DNF and DNS riders
   const activeRiders = riders.filter(
      (rider) => rider.status !== "DNF" && rider.status !== "DNS" && rider.status !== "DSQ"
   );

   // Group riders by category
   const categories = activeRiders.reduce((acc, rider) => {
      acc[rider.category] = acc[rider.category] || [];
      acc[rider.category].push(rider);
      return acc;
   }, {} as Record<string, RiderProps[]>);

   // Process each category separately
   Object.values(categories).forEach((ridersInCategory) => {
      // Sort by laps completed (descending) and arrival time (ascending)
      ridersInCategory.sort((a, b) => {
         if (b.lapsCounter !== a.lapsCounter) {
            return b.lapsCounter - a.lapsCounter; // Higher lap count comes first
         }

         const timeA = parseTime(a.timeArrive);
         const timeB = parseTime(b.timeArrive);
         return (timeA?.getTime() || 0) - (timeB?.getTime() || 0); // Earlier time comes first
      });

      // Assign position within the category
      ridersInCategory.forEach((rider, index) => {
         rider.position_category = index + 1;
      });
   });

   // Combine all riders, re-sort by overall race position
   const sortedRiders = activeRiders.sort((a, b) => {
      const lapsDifference = b.lapsCounter - a.lapsCounter;
      if (lapsDifference !== 0) return lapsDifference;

      const timeA = parseTime(a.timeArrive);
      const timeB = parseTime(b.timeArrive);
      return (timeA?.getTime() || 0) - (timeB?.getTime() || 0);
   });

   // Assign overall race positions
   sortedRiders.forEach((rider, index) => {
      rider.position_race = index + 1;
   });

   return sortedRiders;
};

export default calculatePositions;