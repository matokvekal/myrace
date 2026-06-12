import React, { useMemo, useState } from "react";
import styles from "./addRace.module.css";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import { saveRace } from "@/utils/saveRace";
import useRaceStore from "@/stores/racesStore";
import { ArrowLeft } from "lucide-react";
// import Papa from "papaparse";

interface Props {
  setAddNewwRace: (value: boolean) => void;
}

const today = new Date().toISOString().split("T")[0];

const DEFAULT_IMAGES = [
  Images.bikeMountainSplash,
  Images.bikeSplash,
  Images.peloton1,
  Images.racebefore,
  Images.defaultRaceBike
];

const AddRace: React.FC<Props> = ({ setAddNewwRace }) => {
  const { races } = useRaceStore();
  const defaultCover = useMemo(
    () => DEFAULT_IMAGES[Math.floor(Math.random() * DEFAULT_IMAGES.length)],
    []
  );
  const [raceName, setRaceName] = useState(`Race ${races.length + 1}`);
  const [startDate, setStartDate] = useState(today);
  const [location, setLocation] = useState("TBD");
  const [status, setStatus] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ridersFile, setRidersFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBack = () => {
    setAddNewwRace(false);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setImageUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setRidersFile(file);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    try {
      await saveRace(
        event,
        raceName,
        startDate,
        location,
        status,
        imageUrl,
        ridersFile,
        setAddNewwRace
      );
    } catch (error) {
      console.error("Failed to save race:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.addRace}>
      <header className={styles.header}>
        <div className={styles.headerleft}>
          <Button
            variant="icon"
            size="md"
            iconOnly
            className={styles.backButton}
            onClick={handleBack}
            aria-label="Go back"
            type="button"
          >
            <ArrowLeft size={18} />
          </Button>
        </div>
        <div className={styles.headercenter}>Add Race</div>
        <div className={styles.headerright}></div>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.imageUpload}>
          <label htmlFor="coverUpload">
            <img
              src={imageUrl ?? defaultCover}
              alt="Cover"
              className={styles.coverImage}
            />
            <div className={styles.coverOverlay}>Change Cover</div>
          </label>
          <input
            id="coverUpload"
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: "none" }}
          />
        </div>

        <div className={styles.lowerPart}>
          <input
            type="text"
            placeholder="Race Name"
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            className={styles.input}
          />

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={styles.input}
          />

          <input
            type="text"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={styles.input}
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={styles.input}
          >
            <option value="">Select Status</option>
            <option value="Scheduled">Scheduled</option>
            <option value="running">Ongoing</option>
            <option value="finished">Completed</option>
          </select>

          <div className={styles.fileUpload}>
            <label htmlFor="ridersFileUpload" className={styles.fileLabel}>
              Upload Riders File
            </label>
            <input
              id="ridersFileUpload"
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            {ridersFile && <p>{ridersFile.name}</p>}
          </div>

          <Button
            type="submit"
            variant="success"
            size="md"
            className={styles.submitButton}
          >
            {loading ? "Saving..." : "Done"}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AddRace;
