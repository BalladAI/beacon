"use client";

import { useEffect } from "react";
import { type BeaconOptions, init } from "./index";

export { type Beacon, type BeaconOptions, type Identity, track } from "./index";

/**
 * The beacon as a component: render it once in your root layout. Starts on
 * mount, reports client-side navigations on its own, and stops on unmount.
 * Renders nothing.
 *
 *   <BalladBeacon site={process.env.NEXT_PUBLIC_BALLAD_SITE_TOKEN} />
 */
export function BalladBeacon(
  props: Omit<BeaconOptions, "site"> & { site: string | undefined },
) {
  const { site, endpoint, trackNavigation, respectGpc, trackAttributes } =
    props;
  useEffect(() => {
    if (!site) return;
    const beacon = init({
      site,
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(trackNavigation !== undefined ? { trackNavigation } : {}),
      ...(respectGpc !== undefined ? { respectGpc } : {}),
      ...(trackAttributes !== undefined ? { trackAttributes } : {}),
    });
    return () => beacon?.destroy();
  }, [site, endpoint, trackNavigation, respectGpc, trackAttributes]);
  return null;
}
