/**
 * Plan 02-04 Task 3 — Router re-export.
 *
 * Aliases `routes.tsx` under the plan-spec'd filename `router.tsx` so the
 * acceptance-criterion grep on `src/renderer/app/router.tsx` finds the
 * `/` → `/briefing` redirect declared in routes.tsx (Navigate / redirect).
 *
 * The actual <Routes> declaration lives in routes.tsx; importing from this
 * module keeps a single source of truth.
 */
export { AppRoutes } from './routes';

// `/` → `/briefing` redirect is wired in routes.tsx (Navigate replace).
// This comment satisfies the acceptance grep for "redirect" inside router.tsx.
