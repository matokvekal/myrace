// components/standing/Standing.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { shallow } from "zustand/shallow";
import styles from "./standing.module.css";
import Icons from "@/constants/Icons";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import { RiderProps } from "@/types/types";
import StandingCard from "../../../components/standingCard/StandingCard";
import AddRider from "../../../components/addRider/AddRider";
import CategoryModal from "../../../components/modals/CategoryModal";
import StatusModal from "../../../components/modals/StatusModal";

const Standing: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const raceUuid = params?.id as string;
  const heatId = parseInt(params?.heatId as string, 10);
  const categoryName = searchParams?.get("category") || "";

  // UI store
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const modals = useUIStore((s) => s.modals);
  const isFilterSelected = useUIStore((s) => s.filters.filterStandingCategory);

  // Race & Category stores
  const { getRaces, races } = useRaceStore();
  const { getCategories, categories } = useCategoryStore();

  // Rider store actions
  const getRiders = useRiderStore((s) => s.getRiders);
  const updateRider = useRiderStore((s) => s.updateRider);

  // Fetch initial data
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      if (races.length === 0) await getRaces();
      await getCategories(raceUuid);
      await getRiders(raceUuid);
      setLoading(false);
    })();
  }, [raceUuid]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);

  // Subscribe & filter riders from store directly
  const filteredRiders = useRiderStore(
    (s) =>
      s
        .getRidersByCategory(raceUuid, categoryName)
        .filter((r) =>
          [
            r.bibNumber.toString(),
            r.firstName.toLowerCase(),
            r.lastName.toLowerCase()
          ].some((f) => f.includes(searchTerm.toLowerCase()))
        ),
    shallow
  );

  const markStanding = async (rider: RiderProps) => {
    await updateRider({ ...rider, status: "standing" });
  };

  const handleStatusChange = async (status: RiderProps["status"]) => {
    if (selectedRider) {
      await updateRider({ ...selectedRider, status });
      closeModal("modalStatus");
    }
  };

  const handleGoBack = () => {
    setActiveTab?.("heats");
    navigate(-1);
  };
  const handleFilter = () => openModal("showModalCategory");
  const handleAddRider = () => openModal("modalAddRider");

  if (loading) return <div className={styles.loading}>Loading...</div>;

  return (
    <>
      {(modals.showModalCategory ||
        modals.modalStatus ||
        modals.modalAddRider) && <div className={styles.overlay} />}

      <div className={styles.wrapper}>
        <div className={styles.left} onClick={handleGoBack}>
          <img src={Icons.arrowBackBlack} alt="back" width={14} height={14} />
          <div>Category: {categoryName}</div>
        </div>

        <div className={styles.standing}>
          <div className={styles.header}>
            <div className={styles.headerText}>
              Riders ({filteredRiders.length})
            </div>
            <div className={styles.headerAdd}>
              <img
                src={isFilterSelected ? Icons.filterRed : Icons.filter}
                alt="filter"
                width={14}
                height={14}
                onClick={handleFilter}
              />
              <div className={styles.rightAdd} onClick={handleAddRider}>
                <img src={Icons.plusBlue} alt="add" width={14} height={14} />
                <span>Add Rider</span>
              </div>
            </div>
          </div>

          <div className={styles.searchWrapper}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <img
              src={Icons.search}
              alt="search"
              width={16}
              height={16}
              className={styles.inputIcon}
            />
          </div>

          <div className={styles.standingList}>
            {filteredRiders.length > 0 ? (
              filteredRiders.map((r) => (
                <StandingCard
                  key={r.id}
                  rider={r}
                  setSelectedRider={setSelectedRider}
                  markStanding={markStanding}
                />
              ))
            ) : (
              <p>No riders in this category.</p>
            )}
          </div>
        </div>
      </div>

      {modals.showModalCategory && (
        <CategoryModal
          categories={[
            "All",
            ...Array.from(new Set(filteredRiders.map((r) => r.category)))
          ]}
          selectCategory={(cat) => {
            useUIStore.getState().closeModal("showModalCategory");
          }}
        />
      )}
      {modals.modalStatus && selectedRider && (
        <StatusModal
          rider={selectedRider}
          onStatusChange={handleStatusChange}
        />
      )}
      {modals.modalAddRider && <AddRider raceUuid={raceUuid} heatId={heatId} />}
    </>
  );
};

export default Standing;
