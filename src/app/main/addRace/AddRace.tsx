"use client";

import React, { useState } from "react";
import styles from "./addRace.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import { useRouter } from "next/navigation";
import { saveRace } from "@/utils/saveRace";
// import Papa from "papaparse";

interface Props {
  setAddNewwRace: (value: boolean) => void;
}

const AddRace: React.FC<Props> = ({ setAddNewwRace }) => {
  const router = useRouter();
  const [raceName, setRaceName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [ridersFile, setRidersFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBack = () => {
    setAddNewwRace(false);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImage(file);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setRidersFile(file);
    }
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
        ridersFile, // Ensure correct file reference
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
          <Image
            src={Icons.arrowback}
            alt="back"
            width={34}
            height={34}
            onClick={handleBack}
          />
        </div>
        <div className={styles.headercenter}>Add Race</div>
        <div className={styles.headerright}></div>
      </header>
      
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.imageUpload}>
          <label htmlFor="coverUpload">
            {image ? (
              <Image src={URL.createObjectURL(image)} alt="Cover" width={200} height={100} />
            ) : (
              <div className={styles.imagePlaceholder}>Edit Cover</div>
            )}
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

          <button type="submit" className={styles.submitButton}>
            {loading ? "Saving..." : "Done"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddRace;
