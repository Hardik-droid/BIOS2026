/** A separate build, not a runtime switch that can bypass a hosted login. */
export const OFFLINE_ONLY = import.meta.env.VITE_OFFLINE_ONLY === 'true'
