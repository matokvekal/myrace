import React, { useState, useEffect, useMemo } from "react";
import styles from "./addRider.module.css";
import useRiderStore from "@/stores/ridersStore";
import Icons from "@/constants/Icons";
import useUIStore from "@/stores/uiStore";
import useCategoryStore from "@/stores/categoryStore";
import { useDropzone } from "react-dropzone";
import * as z from "zod";
import { RiderProps } from "@/types/types";
import CategoryModal from "../../components/modals/CategoryModal";

interface AddRiderModalProps {
  raceUuid: string;
  heatId: number;
}
const riderSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  bibNumber: z
    .number()
    .min(1)
    .max(9999, "Bib number must be between 1 and 9999"),
  category: z.string().min(1, "Category is required")
});
const AddRider: React.FC<AddRiderModalProps> = ({ raceUuid, heatId }) => {
  const insertRider = useRiderStore.getState().addNewRider;
  const [bibNumber, setBibNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [category, setCategory] = useState("");
  const { riders, getRiders } = useRiderStore();
  const [team, setTeam] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const { modals, openModal, closeModal, closeAllModals } = useUIStore();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { categories, getCategories, updateCategory } = useCategoryStore();
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    if (!raceUuid) return;
    const fetchAllData = async () => {
      await getCategories(raceUuid);
      await getRiders(raceUuid);
    };

    fetchAllData();
  }, [raceUuid]);

  const heatCategories = useMemo(() => {
    return categories
      .filter((cat) => Number(cat.heat) === heatId)
      .map((cat) => cat.name);
  }, [categories, heatId]);

  useEffect(() => {
    const uniqueTeams: string[] = Array.from(
      new Set(
        riders
          .map((rider) => rider.team)
          .filter((team): team is string => !!team)
      )
    );
    setTeams(uniqueTeams);
  }, [riders]);

  const handleSubmit = () => {
    const parsedData = riderSchema.safeParse({
      firstName,
      lastName,
      bibNumber: parseInt(bibNumber),
      category
    });

    if (!parsedData.success) {
      const fieldErrors: Record<string, string> = {};
      parsedData.error.errors.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const categoryRiders = riders
      .filter(
        (rider) =>
          rider.category === category &&
          rider.raceUuid === raceUuid &&
          rider.heat === heatId
      )
      .sort((a, b) => (a.position_start || 0) - (b.position_start || 0)); // Ascending order

    const maxStandingRider =
      categoryRiders.length > 0
        ? categoryRiders[categoryRiders.length - 1]
        : null;

    // The category owns the lap count — copying it off a sibling rider means a
    // rider added before laps were set (or whose siblings came from a file with
    // no laps column) is stuck on 0/0 (BUGS.md #7).
    const riderCategory = categories.find(
      (cat) => cat.name === category && cat.heat === heatId
    );

    const newRider: RiderProps = {
      id: Date.now() + Math.random(), // Ensure uniqueness
      raceUuid,
      heat: heatId,
      bibNumber: parseInt(bibNumber),
      firstName,
      lastName,
      category,
      team: team || null,
      image, // Store image URL
      lapsCounter: 0,
      totalLaps: riderCategory?.laps || maxStandingRider?.totalLaps || 0,
      lapsDetails: [],
      checked: false,
      distance: 0,
      elapsedTimeFromStart: "0",
      elapsedLastLap: "0", // ✅ Fix: Provide default value
      timeStartRace: null,
      timeArrive: null,
      flag: null,
      position_start: maxStandingRider?.position_start
        ? maxStandingRider.position_start + 1
        : 1,
      position_category: 0,
      position_race: 0,
      raceStatus: "upcoming",
      status: "standing" as RiderProps["status"],
      viewOrder: 0,
      comment: "add new rider at standing",
      color: maxStandingRider?.color || "#000000"
    };
    insertRider(newRider);

    if (riderCategory) {
      const totalRiders = categoryRiders.length + 1;
      updateCategory({ ...riderCategory, riders: totalRiders });
    }

    closeModal("modalAddRider");
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: { "image/*": [] }, // ✅ Fix for 'accept' prop
    onDrop: (acceptedFiles) => {
      setImage(URL.createObjectURL(acceptedFiles[0]));
    }
  });

  const selectCategory = (selectedCategory: string) => {
    setCategory(selectedCategory);
    closeModal("showModalCategory");
  };
  const selectTeam = (selectedTeam: string) => {
    setTeam(selectedTeam);
    closeModal("showModalTeam");
  };
  const openSelectModal = (modalName: any) => {
    closeModal("showModalCategory");
    closeModal("showModalTeam");
    openModal(modalName);
  };

  return (
    <div className={styles.wrapper} onClick={() => closeAllModals()}>
      <div className={styles.main} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.headercenter}>Add Rider</div>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.cameraWrapper}>
            <div {...getRootProps()} className={styles.camera}>
              <input {...getInputProps()} />
              {image ? (
                <img src={image} alt="Uploaded" width={50} height={50} />
              ) : (
                <>
                  <img src={Icons.photo} alt="photo" className={styles.photo} />
                  <img
                    src={Icons.photoInner}
                    alt="photoInner"
                    width={20}
                    height={20}
                    className={styles.photoInner}
                  />
                </>
              )}
            </div>
          </div>

          <div className={styles.inputContainer}>
            <input
              className={styles.input}
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder=" "
              required
            />
            <label className={styles.label}>First Name</label>
            {errors.firstName && (
              <p className={styles.error}>{errors.firstName}</p>
            )}
          </div>

          <div className={styles.inputContainer}>
            <input
              className={styles.input}
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder=" "
              required
            />
            <label className={styles.label}>Last Name</label>
            {errors.lastName && (
              <p className={styles.error}>{errors.lastName}</p>
            )}
          </div>

          <div className={styles.inputContainer}>
            <input
              className={styles.input}
              type="number"
              value={bibNumber}
              onChange={(e) => setBibNumber(e.target.value)}
              placeholder=" "
              required
            />
            <label className={styles.label}>Bib Number</label>
            {errors.bibNumber && (
              <p className={styles.error}>{errors.bibNumber}</p>
            )}
          </div>

          <div className={styles.inputContainer}>
            <input
              className={styles.input}
              type="text"
              value={category}
              placeholder=""
              readOnly
              onClick={() => openSelectModal("showModalCategory")}
            />
            <label className={styles.label}>Category</label>
            {errors.category && (
              <p className={styles.error}>{errors.category}</p>
            )}
          </div>
          <div className={styles.inputContainer}>
            <input
              className={styles.input}
              type="text"
              value={team}
              placeholder=" "
              readOnly
              onClick={() => openSelectModal("showModalTeam")}
            />
            <label className={styles.label}>Team</label>
          </div>

          <button type="submit" className={styles.submit}>
            Done
          </button>
        </form>

        {modals.showModalCategory && (
          <>
            <CategoryModal
              categories={heatCategories}
              selectCategory={selectCategory}
            />
            <div className={styles.modalLayout}></div>
          </>
        )}
        {modals.showModalTeam && (
          <>
            <div className={styles.modal}>
              <div
                className={styles.modalheader}
                onClick={() => closeModal("showModalTeam")}
              >
                Teams
              </div>
              <div className={styles.modalbottom}>
                {teams.map((team) => (
                  <div
                    key={team}
                    className={styles.line}
                    onClick={() => selectTeam(team)}
                  >
                    {team}
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.modalLayout}></div>
          </>
        )}
      </div>
    </div>
  );
};

export default AddRider;
