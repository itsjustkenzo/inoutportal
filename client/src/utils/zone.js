import { useMemo } from 'react';
import { REGION_ZONES } from '../data/regions.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Whatever the machine itself is set to. */
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * The zone an account's clock should run on.
 *
 * 'Global' is the schema default: it means "no country recorded" rather than a
 * real location, so those accounts — mostly admin and manager — keep following
 * the machine they are sitting at. Anyone with a country set follows that
 * country instead, whatever the browser claims.
 */
export function zoneForRegion(region) {
  if (!region || region === 'Global') return BROWSER_ZONE;
  return REGION_ZONES[region] || BROWSER_ZONE;
}

/**
 * "UTC+8", "UTC-3", "UTC+5:30" — derived rather than hard-coded, so it stays
 * right across DST. Intl hands back a padded "GMT+08:00"; the whole hours and
 * the leading zero both come off, but a real half-hour offset stays.
 */
export function offsetLabel(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date());
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  return raw
    .replace('GMT', 'UTC')
    .replace(/:00$/, '')
    .replace(/([+-])0(\d)/, '$1$2')
    .replace(/^UTC\+0$/, 'UTC') || 'UTC';
}

/** "Sao Paulo" — the city half of an IANA name, for when there is no region. */
export const zoneCity = (timeZone) => timeZone.split('/').pop().replace(/_/g, ' ');

/**
 * The signed-in account's own clock: the zone to format their times in, plus
 * the labels for it. `place` names the region when one is set and falls back to
 * the browser's city when it is not.
 */
export function useZone() {
  const { user } = useAuth();
  const region = user?.region;

  return useMemo(() => {
    const zone = zoneForRegion(region);
    const named = Boolean(region) && region !== 'Global' && Boolean(REGION_ZONES[region]);
    return {
      zone,
      region: named ? region : null,
      place: named ? region : zoneCity(zone),
      offset: offsetLabel(zone),
    };
  }, [region]);
}
