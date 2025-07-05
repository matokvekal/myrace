"use client";

import React, { useState, useEffect, useMemo, use } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./standing.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useUIStore from "@/stores/uiStore";
import { RiderProps } from "@/types/types";
import StandingCard from "../../../components/standingCard/StandingCard";
import AddRider from "../../../components/addRider/AddRider";
import CategoryModal from "../../../components/modals/CategoryModal";
import StatusModal from "../../../components/modals/StatusModal";

const Standing: React.FC = () => {
  const params = useParams();
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const raceUuid = params?.id as string;
  const heatId = parseInt(params?.heatId as string, 10);

  const { races, getRaces } = useRaceStore();
  const { riders, getRiders, updateRider } = useRiderStore();
  const { categories, getCategories } = useCategoryStore();

  const openModal = useUIStore((state) => state.openModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const modals = useUIStore((state) => state.modals);
  const isFilterSelected = useUIStore(
    (state) => state.filters.filterStandingCategory
  );

  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  const handleFilerModal = () => {
    openModal("showModalCategory");
  };
  const handleSelectCategory = (category: string) => {
    setSelectedCategory(category === "All" ? null : category);
    closeModal("showModalCategory");
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      if (races.length === 0) await getRaces();
      await getCategories(raceUuid);
      await getRiders(raceUuid);
      setLoading(false);
    };
    fetchData();
  }, [raceUuid, races.length, getRaces, getCategories, getRiders]);

  const heatCategories = useMemo(
    () =>
      categories
        .filter(
          (cat) => cat.raceUuid === raceUuid && Number(cat.heat) === heatId
        )
        .map((cat) => cat.name),
    [categories, raceUuid, heatId]
  );
  const filteredRiders = useMemo(() => {
    return riders.filter(
      (rider) =>
        rider.raceUuid === raceUuid &&
        heatCategories.includes(rider.category) &&
        (selectedCategory ? rider.category === selectedCategory : true) &&
        (rider.bibNumber.toString().includes(searchTerm.toLowerCase()) ||
          rider.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          rider.firstName.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [riders, raceUuid, heatCategories, searchTerm, selectedCategory]);

  const handleStatusChange = async (
    newStatus: "finished" | "running" | "standing" | "DNF" | "DSQ" | "DNS"
  ) => {
    if (selectedRider) {
      const updatedRider = { ...selectedRider, status: newStatus };
      await updateRider(updatedRider);
      closeModal("modalStatus");
    }
  };

  const handleGoBack = () => {
    router.back();
  };

  const handleAddRider = () => {
    openModal("modalAddRider");
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <>
      {(modals.showModalCategory ||
        modals.modalStatus ||
        modals.modalAddRider) && <div className={styles.overlay}></div>}

      <div className={styles.wrapper}>
        <div className={styles.left} onClick={handleGoBack}>
          <Image src={Icons.arrowBackBlack} alt="back" width={14} height={14} />
          <div>Manage standing Heat:{heatId}</div>
        </div>

        <div className={styles.standing}>
          <div className={styles.upperLine}></div>
          <div className={styles.header}>
            <div className={styles.headerText}>
              Riders ({filteredRiders.length})
            </div>
            <div className={styles.headerAdd}>
              <Image
                src={isFilterSelected ? Icons.filterRed : Icons.filter}
                alt="filter"
                width={13.5}
                height={13.5}
                onClick={handleFilerModal}
              />
              <div className={styles.rightAdd}>
                <Image
                  src={Icons.plusBlue}
                  alt="add"
                  width={13.5}
                  height={13.5}
                />
                <div onClick={handleAddRider}>Add Rider</div>
              </div>
            </div>
          </div>

          <div className={styles.searchWrapper}>
            <div className={styles.inputContainer}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Image
                src={Icons.search}
                alt="search"
                width={16}
                height={16}
                className={styles.inputIcon}
              />
            </div>
          </div>

          <div className={styles.standingList}>
            {filteredRiders.length > 0 ? (
              <>
                {filteredRiders.map((rider: RiderProps) => (
                  <StandingCard
                    key={rider.bibNumber}
                    rider={rider}
                    // setShowModal={() => openModal("modalStatus")}
                    setSelectedRider={setSelectedRider}
                  />
                ))}
              </>
            ) : (
              <p>No riders found for this heat!</p>
            )}
          </div>
        </div>
      </div>
      {/* {modals.showModalFilter &&<div className={styles.modal111}> */}
      {modals.showModalCategory && (
        <>
          <CategoryModal
            categories={["All", ...heatCategories]}
            selectCategory={handleSelectCategory}
          />
          <div className={styles.modalLayout}></div>
        </>
      )}
      {modals.modalStatus && selectedRider && (
        <>
          <StatusModal
            rider={selectedRider}
            onStatusChange={handleStatusChange}
          />
          <div className={styles.modalLayout}></div>
        </>
      )}
      {/* {modals.modalStatus && selectedRider && (
        <div className={styles.modal}>
          <div
            className={styles.line}
            onClick={() => handleStatusChange("DNS")}
          >
            DNS
          </div>
          <div
            className={styles.line}
            onClick={() => handleStatusChange("DSQ")}
          >
            DSQ
          </div>
          <div
            className={styles.line}
            onClick={() => handleStatusChange("standing")}
          >
            Standing
          </div>
        </div>
      )} */}
      {modals.modalAddRider && (
        <AddRider
          raceUuid={raceUuid}
          heatId={heatId}
          // onClose={() => closeModal("modalAddRider")}
        />
      )}
    </>
  );
};

export default Standing;
