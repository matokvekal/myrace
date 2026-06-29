/**
 * PermissionGate Component
 *
 * Conditionally renders children based on user permissions.
 * Useful for showing/hiding UI elements based on what user can do.
 */

import React from "react";
import { useAuth } from "@/hooks/useAuth";
import type { PermissionString } from "@/types/rbac.types";

export interface PermissionGateProps {
  /** Permission(s) required to render children */
  permission?: PermissionString;
  permissions?: PermissionString[];

  /** Logic for multiple permissions (default: 'any') */
  requireAll?: boolean; // If true, user must have ALL permissions. If false, ANY permission is enough.

  /** Content to render if user has permission */
  children: React.ReactNode;

  /** Optional fallback to render if user lacks permission */
  fallback?: React.ReactNode;

  /** If true, only hides children but keeps them in DOM (useful for SEO/accessibility) */
  hideInsteadOfRemove?: boolean;
}

/**
 * PermissionGate - Conditionally render based on permissions
 *
 * @example
 * ```tsx
 * // Single permission
 * <PermissionGate permission="rider.edit">
 *   <button onClick={editRider}>Edit</button>
 * </PermissionGate>
 *
 * // Multiple permissions (ANY)
 * <PermissionGate permissions={['rider.edit', 'rider.add']}>
 *   <RiderForm />
 * </PermissionGate>
 *
 * // Multiple permissions (ALL)
 * <PermissionGate permissions={['rider.edit', 'category.assign']} requireAll>
 *   <AdvancedRiderForm />
 * </PermissionGate>
 *
 * // With fallback
 * <PermissionGate
 *   permission="rider.delete"
 *   fallback={<p>No permission to delete riders</p>}
 * >
 *   <button onClick={deleteRider}>Delete</button>
 * </PermissionGate>
 * ```
 */
export const PermissionGate: React.FC<PermissionGateProps> = ({
  permission,
  permissions,
  requireAll = false,
  children,
  fallback = null,
  hideInsteadOfRemove = false
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();

  // Determine if user has required permission(s)
  let hasRequiredPermission = false;

  if (permission) {
    // Single permission check
    hasRequiredPermission = hasPermission(permission);
  } else if (permissions && permissions.length > 0) {
    // Multiple permissions check
    if (requireAll) {
      hasRequiredPermission = hasAllPermissions(permissions);
    } else {
      hasRequiredPermission = hasAnyPermission(permissions);
    }
  } else {
    // No permissions specified = always show
    console.warn("PermissionGate: No permission(s) specified");
    hasRequiredPermission = true;
  }

  // If user doesn't have permission
  if (!hasRequiredPermission) {
    if (hideInsteadOfRemove) {
      return <div style={{ display: "none" }}>{children}</div>;
    }
    return <>{fallback}</>;
  }

  // User has permission, render children
  return <>{children}</>;
};

/**
 * ProtectedAction Component
 *
 * Wraps interactive elements (buttons, links) and disables them if user lacks permission.
 * Adds a tooltip explaining why the action is disabled.
 */
export interface ProtectedActionProps {
  /** Permission required to enable the action */
  permission: PermissionString;

  /** The interactive element (button, link, etc.) */
  children: React.ReactElement;

  /** Optional message to show when disabled */
  disabledMessage?: string;

  /** If true, hides element instead of disabling it */
  hideWhenDisabled?: boolean;
}

/**
 * ProtectedAction - Disable/hide actions based on permissions
 *
 * @example
 * ```tsx
 * <ProtectedAction permission="rider.delete" disabledMessage="No permission to delete">
 *   <button onClick={deleteRider}>Delete Rider</button>
 * </ProtectedAction>
 * ```
 */
export const ProtectedAction: React.FC<ProtectedActionProps> = ({
  permission,
  children,
  disabledMessage = "You do not have permission for this action",
  hideWhenDisabled = false
}) => {
  const { hasPermission } = useAuth();
  const allowed = hasPermission(permission);

  if (!allowed && hideWhenDisabled) {
    return null;
  }

  if (!allowed) {
    // Clone the child element and add disabled prop + title
    return React.cloneElement(children, {
      disabled: true,
      title: disabledMessage,
      style: {
        ...children.props.style,
        opacity: 0.5,
        cursor: "not-allowed",
        pointerEvents: "none"
      }
    });
  }

  return children;
};

export default PermissionGate;
