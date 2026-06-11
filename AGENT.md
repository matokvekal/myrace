# Commissaire — Agent Working Document

## Project Overview
Bike race commissaire (organizer) app. Mobile-first PWA, fully client-side.

**Stack:** Next.js 15 → migrating to **Vite + React Router v6**  
**UI:** MUI v5 + CSS Modules  
**State:** Zustand + IndexedDB (stays unchanged)  
**Auth:** js-cookie tokens  

---

## Migration Plan: Next.js → Vite + React

### Why
The app is 100% client-rendered (`"use client"` everywhere, no SSR/SSG). Next.js adds overhead with no benefit.

### Target Stack
- **Vite** — build tool
- **React Router v6** — routing (replaces Next.js App Router)
- Everything else unchanged (MUI, Zustand, IndexedDB, CSS Modules)

---

## Route Mapping (Next.js App Router → React Router)

| Next.js path | React Router path |
|---|---|
| `src/app/page.tsx` | `/` → redirect to `/main` |
| `src/app/splash/page.tsx` | `/splash` |
| `src/app/login/page.tsx` | `/login` |
| `src/app/otp/page.tsx` | `/otp` |
| `src/app/loginerror/page.tsx` | `/loginerror` |
| `src/app/main/page.tsx` | `/main` |
| `src/app/contact/page.tsx` | `/contact` |
| `src/app/race/[id]/page.tsx` | `/race/:id` |
| `src/app/race/[id]/heat/[heatId]/page.tsx` | `/race/:id/heat/:heatId` |
| `src/app/race/[id]/standing/[heatId]/page.tsx` | `/race/:id/standing/:heatId` |
| `src/app/not-found.tsx` | `*` (catch-all) |

---

## API Replacements

### Navigation hooks (`next/navigation` → `react-router-dom`)
| Old | New |
|---|---|
| `useRouter()` + `router.push(p)` | `useNavigate()` + `navigate(p)` |
| `useRouter()` + `router.back()` | `useNavigate()` + `navigate(-1)` |
| `usePathname()` | `useLocation().pathname` |
| `useParams()` | `useParams()` (same name, new import) |
| `useSearchParams()` | `useSearchParams()` (same name, new import) |

### Images (`next/image` → `<img>`)
- Replace `import Image from 'next/image'` with plain `<img>` tags
- For `fill` layout: use CSS `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`
- `StaticImageData` type in `types.ts` → replace with `string`

### Links (`next/link` → `react-router-dom`)
- `<Link href="/path">` → `<Link to="/path">` from `react-router-dom`
- Used in: `loginerror/page.tsx`, `not-found.tsx`

---

## Files to Delete
- `next.config.mjs`
- `src/app/layout.tsx` (logic moves to `src/App.tsx`)
- `src/app/_document.tsx` (empty Next.js file)
- `src/app/manifest.ts` → replaced by `public/manifest.json`

## Files to Create
- `vite.config.ts`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `public/manifest.json`

## Files to Keep Unchanged
- All Zustand stores (`src/app/stores/`)
- All utils (`src/app/utils/`)
- All services (`src/app/services/`)
- All CSS modules
- `pages/api/geocode.ts` (placeholder for future Google Maps work)

---

## Environment Variables
| Old | New |
|---|---|
| `process.env.NEXT_PUBLIC_APP_NAME` | `import.meta.env.VITE_APP_NAME` |
| `process.env.NEXT_PUBLIC_VERSION` | `import.meta.env.VITE_VERSION` |
| `process.env.API_URL` | `import.meta.env.VITE_API_URL` |
| `process.env.NODE_ENV` | `import.meta.env.MODE` |
| `process.env.GOOGLE_MAP_API_KEY` | `import.meta.env.VITE_GOOGLE_MAP_API_KEY` |

---

## Implementation Checklist
- [x] Update `package.json` (scripts + deps)
- [x] Create `vite.config.ts`
- [x] Create `index.html`
- [x] Create `src/main.tsx`
- [x] Create `src/App.tsx`
- [x] Update `src/app/types/types.ts` (remove StaticImageData)
- [x] Update `src/app/config/index.ts` (env vars)
- [x] Replace `next/navigation` in all files
- [x] Replace `next/image` in all files
- [x] Replace `next/link` in all files
- [x] Delete Next.js-only files (`layout.tsx`, `manifest.ts`, `next.config.mjs`, `_document.tsx`)
- [x] Create `public/manifest.json`
- [x] Update `tsconfig.json`
- [x] Remove all `"use client"` directives
- [x] Run `npm install` + verify build — **`vite build` passed, 499 modules, no errors**
- [x] Added missing `idb` dependency to `package.json`
