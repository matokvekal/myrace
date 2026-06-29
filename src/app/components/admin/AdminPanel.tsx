/**
 * AdminPanel Component
 *
 * Simple admin interface for generating user tokens and managing roles.
 * Admin can:
 * - View all roles
 * - Generate tokens for users with specific roles
 * - Copy tokens to share with commissaires
 */

"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRBACStore } from "@/stores/rbacStore";
import type { Role } from "@/types/rbac.types";
import styles from "./adminPanel.module.css";

export const AdminPanel: React.FC = () => {
  const { hasPermission, user } = useAuth();
  const { roles, users, getRoles, getUsers, generateUserToken } =
    useRBACStore();

  const [isLoading, setIsLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [raceUuid, setRaceUuid] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load roles and users on mount
  useEffect(() => {
    const loadData = async () => {
      await Promise.all([getRoles(), getUsers()]);
      setIsLoading(false);
    };
    loadData();
  }, [getRoles, getUsers]);

  // Check if user has admin permission
  if (!hasPermission("*")) {
    return (
      <div className={styles.container}>
        <div className={styles.noAccess}>
          <h2>🚫 Access Denied</h2>
          <p>You do not have administrator permissions to access this panel.</p>
        </div>
      </div>
    );
  }

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setGeneratedToken(null);

    // Validation
    if (!userName.trim()) {
      setError("User name is required");
      return;
    }
    if (!userEmail.trim()) {
      setError("User email is required");
      return;
    }
    if (!selectedRoleId) {
      setError("Please select a role");
      return;
    }

    try {
      // Create user and generate token
      const role = roles.find((r: Role) => r.id === selectedRoleId);
      if (!role) {
        setError("Selected role not found");
        return;
      }

      const userId = crypto.randomUUID();
      const expiresInMs = expiresInDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds

      const token = await generateUserToken(
        userId,
        selectedRoleId,
        expiresInMs
      );

      if (token) {
        setGeneratedToken(token);

        // Reset form (but keep role selected for easier batch generation)
        setUserName("");
        setUserEmail("");
        setRaceUuid("");
      } else {
        setError("Failed to generate token");
      }
    } catch (err) {
      console.error("Token generation error:", err);
      setError("An error occurred while generating the token");
    }
  };

  const handleCopyToken = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      alert("Token copied to clipboard!");
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>🔐 Admin Panel</h1>
        <p className={styles.subtitle}>
          Generate access tokens for commissaires
        </p>
      </div>

      <div className={styles.content}>
        {/* Roles Overview */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Available Roles</h2>
          <div className={styles.rolesGrid}>
            {roles.map((role: Role) => (
              <div key={role.id} className={styles.roleCard}>
                <div className={styles.roleHeader}>
                  <span className={styles.roleName}>{role.displayName}</span>
                  {role.isDefault && (
                    <span className={styles.defaultBadge}>Default</span>
                  )}
                </div>
                <p className={styles.roleDescription}>{role.description}</p>
                <div className={styles.permissionCount}>
                  {role.permissions.length === 1 && role.permissions[0] === "*"
                    ? "All permissions"
                    : `${role.permissions.length} permissions`}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Token Generation Form */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Generate User Token</h2>

          <form onSubmit={handleGenerateToken} className={styles.form}>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label htmlFor="userName" className={styles.label}>
                  User Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="userName"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g., John Doe"
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="userEmail" className={styles.label}>
                  Email <span className={styles.required}>*</span>
                </label>
                <input
                  id="userEmail"
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="e.g., john@example.com"
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="role" className={styles.label}>
                  Role <span className={styles.required}>*</span>
                </label>
                <select
                  id="role"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className={styles.select}
                  required
                >
                  <option value="">Select a role...</option>
                  {roles.map((role: Role) => (
                    <option key={role.id} value={role.id}>
                      {role.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="raceUuid" className={styles.label}>
                  Race UUID (optional)
                </label>
                <input
                  id="raceUuid"
                  type="text"
                  value={raceUuid}
                  onChange={(e) => setRaceUuid(e.target.value)}
                  placeholder="Leave empty for all races"
                  className={styles.input}
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="expiresIn" className={styles.label}>
                  Expires In (days)
                </label>
                <input
                  id="expiresIn"
                  type="number"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  min={1}
                  max={365}
                  className={styles.input}
                />
              </div>
            </div>

            {error && (
              <div className={styles.error}>
                <span className={styles.errorIcon}>⚠️</span>
                {error}
              </div>
            )}

            <button type="submit" className={styles.submitButton}>
              Generate Token
            </button>
          </form>

          {/* Generated Token Display */}
          {generatedToken && (
            <div className={styles.tokenResult}>
              <h3 className={styles.tokenResultTitle}>
                ✅ Token Generated Successfully!
              </h3>
              <p className={styles.tokenInstruction}>
                Share this token with the user. They can use it to login.
              </p>
              <div className={styles.tokenBox}>
                <code className={styles.tokenText}>{generatedToken}</code>
                <button onClick={handleCopyToken} className={styles.copyButton}>
                  📋 Copy
                </button>
              </div>
              <p className={styles.tokenWarning}>
                ⚠️ Make sure to copy this token now. It won't be shown again!
              </p>
            </div>
          )}
        </div>

        {/* Users List */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Active Users ({users.filter((u) => u.isActive).length})
          </h2>
          {users.length === 0 ? (
            <p className={styles.emptyState}>No users created yet.</p>
          ) : (
            <div className={styles.usersTable}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => {
                    const role = roles.find((r: Role) => r.id === user.roleId);
                    return (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{role?.displayName || "Unknown"}</td>
                        <td>
                          <span
                            className={
                              user.isActive
                                ? styles.activeStatus
                                : styles.inactiveStatus
                            }
                          >
                            {user.isActive ? "🟢 Active" : "🔴 Inactive"}
                          </span>
                        </td>
                        <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
